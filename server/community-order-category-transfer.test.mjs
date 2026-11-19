import test from "node:test";
import assert from "node:assert/strict";
import { planCommunityOrderCategoryTransfer, createCommunityOrderCategoryTransferHandler } from "./community-order-category-transfer.mjs";

const source = { id: "premium", name: "OAuth Premium", color_key: "violet", updated_at: "2026-11-01" };
const target = { id: "online", name: "OAuth Online", color_key: "cyan", check_replacement_enabled: true, reaction_use_enabled: false, updated_at: "2026-11-01" };
const base = { uniqid: "old-order", provider: "community", service: "COMMUNITY-ONLINE", categoryId: source.id, stockType: source.id, categoryName: source.name, status: "COMPLETED", createdAt: "2026-09-01", expiredAt: "2026-11-01", durationMonths: 2, amount: 200, added: 200, serverId: "123", monitorToken: "unchanged", membersLeftAt: "2026-11-02", autoLeaveJob: { status: "completed", processed: 200, total: 200 }, categoryAllocations: [{ categoryId: source.id, categoryName: source.name, amount: 200, added: 200, isPeriodic: true, expiredAt: "2026-11-01", durationMonths: 2 }], communityResults: [{ discordUserId: "member", categoryId: source.id, state: "joined", membershipStatus: "present", replacementHistoryUserIds: ["previous"], details: "Original delivery" }] };

test("moving a category preserves support, delivery, member history, links and completed leave claims", () => {
  const original = structuredClone(base);
  const { order } = planCommunityOrderCategoryTransfer(base, source, target, "2026-11-20");
  assert.equal(order.categoryId, target.id);
  assert.equal(order.stockType, target.id);
  assert.equal(order.categoryName, target.name);
  assert.equal(order.categoryAllocations[0].categoryId, target.id);
  assert.equal(order.communityResults[0].categoryId, target.id);
  for (const key of ["createdAt", "expiredAt", "durationMonths", "amount", "added", "serverId", "monitorToken", "membersLeftAt", "autoLeaveJob"]) assert.deepEqual(order[key], base[key], key);
  for (const key of ["isPeriodic", "expiredAt", "durationMonths", "amount", "added"]) assert.deepEqual(order.categoryAllocations[0][key], base.categoryAllocations[0][key], key);
  for (const key of ["discordUserId", "state", "membershipStatus", "replacementHistoryUserIds", "details"]) assert.deepEqual(order.communityResults[0][key], base.communityResults[0][key], key);
  assert.deepEqual(base, original, "planner does not mutate its input");
  assert.equal(planCommunityOrderCategoryTransfer(order, source, target, "later").matched, false, "repeat transfer does not duplicate history");
});

test("legacy orders and mixed categories retain their original deadlines", () => {
  const legacy = { ...base, categoryAllocations: undefined, communityResults: [{ discordUserId: "legacy", state: "joined" }] };
  assert.equal(planCommunityOrderCategoryTransfer(legacy, source, target, "now").order.communityResults[0].categoryId, target.id);
  const other = { categoryId: "other", amount: 10, isPeriodic: true, expiredAt: "2027-01-01" };
  const mixed = { ...base, categoryAllocations: [...base.categoryAllocations, other], communityResults: [...base.communityResults, { discordUserId: "other-member", categoryId: "other" }] };
  const result = planCommunityOrderCategoryTransfer(mixed, source, target, "now").order;
  assert.deepEqual(result.categoryAllocations[1], other);
  assert.deepEqual(result.communityResults[1], mixed.communityResults[1]);
  assert.equal(result.categoryName, "2 categories");
  assert.ok(planCommunityOrderCategoryTransfer({ ...mixed, categoryAllocations: [...mixed.categoryAllocations, { categoryId: target.id, expiredAt: "2027-02-01" }] }, source, target, "now").blocked, "existing target support must not be merged");
});

test("active operations and unrelated providers are not rewritten", () => {
  for (const status of ["NEW", "PROCESS", "RECOVERING", "WAITING", "PAUSED", "INVITES PAUSED"]) assert.ok(planCommunityOrderCategoryTransfer({ ...base, status }, source, target, "now").blocked);
  assert.ok(planCommunityOrderCategoryTransfer({ ...base, autoLeaveJob: { status: "running" } }, source, target, "now").blocked);
  assert.equal(planCommunityOrderCategoryTransfer({ ...base, provider: "dcord" }, source, target, "now").matched, false);
});

function endpoint({ busy = false, failUpdate = false } = {}) {
  let payload = structuredClone(base);
  const log = [];
  const transfers = new Set();
  const client = { release() { log.push("release"); }, async query(sql, values) {
    log.push(sql);
    if (sql.startsWith("SELECT id, name")) return { rows: [source, target], rowCount: 2 };
    if (sql.includes("SELECT uniqid, payload")) return { rows: [{ uniqid: payload.uniqid, payload, updated_at: "2026-11-19" }], rowCount: 1 };
    if (sql.startsWith("SELECT order_id")) return { rows: [] };
    if (sql.includes("UPDATE tracked_orders AS orders")) {
      assert.ok(transfers.has(base.uniqid), "order is guarded during mutation");
      if (failUpdate) throw new Error("write failed");
      payload = JSON.parse(values[0])[0].payload;
    }
    return { rows: [], rowCount: 1 };
  } };
  const handler = createCommunityOrderCategoryTransferHandler({ pool: { connect: async () => client }, getConfig: async () => ({ configured: true, guildId: "stock", clientId: "application" }), transfers, isBusy: () => busy });
  async function request(body) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { categoryId: source.id }, body: { targetCategoryId: target.id, ...body } }, response, (error) => { response.error = error; });
    return response;
  }
  return { request, log, transfers, payload: () => payload };
}

test("preview does not write; apply requires that exact preview and releases guards", async () => {
  const api = endpoint();
  const preview = await api.request({});
  assert.equal(preview.body.transferable, 1);
  assert.ok(!api.log.some((sql) => sql.includes("UPDATE tracked_orders")));
  assert.equal((await api.request({ apply: true, previewToken: "stale" })).statusCode, 409);
  assert.equal(api.payload().categoryId, source.id);
  const applied = await api.request({ apply: true, previewToken: preview.body.previewToken });
  assert.equal(applied.body.moved, 1);
  assert.equal(api.payload().categoryId, target.id);
  assert.equal(api.transfers.size, 0);
});

test("busy orders stay unchanged and write failures roll back and clear guards", async () => {
  const busy = endpoint({ busy: true });
  const preview = await busy.request({});
  assert.equal(preview.body.blockedCount, 1);
  assert.equal(preview.body.transferable, 0);
  assert.equal((await busy.request({ apply: true, previewToken: preview.body.previewToken })).body.moved, 0);
  assert.equal(busy.payload().categoryId, source.id);
  const failing = endpoint({ failUpdate: true });
  const initial = await failing.request({});
  assert.ok((await failing.request({ apply: true, previewToken: initial.body.previewToken })).error);
  assert.ok(failing.log.includes("ROLLBACK"));
  assert.equal(failing.transfers.size, 0);
  assert.equal(failing.log.at(-1), "release");
});
