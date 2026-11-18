import test from "node:test";
import assert from "node:assert/strict";
import { canPublicLeaveAll, claimPublicLeaveAll, hideCommunityLeaveInformation } from "./public-community-leave.mjs";

const order = () => ({
  uniqid: "order-one", provider: "community", status: "COMPLETED", serverId: "123456789012345678",
  communityResults: [{ state: "joined", discordUserId: "234567890123456789", username: "member" }]
});

function fixture(initial) {
  let stored = structuredClone(initial);
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(stored),
    async connect() {
      let unlock;
      let pending;
      return {
        release() {},
        async query(sql, args) {
          if (sql === "BEGIN") return { rows: [] };
          if (sql.includes("FOR UPDATE")) {
            const previous = queue;
            queue = new Promise((resolve) => { unlock = resolve; });
            await previous;
            return { rows: stored ? [{ payload: structuredClone(stored) }] : [] };
          }
          if (sql.startsWith("UPDATE")) pending = JSON.parse(args[1]);
          if (sql === "COMMIT") { stored = pending; unlock?.(); }
          if (sql === "ROLLBACK") unlock?.();
          return { rows: [] };
        }
      };
    }
  };
}

test("public responses hide leave schedules, outcomes and internal job identifiers without changing the admin order", () => {
  const source = order();
  source.autoLeaveJob = { status: "running", total: 1, intervalSeconds: 10 };
  source.autoLeaveCandidateCount = 1;
  source.membersLeftAt = "private-date";
  source.publicLeaveAllRequestedAt = "private-request-date";
  Object.assign(source.communityResults[0], {
    autoLeaveJobId: "private-job", autoLeaveStatus: "failed", autoLeaveDetails: "private proxy error",
    autoLeaveScheduledAt: "private-date", autoLeaveAttemptedAt: "private-date", autoLeaveCompletedAt: "private-date",
    leftServerAt: "private-date"
  });
  const publicOrder = hideCommunityLeaveInformation(source);
  assert.equal(publicOrder.publicLeaveAllUsed, true);
  assert.equal(JSON.stringify(publicOrder).includes("private"), false);
  assert.equal(Object.keys(publicOrder).some((key) => key.startsWith("autoLeave")), false);
  assert.equal(Object.keys(publicOrder.communityResults[0]).some((key) => key.startsWith("autoLeave")), false);
  assert.equal(source.communityResults[0].autoLeaveStatus, "failed");
  assert.equal(source.autoLeaveJob.status, "running");
});

test("leave all requires finished delivery and delivered members, and excludes used orders and running auto leave", () => {
  assert.equal(canPublicLeaveAll(order()), true);
  for (const overrides of [
    { provider: "dcord" }, { status: "PROCESS" }, { serverId: "bad-id" },
    { publicLeaveAllRequestedAt: "used" }, { autoLeaveJob: { status: "running" } },
    { communityResults: [] },
    { communityResults: [{ ...order().communityResults[0], membershipStatus: "removed" }] },
    { communityResults: [...order().communityResults, { state: "replacing" }] }
  ]) assert.equal(canPublicLeaveAll({ ...order(), ...overrides }), false, JSON.stringify(overrides));
});

test("concurrent requests across sessions claim only one use, persisted before Discord work", async () => {
  const pool = fixture(order());
  const results = await Promise.allSettled([claimPublicLeaveAll(pool, "order-one"), claimPublicLeaveAll(pool, "order-one")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.statusCode, 409);
  assert.ok(pool.read().publicLeaveAllRequestedAt);
  // A new request after an interrupted/failed Discord operation still cannot run again.
  await assert.rejects(claimPublicLeaveAll(pool, "order-one"), { statusCode: 409 });
});

test("invalid and missing orders do not consume a use", async () => {
  const pool = fixture({ ...order(), status: "PROCESS" });
  await assert.rejects(claimPublicLeaveAll(pool, "order-one"), { statusCode: 409 });
  assert.equal(pool.read().publicLeaveAllRequestedAt, undefined);
  await assert.rejects(claimPublicLeaveAll(fixture(null), "missing"), { statusCode: 404 });
});

test("previous admin, auto leave and legacy starts disable the monitor and reject another public request", async () => {
  for (const previous of [
    { membersLeaveAllRequestedAt: "previous-admin-start" },
    { membersLeftAt: "previous-completion" },
    { autoLeaveJob: { status: "running" } },
    { autoLeaveJob: { status: "completed" } },
    { autoLeaveJob: { status: "completed_with_errors" } },
    { communityResults: [{ ...order().communityResults[0], leftServerAt: "previous-leave" }] },
    { communityResults: [{ ...order().communityResults[0], autoLeaveStatus: "failed" }] }
  ]) {
    const source = { ...order(), ...previous };
    assert.equal(canPublicLeaveAll(source), false);
    const publicOrder = hideCommunityLeaveInformation(source);
    assert.equal(publicOrder.publicLeaveAllUsed, true);
    assert.equal(publicOrder.membersLeaveAllRequestedAt, undefined);
    const pool = fixture(source);
    await assert.rejects(claimPublicLeaveAll(pool, source.uniqid), { statusCode: 409, message: "Leave all has already been used for this order." });
    assert.equal(pool.read().publicLeaveAllRequestedAt, undefined);
  }
});
