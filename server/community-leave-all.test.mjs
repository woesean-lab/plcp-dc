import test from "node:test";
import assert from "node:assert/strict";
import { createCommunityLeaveAll } from "./community-leave-all.mjs";
import { canPublicLeaveAll, claimPublicLeaveAll, hideCommunityLeaveInformation } from "./public-community-leave.mjs";

const ids = ["234567890123456789", "345678901234567890", "456789012345678901"];
const order = () => ({ uniqid: "order", provider: "community", categoryId: "online", status: "COMPLETED", serverId: "123456789012345678", publicLeaveAllEnabled: true,
  communityResults: ids.map((discordUserId) => ({ state: "joined", discordUserId })) });

function fixture(initial = order(), leave = async () => ({ state: "left", details: "Left." })) {
  let stored = structuredClone(initial);
  let queue = Promise.resolve();
  const snapshots = [];
  const calls = [];
  const active = new Set();
  const pool = {
    async query(sql) {
      if (sql.includes("community_oauth_joins")) return { rows: [] };
      if (sql.includes("SELECT payload FROM tracked_orders")) return { rows: [{ payload: structuredClone(stored) }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      let unlock; let pending;
      return { release() {}, async query(sql, args) {
        if (sql === "BEGIN") return { rows: [] };
        if (sql.includes("FROM community_stock_categories")) return { rows: [{ id: "online", public_leave_all_enabled: true }] };
        if (sql.includes("FOR UPDATE")) {
          const previous = queue;
          queue = new Promise((resolve) => { unlock = resolve; });
          await previous;
          return { rows: [{ payload: structuredClone(stored) }] };
        }
        if (sql.startsWith("UPDATE")) pending = JSON.parse(args[1]);
        if (sql === "COMMIT") { if (pending) { stored = pending; snapshots.push(structuredClone(stored)); } unlock?.(); }
        if (sql === "ROLLBACK") unlock?.();
        return { rows: [] };
      } };
    }
  };
  const deps = { pool, active, getConfig: async () => ({}), leaveMember: async (_guild, id) => { calls.push(id); return leave(id); },
    forEachWithConcurrency: async (values, _limit, task) => Promise.all(values.map(task)), updateMembershipCache() {}, isExpired: () => true };
  return { read: () => structuredClone(stored), snapshots, calls, deps, run: createCommunityLeaveAll(deps), addMember(member) { stored.communityResults.push(member); } };
}

test("manual Leave all persists zero and every member completion while the request is still running", async () => {
  let finishLast;
  const gate = new Promise((resolve) => { finishLast = resolve; });
  const view = fixture(order(), async (id) => { if (id === ids[2]) await gate; return { state: "left", details: "Left." }; });
  const running = view.run(order());
  for (let i = 0; i < 30 && view.read().membersLeaveJob?.processed !== 2; i++) await new Promise((resolve) => setImmediate(resolve));
  const partial = view.read();
  assert.equal(view.snapshots[0].membersLeaveJob.processed, 0);
  assert.equal(partial.membersLeaveJob.processed, 2);
  assert.equal(partial.membersLeaveJob.total, 3);
  assert.equal(partial.membersLeaveJob.status, "running");
  assert.equal(partial.communityResults.filter((item) => item.membershipStatus === "removed").length, 2);
  assert.equal(canPublicLeaveAll(partial), false);
  assert.equal(hideCommunityLeaveInformation(partial).memberLeaveProgress.processed, 2);
  await assert.rejects(view.run(partial), { statusCode: 409 });
  finishLast();
  const result = await running;
  assert.equal(result.summary.left, 3);
  assert.equal(result.order.membersLeaveJob.status, "completed");
  assert.equal(hideCommunityLeaveInformation(result.order).publicLeaveAllUsed, true);
});

test("failed and removed members never receive another Leave all request; unattempted members remain available", async () => {
  const initial = order();
  initial.communityResults = initial.communityResults.slice(0, 2);
  const view = fixture(initial, async (id) => ({ state: id === ids[0] ? "failed" : "left", details: "Outcome." }));
  const first = await view.run(initial);
  assert.equal(first.order.membersLeaveJob.status, "completed_with_errors");
  assert.equal(first.order.communityResults[0].leaveAllStatus, "failed");
  assert.equal(canPublicLeaveAll(first.order), false);
  await assert.rejects(view.run(first.order), { statusCode: 409 });
  assert.equal(view.calls.length, 2);
  view.addMember(order().communityResults[2]);
  assert.equal(canPublicLeaveAll(view.read()), true);
  const second = await view.run(view.read());
  assert.equal(second.summary.total, 1);
  assert.deepEqual(view.calls, ids);
  assert.equal(second.order.communityResults[0].leaveAllStatus, "failed");
});

test("a preparation failure releases the operation and permits unattempted members without resending failed members", async () => {
  const initial = order();
  initial.communityResults[0].leaveAllStatus = "failed";
  const view = fixture(initial);
  const broken = createCommunityLeaveAll({ ...view.deps, getConfig: async () => { throw new Error("Config unavailable"); } });
  await assert.rejects(broken(initial), /Config unavailable/);
  assert.equal(view.read().membersLeaveJob.status, "failed");
  assert.equal(view.read().membersLeaveJob.processed, 0);
  assert.equal(canPublicLeaveAll(view.read()), true);
  await view.run(view.read());
  assert.deepEqual(view.calls, ids.slice(1));
});

test("an active persisted attempt blocks another process with its own local active set", async () => {
  const initial = { ...order(), membersLeaveJob: { id: "other-process", status: "running", startedAt: new Date().toISOString() } };
  const view = fixture(initial);
  await assert.rejects(view.run(initial), { statusCode: 409 });
  assert.deepEqual(view.calls, []);
  assert.equal(view.read().membersLeaveJob.id, "other-process");
});

test("a reserved public attempt starts once and persists customer departure sources", async () => {
  const view = fixture();
  const claimed = await claimPublicLeaveAll(view.deps.pool, "order", "stock");
  const result = await view.run(claimed, { source: "customer" });
  assert.equal(result.order.membersLeaveJob.id, claimed.membersLeaveJob.id);
  assert.equal(result.order.membersLeaveJob.status, "completed");
  assert.ok(result.order.communityResults.every((item) => item.membershipLeaveSource === "customer"));
  assert.equal(canPublicLeaveAll(result.order), false);
});
