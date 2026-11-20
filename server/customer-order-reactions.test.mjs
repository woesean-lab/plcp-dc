import test from "node:test";
import assert from "node:assert/strict";
import { customerReactionDay, customerReactionMemberEligible, getCustomerReactionSummary, validateCustomerReactionLimit } from "./customer-order-reactions.mjs";
import { createCommunityReactionMessageHandler } from "./community-reaction-message.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { CUSTOMER_REACTION_SAVE_FIELDS_SQL } from "./customer-order-reactions.mjs";

const now = Date.parse("2026-11-20T20:59:59Z");
const base = { uniqid: "sample", provider: "community", status: "COMPLETED", serverId: "server", categoryId: "online", reactionDailyLimit: 50, reactionCapacity: 50,
  categoryAllocations: [{ categoryId: "online", allocationId: "active", reactionUseEnabled: true, isPeriodic: true, expiredAt: "2099-01-01" }],
  communityResults: [{ discordUserId: "one", categoryId: "online", allocationId: "active", state: "joined" }], reactionRequests: [] };
const request = (states, date = "2026-11-20T20:00:00Z", source = "customer") => ({ id: "request", source, messageLink: "message", requestedCount: states.length, createdAt: date,
  assignments: states.map((reactionState) => ({ discordUserId: "private-member", reactionState, reactionEmoji: "👍" })) });

test("customer reactions require order opt-in, category permission and active support", () => {
  assert.equal(getCustomerReactionSummary(base, now).enabled, true);
  assert.equal(getCustomerReactionSummary({ ...base, reactionDailyLimit: 0 }, now).enabled, false);
  for (const patch of [{ reactionUseEnabled: false }, { isPeriodic: false }, { expiredAt: new Date(now).toISOString() }]) {
    const order = { ...base, categoryAllocations: [{ ...base.categoryAllocations[0], ...patch }] };
    assert.equal(getCustomerReactionSummary(order, now).enabled, false);
    assert.equal(customerReactionMemberEligible(order, order.communityResults[0], now), false);
  }
  assert.equal(getCustomerReactionSummary({ ...base, status: "PROCESS" }, now).ready, false);
  assert.equal(customerReactionMemberEligible(base, { ...base.communityResults[0], membershipStatus: "removed" }, now), false);
  assert.equal(customerReactionMemberEligible(base, { ...base.communityResults[0], allocationId: "unrelated" }, now), false);
});

test("daily limits reset at midnight in Türkiye and count only customer reservations", () => {
  const order = { ...base, reactionRequests: [request(["completed", "pending", "failed", "cancelled"]), request(["completed"], "2026-11-19T20:00:00Z"), request(["pending"], undefined, "admin")] };
  const summary = getCustomerReactionSummary(order, now);
  assert.equal(customerReactionDay(now), "2026-11-20");
  assert.equal(summary.used, 2);
  assert.equal(summary.remaining, 48);
  assert.equal(summary.completed, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.resetsAt, "2026-11-20T21:00:00.000Z");
  assert.equal(getCustomerReactionSummary(order, now + 1000).remaining, 50);
  assert.equal(JSON.stringify(summary).includes("private-member"), false, "customer history contains no member identifiers");
});

test("shared-pool portions retain their individual support and category eligibility", () => {
  const order = { ...base, categoryAllocations: [...base.categoryAllocations,
    { ...base.categoryAllocations[0], allocationId: "expired", expiredAt: "2026-11-01" },
    { ...base.categoryAllocations[0], allocationId: "disabled", reactionUseEnabled: false }],
    communityResults: ["active", "expired", "disabled"].map((allocationId) => ({ ...base.communityResults[0], discordUserId: allocationId, allocationId })) };
  assert.deepEqual(order.communityResults.map((member) => customerReactionMemberEligible(order, member, now)), [true, false, false]);
  assert.equal(getCustomerReactionSummary(order, now).eligibleMembers, 1);
});

test("creation accepts presets only for enabled categories with a support period", () => {
  const categories = [{ reaction_use_enabled: true, is_periodic: true }];
  for (const limit of [50, 100, 200, 500]) assert.equal(validateCustomerReactionLimit(categories, limit), limit);
  assert.equal(validateCustomerReactionLimit([], undefined), 0);
  for (const value of ["50", -1, 51, 1.5]) assert.throws(() => validateCustomerReactionLimit(categories, value));
  assert.throws(() => validateCustomerReactionLimit([{ reaction_use_enabled: true, is_periodic: false }], 50));
  assert.throws(() => validateCustomerReactionLimit([{ reaction_use_enabled: false, is_periodic: true }], 50));
});

function endpoint(initial = base, hydrate = (order) => order) {
  let payload = structuredClone(initial);
  let lock = Promise.resolve();
  const jobs = [];
  const pool = { async connect() {
    let unlock;
    return { release() { unlock?.(); }, async query(sql, values) {
      if (sql.includes("FOR UPDATE")) {
        const previous = lock;
        lock = new Promise((resolve) => { unlock = resolve; });
        await previous;
        return { rows: [{ payload: structuredClone(payload) }] };
      }
      if (sql.startsWith("UPDATE tracked_orders")) payload = JSON.parse(values[1]);
      if (sql.includes("INSERT INTO community_reaction_jobs")) jobs.push(values);
      if (sql === "COMMIT" || sql === "ROLLBACK") { unlock?.(); unlock = undefined; }
      return { rows: [], rowCount: 1 };
    } };
  } };
  let assignedMembers = [];
  const handler = createCommunityReactionMessageHandler({ pool, hydrateCommunityOrderCategories: hydrate,
    parseDiscordMessageLink: (url) => ({ guildId: url === "other-server" ? "other" : "server", url, channelId: "channel", messageId: "message" }),
    communityReactionEmojiLimit: 20, isCommunityReactionEmoji: (emoji) => emoji === "👍", isCommunityCustomReactionSelector: () => false,
    createNaturalCommunityReactionAssignments(members, count) {
      assignedMembers = members;
      return Array.from({ length: count }, (_, i) => ({ discordUserId: members[i % members.length].discordUserId, reactionEmoji: `emoji-${i}`, reactionState: "pending" }));
    }, sanitizePublicCommunityOrder: (order) => ({ customerReactions: getCustomerReactionSummary(order) })
  });
  async function send(count, { admin = false, messageLink = "message" } = {}) {
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { uniqid: payload.uniqid }, path: admin ? "/api/community/orders/sample/reaction-message" : "/api/public/orders/sample/reaction-message",
      body: { messageLink, reactionCount: count, emojis: ["mixed"] } }, response, (error) => { response.error = error; });
    assert.equal(response.error, undefined);
    return response;
  }
  return { send, jobs, payload: () => payload, assignedMembers: () => assignedMembers };
}

test("direct customer API calls cannot bypass disabled categories, support expiry or order opt-in", async () => {
  for (const order of [{ ...base, reactionDailyLimit: 0 }, { ...base, categoryAllocations: [{ ...base.categoryAllocations[0], expiredAt: "2000-01-01" }] }]) {
    const api = endpoint(order);
    assert.equal((await api.send(1)).statusCode, 403);
    assert.equal(api.jobs.length, 0);
  }
  const disabled = endpoint(base, (order) => ({ ...order, categoryAllocations: [{ ...order.categoryAllocations[0], reactionUseEnabled: false }] }));
  assert.equal((await disabled.send(1)).statusCode, 403, "current category settings override the saved snapshot");
  assert.equal((await endpoint().send(1, { messageLink: "other-server" })).statusCode, 400);
});

test("concurrent customer requests reserve the daily allowance under the existing order lock", async () => {
  const api = endpoint({ ...base, communityResults: Array.from({ length: 3 }, (_, i) => ({ ...base.communityResults[0], discordUserId: String(i) })) });
  const responses = await Promise.all([api.send(30), api.send(30)]);
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 400]);
  assert.equal(api.jobs.length, 30);
  assert.equal(api.payload().reactionRequests[0].source, "customer");
  assert.equal(getCustomerReactionSummary(api.payload()).remaining, 20);
  assert.equal((await api.send(20)).statusCode, 200);
  assert.equal((await api.send(1)).statusCode, 400);
  assert.equal(api.jobs.length, 50);
});

test("customer assignments stay within their active order portion; admin flow stays available", async () => {
  const mixed = { ...base, categoryAllocations: [...base.categoryAllocations, { ...base.categoryAllocations[0], allocationId: "expired", expiredAt: "2000-01-01" }],
    communityResults: [...base.communityResults, { ...base.communityResults[0], discordUserId: "expired", allocationId: "expired" }] };
  const api = endpoint(mixed);
  assert.equal((await api.send(1)).statusCode, 200);
  assert.deepEqual(api.assignedMembers().map((member) => member.discordUserId), ["one"]);
  const admin = endpoint({ ...base, reactionDailyLimit: 0 });
  assert.equal((await admin.send(1, { admin: true })).statusCode, 200);
  assert.equal(admin.payload().reactionRequests[0].source, undefined);
});

const pgRuntime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
test("member-check upserts preserve current reaction reservations and their progress in PostgreSQL", { skip: !fs.existsSync(fileURLToPath(pgRuntime)) }, async () => {
  const { PGlite } = await import(pgRuntime.href);
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE tracked_orders (uniqid text PRIMARY KEY, payload jsonb NOT NULL)");
    const current = { ...structuredClone(base), reactionRequests: [request(["completed", "pending"])] };
    await db.query("INSERT INTO tracked_orders VALUES ($1, $2::jsonb)", [current.uniqid, JSON.stringify(current)]);
    const stale = { ...structuredClone(base), added: 99, reactionDailyLimit: 0, reactionRequests: [] };
    const saved = await db.query(`INSERT INTO tracked_orders VALUES ($1, $2::jsonb)
      ON CONFLICT (uniqid) DO UPDATE SET payload = EXCLUDED.payload || ${CUSTOMER_REACTION_SAVE_FIELDS_SQL} RETURNING payload`, [stale.uniqid, JSON.stringify(stale)]);
    assert.equal(saved.rows[0].payload.added, 99, "member-check/delivery changes still save");
    assert.equal(saved.rows[0].payload.reactionDailyLimit, 50);
    assert.deepEqual(saved.rows[0].payload.reactionRequests, current.reactionRequests);
  } finally { await db.close(); }
});
