import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRotatingBoostStock, refreshRotatingRows, syncRotatingOrder, tokenIdentity, BOOST_PERIOD_MS, BOOST_SUBSCRIPTION_MS } from "./rotating-boost-stock.mjs";

import { createRotatingTokenChecker } from "./rotating-token-check.mjs";

const day = 86400_000;
const later = (days) => new Date(Date.now() + days * day).toISOString();

// Transactional in-memory SQL adapter: exercises inventory operations without a live database.
function fixture() {
  const settings = new Map();
  const orders = new Map();
  const assignments = new Map();
  let queue = Promise.resolve();
  let failInventoryWrite = false;
  const pool = {
    async connect() {
      let unlock;
      let writes = new Map();
      return {
        async query(sql, args = []) {
          if (sql === "BEGIN") return { rows: [] };
          if (sql.includes("pg_advisory_xact_lock")) {
            const previous = queue;
            queue = new Promise((resolve) => { unlock = resolve; });
            await previous;
            return { rows: [] };
          }
          if (sql === "COMMIT" || sql === "ROLLBACK") {
            if (sql === "COMMIT") writes.forEach((value, key) => settings.set(key, value));
            writes = new Map(); unlock?.();
            return { rows: [] };
          }
          if (sql.startsWith("SELECT encrypted_value")) {
            const value = settings.get(args[0]);
            return { rows: value ? [{ encrypted_value: value }] : [] };
          }
          if (sql.includes("INSERT INTO app_settings")) {
            if (args[0] === "dcord_rotating_boost_stock" && failInventoryWrite) {
              failInventoryWrite = false;
              throw new Error("Inventory write failed");
            }
            writes.set(args[0], args[1]);
            return { rows: [] };
          }
          if (sql.includes("FROM tracked_orders")) {
            const ids = Array.isArray(args[0]) ? args[0] : [args[0]];
            return { rows: ids.filter((id) => orders.has(id)).map((id) => ({ payload: orders.get(id) })) };
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() {}
      };
    }
  };
  const reopen = () => createRotatingBoostStock({ pool, encrypt: (text) => Buffer.from(text).toString("base64"), decrypt: (text) => Buffer.from(text, "base64").toString(), loadOrderAssignment: async (orderId) => assignments.get(orderId) });
  const stock = reopen();
  const read = () => JSON.parse(Buffer.from(settings.get("dcord_rotating_boost_stock"), "base64").toString());
  const write = (rows) => settings.set("dcord_rotating_boost_stock", Buffer.from(JSON.stringify(rows)).toString("base64"));
  const seed = async (tokens, expiresAt) => {
    const rows = settings.has("dcord_rotating_boost_stock") ? read() : [];
    for (const token of tokens) rows.push({ id: crypto.randomUUID(), fingerprint: crypto.createHash("sha256").update(tokenIdentity(token)).digest("hex"), token, subscriptionStartedAt: new Date(Date.parse(expiresAt) - BOOST_SUBSCRIPTION_MS).toISOString(), expiresAt, status: "available", history: [], createdAt: new Date().toISOString() });
    write(rows);
    return stock.list();
  };
  const seedRegular = (value) => settings.set("dcord_boost_token_stock", Buffer.from(JSON.stringify(value)).toString("base64"));
  const readRegular = () => JSON.parse(Buffer.from(settings.get("dcord_boost_token_stock"), "base64").toString());
  return { stock, seed, seedRegular, readRegular, orders, assignments, reopen, read, write, settings, failNextInventoryWrite: () => { failInventoryWrite = true; } };
}

test("removal leaves other stock and legacy proxy settings untouched", async () => {
  const f = fixture();
  const [first, second] = await f.seed(["one", "two"], later(90));
  const rows = f.read(); rows[0].proxy = "http://assigned:8080"; f.write(rows);
  let callbackToken;
  await f.stock.remove(first.id, async (row) => { callbackToken = row.token; });
  assert.equal(callbackToken, "one");
  assert.deepEqual((await f.stock.list()).map((row) => row.id), [second.id]);
  assert.equal(f.settings.has("dcord_rotating_boost_proxies"), false);
});

test("accounts can be removed in every status without changing order history", async () => {
  for (const status of ["available", "reserved", "in_use", "review", "expired"]) {
    const f = fixture();
    const [first, second] = await f.seed(["one", "two"], later(90));
    const order = { uniqid: "active-order", status: "COMPLETED", added: 2, dcordResults: [{ boosted: true, status: "success" }] };
    f.orders.set(order.uniqid, structuredClone(order));
    const rows = f.read();
    Object.assign(rows[0], { status, orderId: order.uniqid, orderIndex: 0, customerEndsAt: later(20), tokenCheck: { status: "running", jobId: "check-job" } });
    f.write(rows);
    await f.stock.remove(first.id);
    assert.deepEqual((await f.stock.list()).map(row => row.id), [second.id]);
    assert.deepEqual(f.orders.get(order.uniqid), order);
    assert.equal(await f.stock.canSubmit(order.uniqid, "one"), false);
    await f.stock.sync(order);
    assert.deepEqual((await f.stock.list()).map(row => row.id), [second.id]);
    assert.deepEqual(await f.stock.reserveForDelivery(1, { uniqid: "new-order" }), { tokens: ["two"], proxies: [] });
  }
});

test("failed cleanup rolls back removal even for an in-use account", async () => {
  const f = fixture(); const [row] = await f.seed(["one"], later(90));
  const rows = f.read(); Object.assign(rows[0], { status: "in_use", customerEndsAt: later(20) }); f.write(rows);
  await assert.rejects(f.stock.remove(row.id, async () => { throw new Error("cleanup failed"); }), /cleanup failed/);
  assert.equal(f.read()[0].id, row.id); assert.equal(f.read()[0].status, "in_use");
});

test("moving deduplicates account identities without starting the clock and removes source tokens", async () => {
  const { stock, seedRegular, readRegular, settings } = fixture();
  seedRegular({ oneMonth: ["one-month"], threeMonth: ["account-token", "mail:pass:account-token:2fa", "keep-token"] });
  const { accounts: rows, stock: summary } = await stock.moveFromThreeMonth(1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "available");
  assert.equal("token" in rows[0], false);
  assert.equal(JSON.stringify(rows).includes("mail:pass"), false);
  assert.equal(settings.get("dcord_rotating_boost_stock").includes("account-token"), false);
  assert.equal(rows[0].expiresAt, null);
  assert.equal(rows[0].subscriptionStartedAt, null);
  assert.deepEqual(summary, { oneMonth: 1, threeMonth: 1 });
  assert.deepEqual(readRegular(), { oneMonth: ["one-month"], threeMonth: ["keep-token"] });
});

test("stock waiting time does not count; first assignment starts 90 days and reuse preserves expiry", async (t) => {
  let clock = Date.now();
  t.mock.method(Date, "now", () => clock);
  const { stock, seedRegular } = fixture();
  seedRegular({ oneMonth: [], threeMonth: ["token"] });
  await stock.moveFromThreeMonth(1);
  clock += 120 * day;
  const [waiting] = await stock.list();
  assert.equal(waiting.status, "available");
  assert.equal(waiting.expiresAt, null);
  await stock.reserve(1, { uniqid: "first" });
  const [assigned] = await stock.list();
  assert.equal(Date.parse(assigned.subscriptionStartedAt), clock);
  assert.equal(Date.parse(assigned.expiresAt), clock + BOOST_SUBSCRIPTION_MS);
  await stock.sync({ uniqid: "first", dcordResults: [{ boosted: true, status: "success" }] });
  clock += BOOST_PERIOD_MS;
  await stock.reserve(1, { uniqid: "second" });
  const [reused] = await stock.list();
  assert.equal(reused.expiresAt, assigned.expiresAt);
  assert.equal(reused.subscriptionStartedAt, assigned.subscriptionStartedAt);
});

test("legacy unused clocks are cleared while assigned clocks start from the known assignment", () => {
  const now = Date.now();
  const assignedAt = now - day;
  const rows = refreshRotatingRows([
    { status: "expired", expiresAt: new Date(now - day).toISOString(), history: [] },
    { status: "reserved", orderId: "o", reservedAt: new Date(assignedAt).toISOString(), expiresAt: later(60), history: [] }
  ], now);
  assert.equal(rows[0].status, "available");
  assert.equal(rows[0].expiresAt, null);
  assert.equal(Date.parse(rows[1].expiresAt), assignedAt + BOOST_SUBSCRIPTION_MS);
  assert.equal(Date.parse(rows[1].subscriptionStartedAt), assignedAt);
});

test("invalid counts and insufficient source stock leave both inventories unchanged", async () => {
  const { stock, seedRegular, readRegular } = fixture();
  const original = { oneMonth: ["one-month"], threeMonth: ["only-token"] };
  seedRegular(original);
  for (const count of [0, -1, 1.5, "1", 1001]) {
    await assert.rejects(stock.moveFromThreeMonth(count), /between 1 and 1000/);
  }
  await assert.rejects(stock.moveFromThreeMonth(2), /Only 1/);
  assert.deepEqual(readRegular(), original);
  assert.deepEqual(await stock.list(), []);
});

test("a destination write failure rolls back source removal", async () => {
  const { stock, seedRegular, readRegular, failNextInventoryWrite } = fixture();
  const original = { oneMonth: ["one"], threeMonth: ["three"] };
  seedRegular(original);
  failNextInventoryWrite();
  await assert.rejects(stock.moveFromThreeMonth(1), /Inventory write failed/);
  assert.deepEqual(readRegular(), original);
  assert.deepEqual(await stock.list(), []);
  assert.equal((await stock.moveFromThreeMonth(1)).accounts.length, 1);
});

test("concurrent moves cannot transfer the same source account twice", async () => {
  const { stock, seedRegular, readRegular } = fixture();
  seedRegular({ oneMonth: [], threeMonth: ["three"] });
  const results = await Promise.allSettled([stock.moveFromThreeMonth(1), stock.moveFromThreeMonth(1)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await stock.list()).length, 1);
  assert.deepEqual(readRegular().threeMonth, []);
});

test("moving skips identities already in rotating or one-month stock", async () => {
  const { stock, seed, seedRegular, readRegular } = fixture();
  const [original] = await seed(["existing"], later(40));
  seedRegular({ oneMonth: ["one"], threeMonth: ["m:p:existing:2fa", "one", "fresh"] });
  const result = await stock.moveFromThreeMonth(1);
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts.find((row) => row.id === original.id).expiresAt, original.expiresAt);
  assert.deepEqual(readRegular(), { oneMonth: ["one"], threeMonth: ["m:p:existing:2fa", "one"] });
});

test("concurrent orders cannot reserve the same account", async () => {
  const { stock, seed } = fixture();
  await seed(["only-token"], later(90));
  const results = await Promise.allSettled([
    stock.reserve(1, { uniqid: "order-a" }), stock.reserve(1, { uniqid: "order-b" })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await stock.list())[0].status, "reserved");
});

test("earliest expiry is used first and a failed reservation leaves all accounts untouched", async () => {
  const { stock, seed } = fixture();
  await seed(["long-token"], later(90));
  await seed(["short-token"], later(40));
  await assert.rejects(stock.reserve(3, { uniqid: "too-large" }), /Only 4/);
  assert.equal((await stock.list()).filter((row) => row.status === "available").length, 2);
  assert.deepEqual(await stock.reserve(1, { uniqid: "valid" }), ["short-token"]);
});

test("successful delivery starts 30 days once and automatically becomes available at expiry", async () => {
  const now = Date.now();
  const rows = [{ orderId: "o", orderIndex: 0, status: "reserved", expiresAt: later(90) }];
  const order = { uniqid: "o", dcordResults: [{ status: "success", boosted: true, boostCount: 2 }] };
  syncRotatingOrder(rows, order, now);
  assert.equal(rows[0].status, "in_use");
  assert.equal(Date.parse(rows[0].customerEndsAt), now + BOOST_PERIOD_MS);
  syncRotatingOrder(rows, order, now + day);
  assert.equal(Date.parse(rows[0].customerEndsAt), now + BOOST_PERIOD_MS);
  const expired = refreshRotatingRows(rows, now + BOOST_PERIOD_MS);
  assert.equal(expired[0].status, "available");
  assert.equal(expired[0].orderId, null);
  assert.equal(expired[0].history.length, 1);
  syncRotatingOrder(expired, order, now + BOOST_PERIOD_MS + day);
  assert.equal(expired[0].status, "available");
  assert.equal(expired[0].history.length, 1);
});

test("pending and uncertain deliveries remain reserved; terminal failures need review", () => {
  for (const result of [{ status: "pending" }, { status: "error", transportUncertain: true }, { status: "error", taskPending: true }, { status: "error", providerBlocked: true }]) {
    const rows = [{ orderId: "o", orderIndex: 0, status: "reserved" }];
    syncRotatingOrder(rows, { uniqid: "o", dcordResults: [result] });
    assert.equal(rows[0].status, "reserved");
  }
  const rows = [{ orderId: "o", orderIndex: 0, status: "reserved" }];
  syncRotatingOrder(rows, { uniqid: "o", dcordResults: [{ status: "failed" }] });
  assert.equal(rows[0].status, "review");
});

test("recovery preserves actual delivery time and partial delivery holds the account", () => {
  const now = Date.now();
  const rows = [{ orderId: "o", orderIndex: 0, status: "reserved", expiresAt: later(90) }];
  syncRotatingOrder(rows, { uniqid: "o", dcordResults: [{ status: "partial", boostCount: 1, deliveredAt: new Date(now - 2 * day).toISOString() }] }, now);
  assert.equal(rows[0].status, "in_use");
  assert.equal(Date.parse(rows[0].customerEndsAt), now + 28 * day);
});

test("elapsed periods automatically release and preserve history before the next reservation", async () => {
  const { stock, seed, read, write } = fixture();
  await seed(["token"], later(90));
  await stock.reserve(1, { uniqid: "o", serverName: "Customer" });
  await stock.sync({ uniqid: "o", dcordResults: [{ status: "success", boosted: true }] });
  await assert.rejects(stock.reserve(1, { uniqid: "too-early" }), /Only 0/);
  const elapsed = read(); elapsed[0].customerEndsAt = later(-1); write(elapsed);
  // Reservation itself releases expired periods, even without a panel refresh.
  assert.deepEqual(await stock.reserve(1, { uniqid: "next" }), ["token"]);
  const [released] = await stock.list();
  assert.equal(released.status, "reserved");
  assert.equal(released.orderId, "next");
  assert.equal(released.history[0].orderId, "o");
  await stock.sync({ uniqid: "o", dcordResults: [{ status: "success", boosted: true }] });
  assert.equal((await stock.list())[0].status, "reserved");
});

test("previously persisted review rows with elapsed periods are automatically migrated", async () => {
  const { stock, seed, read, write } = fixture();
  await seed(["token"], later(90));
  await stock.reserve(1, { uniqid: "o" });
  const rows = read();
  Object.assign(rows[0], { status: "review", customerEndsAt: later(-1) });
  write(rows);
  const [released] = await stock.list();
  assert.equal(released.status, "available");
  assert.equal(released.orderId, null);
  assert.equal(released.history[0].orderId, "o");
  assert.equal((await stock.list())[0].history.length, 1);
});

test("releasing an account with too little time retires it instead of reselling", async () => {
  const { stock, seed, read, write } = fixture();
  await seed(["token"], later(40));
  await stock.reserve(1, { uniqid: "o" });
  await stock.sync({ uniqid: "o", dcordResults: [{ status: "success", boosted: true }] });
  const rows = read(); rows[0].expiresAt = later(20); rows[0].customerEndsAt = later(-1); write(rows);
  const [released] = await stock.list();
  assert.equal(released.status, "expired");
  await assert.rejects(stock.reserve(1, { uniqid: "next" }), /Only 0/);
});

test("cancellation stays in separate review pool; legacy saves reject rotating identities", async () => {
  const { stock, seed, settings } = fixture();
  await seed(["token"], later(90));
  await stock.reserve(1, { uniqid: "o" });
  assert.equal(await stock.release("o", ["token"]), 1);
  assert.equal((await stock.list())[0].status, "review");
  await assert.rejects(stock.saveLegacyStock({ oneMonth: ["m:p:token:2fa"], threeMonth: [] }), /Rotating accounts/);
  const original = { oneMonth: ["regular"], threeMonth: ["regular-three"] };
  assert.deepEqual(await stock.saveLegacyStock(original), original);
  assert.deepEqual(JSON.parse(Buffer.from(settings.get("dcord_boost_token_stock"), "base64").toString()), original);
});

test("restart recovers persisted delivery results and orphan reservations", async () => {
  const { stock, seed, orders, read, write } = fixture();
  await seed(["delivered", "orphan"], later(90));
  await stock.reserve(1, { uniqid: "o" });
  await stock.reserve(1, { uniqid: "orphan-order" });
  orders.set("o", { uniqid: "o", status: "COMPLETED", dcordResults: [{ boosted: true, status: "success" }] });
  const rows = read(); rows[1].reservedAt = new Date(Date.now() - 11 * 60_000).toISOString(); write(rows);
  const recovered = await stock.list();
  assert.equal(recovered[0].status, "in_use");
  assert.equal(recovered[1].status, "review");
});

test("an aged reservation cannot submit and a failed setup can be safely rolled back", async () => {
  const { stock, seed, read, write } = fixture();
  await seed(["token"], later(40));
  await stock.reserve(1, { uniqid: "o" });
  assert.equal(await stock.canSubmit("o", "token"), true);
  await stock.abortUnsubmitted("o");
  assert.equal((await stock.list())[0].status, "available");
  await stock.reserve(1, { uniqid: "next" });
  const rows = read(); rows[0].expiresAt = later(29); write(rows);
  assert.equal(await stock.canSubmit("next", "token"), false);
  assert.equal((await stock.list())[0].status, "review");
});

test("concurrent replacement requests cannot reserve two accounts for one slot", async () => {
  const { stock, seed } = fixture();
  await seed(["a", "b"], later(90));
  const results = await Promise.allSettled([stock.reserve(1, { uniqid: "same" }, 2), stock.reserve(1, { uniqid: "same" }, 2)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await stock.list()).filter((row) => row.status === "available").length, 1);
});


test("admin inventory can read complete tokens without exposing fingerprints or changing default redaction", async () => {
  const { stock, seedRegular, read, write } = fixture();
  const token = "mail:pass:complete-account-token:2fa";
  seedRegular({ oneMonth: [], threeMonth: [token] });
  await stock.moveFromThreeMonth(1);
  const proxy = "http://user:secret@fixed.example:8080";
  const rows = read(); rows[0].proxy = proxy; write(rows);
  const [admin] = await stock.list({ includeTokens: true });
  assert.equal(admin.token, token);
  assert.equal("proxy" in admin, false);
  assert.equal("fingerprint" in admin, false);
  const [redacted] = await stock.list();
  assert.equal("token" in redacted, false);
  assert.equal("proxy" in redacted, false);
  assert.equal("fingerprint" in redacted, false);
  assert.equal(redacted.redactedToken, admin.redactedToken);
});


test("delivery reserves without proxies and reuses the account after restart", async t => {
  let clock = Date.now(); t.mock.method(Date, "now", () => clock);
  const f = fixture(); f.seedRegular({ oneMonth: [], threeMonth: ["token"] });
  f.settings.set("dcord_rotating_boost_proxies", "legacy-encrypted-data");
  await f.stock.moveFromThreeMonth(1);
  assert.deepEqual(await f.stock.reserveForDelivery(1, { uniqid: "first" }), { tokens: ["token"], proxies: [] });
  await f.stock.sync({ uniqid: "first", dcordResults: [{ boosted: true, status: "success" }] });
  clock += BOOST_PERIOD_MS;
  assert.deepEqual(await f.reopen().reserveForDelivery(1, { uniqid: "second" }), { tokens: ["token"], proxies: [] });
  assert.equal(f.settings.get("dcord_rotating_boost_proxies"), "legacy-encrypted-data");
});

test("legacy proxy bindings are neither restored, returned nor required for delivery", async () => {
  const f = fixture(); await f.seed(["unbound", "bound"], later(90));
  const rows = f.read(); rows[1].proxy = "http://secret:password@old.example:8080"; f.write(rows);
  assert.deepEqual(await f.stock.reserveForDelivery(2, { uniqid: "order" }), { tokens: ["unbound", "bound"], proxies: [] });
  assert.ok(!JSON.stringify(await f.stock.list({ includeTokens: true })).includes("old.example"));
  assert.equal(f.read()[0].proxy, undefined);
});

test("proxyless concurrent delivery reservations remain exclusive and writes roll back", async () => {
  const f = fixture(); await f.seed(["token"], later(90));
  f.failNextInventoryWrite();
  await assert.rejects(f.stock.reserveForDelivery(1, { uniqid: "failed" }), /Inventory write failed/);
  assert.equal(f.read()[0].status, "available");
  const results = await Promise.allSettled([f.stock.reserveForDelivery(1, { uniqid: "a" }), f.stock.reserveForDelivery(1, { uniqid: "b" })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
});

test("check claims prevent simultaneous submissions and persist results without changing assignment", async () => {
  const f = fixture(); const [row] = await f.seed(["token"], later(90));
  await f.stock.reserveForDelivery(1, { uniqid: "active" });
  const before = f.read()[0]; let calls = 0;
  const client = { createTokenCheck: async () => { calls++; return "job"; }, getTokenCheck: async () => ({ status: "valid", nitroDays: 55, boostFree: 0 }) };
  const service = createRotatingTokenChecker({ stock: f.stock, client });
  const results = await Promise.allSettled([service.start(row.id), service.start(row.id)]);
  assert.equal(calls, 1); assert.equal(results.filter(result => result.status === "rejected")[0].reason.statusCode, 409);
  await createRotatingTokenChecker({ stock: f.reopen(), client }).refresh();
  const after = f.read()[0]; const { tokenCheck, ...assignment } = after;
  assert.deepEqual(assignment, before); assert.equal(tokenCheck.status, "valid"); assert.equal(tokenCheck.boostFree, 0);
  const publicResult = (await f.stock.list())[0].tokenCheck;
  assert.ok(!("jobId" in publicResult)); assert.ok(!("requestId" in publicResult)); assert.ok(!("polledAt" in publicResult));
});

test("poll failures keep the saved job and can recover without resubmission", async () => {
  const f = fixture(); const [row] = await f.seed(["token"], later(90)); let clock = Date.now(); let calls = 0; let fail = true;
  const client = { createTokenCheck: async () => { calls++; return "job"; }, getTokenCheck: async id => { assert.equal(id, "job"); if (fail) throw new Error("offline"); return { status: "invalid" }; } };
  const service = createRotatingTokenChecker({ stock: f.stock, client, now: () => clock });
  await service.start(row.id); await service.refresh(); assert.equal(f.read()[0].tokenCheck.status, "running");
  await assert.rejects(service.start(row.id), { statusCode: 409 });
  fail = false; clock += 5000; await service.refresh();
  assert.equal(f.read()[0].tokenCheck.status, "invalid"); assert.equal(f.read()[0].status, "available"); assert.equal(calls, 1);
});

test("unconfirmed and interrupted submissions do not immediately consume another check", async () => {
  const f = fixture(); const [row] = await f.seed(["token"], later(90)); let clock = Date.now(); let calls = 0;
  const service = createRotatingTokenChecker({ stock: f.stock, now: () => clock, client: { createTokenCheck: async () => { calls++; throw Object.assign(new Error("network"), { uncertain: true }); } } });
  await assert.rejects(service.start(row.id)); await assert.rejects(service.start(row.id), { statusCode: 409 }); assert.equal(calls, 1);
  clock += 600001; await assert.rejects(service.start(row.id)); assert.equal(calls, 2);
  const rows = f.read(); rows[0].tokenCheck.status = "submitting"; f.write(rows);
  clock += 61000; await service.refresh(); assert.equal(f.read()[0].tokenCheck.status, "unknown");
});

test("an accepted check survives one transient job-ID persistence failure", async () => {
  const f = fixture(); const [row] = await f.seed(["token"], later(90));
  const service = createRotatingTokenChecker({ stock: f.stock, client: { createTokenCheck: async () => { f.failNextInventoryWrite(); return "job"; } } });
  await service.start(row.id); assert.equal(f.read()[0].tokenCheck.jobId, "job"); assert.equal(f.read()[0].tokenCheck.status, "running");
});


test("bulk removal handles every state together, deduplicates IDs and preserves unselected accounts and orders", async () => {
  const f = fixture(); const rows = await f.seed(["one", "two", "three", "four", "five", "keep"], later(90));
  const saved = f.read(); ["available", "reserved", "in_use", "review", "expired"].forEach((status, index) => Object.assign(saved[index], { status, orderId: "order", orderIndex: index, customerEndsAt: later(20) })); f.write(saved);
  const order = { uniqid: "order", added: 10 }; f.orders.set("order", order);
  let callbacks = 0;
  const ids = rows.slice(0, 5).map(row => row.id);
  const result = await f.stock.removeMany([...ids, ids[0]], async selected => { callbacks++; assert.equal(selected.length, 5); return { config: { accounts: [] }, removedIds: ["legacy-profile"] }; });
  assert.deepEqual(result.removedAccountIds, ids); assert.deepEqual(result.removedIds, ["legacy-profile"]); assert.equal(callbacks, 1);
  assert.deepEqual((await f.stock.list()).map(row => row.id), [rows[5].id]); assert.deepEqual(f.orders.get("order"), order);
  assert.deepEqual((await f.stock.removeMany(ids)).removedAccountIds, []);
});

test("invalid bulk requests and cleanup/write failures leave the full inventory intact", async () => {
  const f = fixture(); const rows = await f.seed(["one", "two"], later(90)); const ids = rows.map(row => row.id);
  for (const input of [undefined, [], [123], [""], Array(5001).fill("id")]) await assert.rejects(f.stock.removeMany(input), { statusCode: 400 });
  await assert.rejects(f.stock.removeMany(ids, async () => { throw new Error("cleanup failed"); }), /cleanup failed/);
  f.failNextInventoryWrite(); await assert.rejects(f.stock.removeMany(ids), /Inventory write failed/);
  assert.deepEqual((await f.stock.list()).map(row => row.id), ids);
});

test("bulk checks skip pending accounts, create one shared job and fetch it once per refresh", async () => {
  const f = fixture(); const rows = await f.seed(["one", "two", "pending"], later(90));
  const saved = f.read(); saved[2].tokenCheck = { status: "running", jobId: "previous", requestId: "previous-claim", startedAt: new Date().toISOString() }; f.write(saved);
  let creates = 0, polls = 0;
  const client = { createTokenChecks: async tokens => { creates++; assert.deepEqual(tokens, ["one", "two"]); return "bulk"; }, getTokenChecks: async (job, tokens) => { polls++; assert.equal(job, "bulk"); assert.deepEqual(tokens, ["one", "two"]); return [{ status: "valid" }, { status: "locked" }]; }, getTokenCheck: async () => ({ status: "running" }) };
  const service = createRotatingTokenChecker({ stock: f.stock, client });
  assert.deepEqual(await service.startMany(rows.map(row => row.id)), { queued: true, submitted: 2, skipped: 1 });
  assert.deepEqual(await service.startMany(rows.map(row => row.id)), { queued: false, submitted: 0, skipped: 3 });
  await service.refresh(); assert.equal(creates, 1); assert.equal(polls, 1);
  assert.deepEqual(f.read().map(row => row.tokenCheck.status), ["valid", "locked", "running"]);
  await service.refresh(); assert.equal(polls, 1);
});

test("overlapping bulk checks cannot submit the same account twice and invalid batches never submit", async () => {
  const f = fixture(); const rows = await f.seed(["one", "two", "three"], later(90)); const submitted = [];
  const client = { createTokenCheck: async token => { submitted.push(token); return "job-single"; }, createTokenChecks: async tokens => { submitted.push(...tokens); return "job-bulk"; } };
  const service = createRotatingTokenChecker({ stock: f.stock, client });
  await assert.rejects(service.startMany([]), { statusCode: 400 });
  await assert.rejects(service.startMany([rows[0].id, "missing"]), { statusCode: 404 });
  assert.equal(submitted.length, 0); assert.equal(f.read()[0].tokenCheck, undefined);
  await Promise.all([service.startMany([rows[0].id, rows[1].id]), service.startMany([rows[1].id, rows[2].id])]);
  assert.deepEqual(submitted.sort(), ["one", "three", "two"]);
});

test("bulk polling can finish after selected accounts are removed without restoring them", async () => {
  const f = fixture(); const rows = await f.seed(["one", "two"], later(90));
  const client = { createTokenChecks: async () => "bulk", getTokenChecks: async () => { await f.stock.removeMany(rows.map(row => row.id)); return [{ status: "valid" }, { status: "valid" }]; } };
  const service = createRotatingTokenChecker({ stock: f.stock, client });
  await service.startMany(rows.map(row => row.id)); await service.refresh(); assert.deepEqual(await f.stock.list(), []);
});
