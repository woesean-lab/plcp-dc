import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { canPublicLeaveAll, claimPublicLeaveAll, hideCommunityLeaveInformation, publicLeaveAllAllowedByCategories, publicLeaveAllCategoryIds } from "./public-community-leave.mjs";

const order = () => ({
  uniqid: "order-one", provider: "community", status: "COMPLETED", serverId: "123456789012345678",
  categoryId: "online", publicLeaveAllEnabled: true,
  communityResults: [{ state: "joined", discordUserId: "234567890123456789", username: "member" }]
});

function fixture(initial, categories = [{ id: "online", public_leave_all_enabled: true }]) {
  let stored = structuredClone(initial);
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(stored),
    setCategories(next) { categories = next; },
    async connect() {
      let unlock;
      let pending;
      return {
        release() {},
        async query(sql, args) {
          if (sql === "BEGIN") return { rows: [] };
          if (sql.includes("FROM community_stock_categories")) return { rows: args[0] === "stock" ? categories.filter((category) => args[1].includes(category.id)) : [] };
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
    { provider: "dcord" }, { publicLeaveAllEnabled: false }, { publicLeaveAllEnabled: undefined }, { status: "PROCESS" }, { serverId: "bad-id" },
    { publicLeaveAllRequestedAt: "used" }, { autoLeaveJob: { status: "running" } },
    { communityResults: [] },
    { communityResults: [{ ...order().communityResults[0], membershipStatus: "removed" }] },
    { communityResults: [...order().communityResults, { state: "replacing" }] }
  ]) assert.equal(canPublicLeaveAll({ ...order(), ...overrides }), false, JSON.stringify(overrides));
});

test("concurrent requests across sessions claim only one use, persisted before Discord work", async () => {
  const pool = fixture(order());
  const results = await Promise.allSettled([claimPublicLeaveAll(pool, "order-one", "stock"), claimPublicLeaveAll(pool, "order-one", "stock")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.statusCode, 409);
  assert.ok(pool.read().publicLeaveAllRequestedAt);
  // A new request after an interrupted/failed Discord operation still cannot run again.
  await assert.rejects(claimPublicLeaveAll(pool, "order-one", "stock"), { statusCode: 409 });
});

test("invalid and missing orders do not consume a use", async () => {
  const pool = fixture({ ...order(), status: "PROCESS" });
  await assert.rejects(claimPublicLeaveAll(pool, "order-one", "stock"), { statusCode: 409 });
  assert.equal(pool.read().publicLeaveAllRequestedAt, undefined);
  await assert.rejects(claimPublicLeaveAll(fixture(null), "missing", "stock"), { statusCode: 404 });
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
    await assert.rejects(claimPublicLeaveAll(pool, source.uniqid, "stock"), { statusCode: 409, message: "Leave all has already been used for this order." });
    assert.equal(pool.read().publicLeaveAllRequestedAt, undefined);
  }
});

test("category permission is opt-in and requires every category in a mixed order", () => {
  const enabled = { id: "online", public_leave_all_enabled: true };
  assert.equal(publicLeaveAllAllowedByCategories(order(), [enabled]), true);
  for (const categories of [[], [{ id: "online" }], [{ ...enabled, public_leave_all_enabled: false }]]) {
    assert.equal(publicLeaveAllAllowedByCategories(order(), categories), false);
  }
  const mixed = { ...order(), categoryAllocations: [{ categoryId: "online" }, { categoryId: "premium" }] };
  assert.equal(publicLeaveAllAllowedByCategories(mixed, [enabled]), false);
  assert.equal(publicLeaveAllAllowedByCategories(mixed, [enabled, { id: "premium", public_leave_all_enabled: false }]), false);
  assert.equal(publicLeaveAllAllowedByCategories(mixed, [enabled, { id: "premium", public_leave_all_enabled: true }]), true);
  assert.equal(publicLeaveAllAllowedByCategories({ ...order(), communityResults: [{ categoryId: "unknown" }] }, [enabled]), false);
  assert.deepEqual(publicLeaveAllCategoryIds({ provider: "community", service: "COMMUNITY-ONLINE", communityResults: [{}] }), ["online"]);
  assert.deepEqual(publicLeaveAllCategoryIds({ ...mixed, categoryAllocations: [{ categoryId: "online", allocationId: "one" }, { categoryId: "online", allocationId: "two" }] }), ["online"]);
});

test("a stale enabled order snapshot cannot bypass disabled/missing/current guild settings", async () => {
  for (const categories of [[], [{ id: "online", public_leave_all_enabled: false }]]) {
    const pool = fixture(order(), categories);
    await assert.rejects(claimPublicLeaveAll(pool, "order-one", "stock"), { statusCode: 403 });
    assert.equal(pool.read().publicLeaveAllRequestedAt, undefined);
  }
  const pool = fixture(order());
  await assert.rejects(claimPublicLeaveAll(pool, "order-one", "another-guild"), { statusCode: 403 });
  assert.equal(pool.read().publicLeaveAllRequestedAt, undefined);
});

test("category edits apply to existing orders and revocation before clicking does not consume the action", async () => {
  const pool = fixture({ ...order(), publicLeaveAllEnabled: false });
  const claimed = await claimPublicLeaveAll(pool, "order-one", "stock");
  assert.equal(claimed.publicLeaveAllEnabled, true);
  assert.ok(claimed.publicLeaveAllRequestedAt);
  const revoked = fixture(order());
  revoked.setCategories([{ id: "online", public_leave_all_enabled: false }]);
  await assert.rejects(claimPublicLeaveAll(revoked, "order-one", "stock"), { statusCode: 403 });
  assert.equal(revoked.read().publicLeaveAllRequestedAt, undefined);
});

test("mixed-order API calls cannot remove members belonging to a disabled category", async () => {
  const mixed = { ...order(), categoryAllocations: [{ categoryId: "online" }, { categoryId: "premium" }] };
  const pool = fixture(mixed, [{ id: "online", public_leave_all_enabled: true }, { id: "premium", public_leave_all_enabled: false }]);
  await assert.rejects(claimPublicLeaveAll(pool, "order-one", "stock"), { statusCode: 403 });
  assert.equal(pool.read().publicLeaveAllRequestedAt, undefined);
  pool.setCategories([{ id: "online", public_leave_all_enabled: true }, { id: "premium", public_leave_all_enabled: true }]);
  assert.ok((await claimPublicLeaveAll(pool, "order-one", "stock")).publicLeaveAllRequestedAt);
});

const pgRuntime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
test("PostgreSQL defaults existing categories to disabled and checks live scoped settings before a claim", { skip: !fs.existsSync(fileURLToPath(pgRuntime)) }, async () => {
  const { PGlite } = await import(pgRuntime.href);
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE tracked_orders (uniqid text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz); CREATE TABLE community_stock_categories (guild_id text, id text)");
    await db.exec("INSERT INTO community_stock_categories VALUES ('stock', 'online'), ('other-stock', 'online')");
    await db.exec("ALTER TABLE community_stock_categories ADD COLUMN IF NOT EXISTS public_leave_all_enabled BOOLEAN NOT NULL DEFAULT FALSE");
    await db.exec("ALTER TABLE community_stock_categories ADD COLUMN IF NOT EXISTS public_leave_all_enabled BOOLEAN NOT NULL DEFAULT FALSE");
    await db.exec("UPDATE community_stock_categories SET public_leave_all_enabled = TRUE WHERE guild_id = 'other-stock'");
    await db.query("INSERT INTO tracked_orders (uniqid, payload) VALUES ($1, $2::jsonb)", ["order-one", JSON.stringify(order())]);
    const pool = { connect: async () => ({ query: (sql, args) => db.query(sql, args), release() {} }) };
    await assert.rejects(claimPublicLeaveAll(pool, "order-one", "stock"), { statusCode: 403 });
    const saved = (await db.query("SELECT payload FROM tracked_orders WHERE uniqid = 'order-one'")).rows[0].payload;
    assert.equal(saved.publicLeaveAllRequestedAt, undefined);
    await db.exec("UPDATE community_stock_categories SET public_leave_all_enabled = TRUE WHERE guild_id = 'stock'");
    assert.ok((await claimPublicLeaveAll(pool, "order-one", "stock")).publicLeaveAllRequestedAt);
    await assert.rejects(claimPublicLeaveAll(pool, "order-one", "stock"), { statusCode: 409 });
  } finally { await db.close(); }
});
