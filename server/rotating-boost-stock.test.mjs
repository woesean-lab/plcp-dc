import test from "node:test";
import assert from "node:assert/strict";
import { createRotatingBoostStock, refreshRotatingRows, syncRotatingOrder, BOOST_PERIOD_MS } from "./rotating-boost-stock.mjs";

const day = 86400_000;
const later = (days) => new Date(Date.now() + days * day).toISOString();

// Transactional in-memory SQL adapter: exercises inventory operations without a live database.
function fixture(legacy = []) {
  const settings = new Map();
  const orders = new Map();
  let queue = Promise.resolve();
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
  const stock = createRotatingBoostStock({ pool, encrypt: (text) => Buffer.from(text).toString("base64"), decrypt: (text) => Buffer.from(text, "base64").toString(), legacyTokens: async () => legacy });
  const read = () => JSON.parse(Buffer.from(settings.get("dcord_rotating_boost_stock"), "base64").toString());
  const write = (rows) => settings.set("dcord_rotating_boost_stock", Buffer.from(JSON.stringify(rows)).toString("base64"));
  return { stock, orders, read, write, settings };
}

test("import deduplicates account identities and never exposes raw tokens", async () => {
  const { stock, settings } = fixture();
  const rows = await stock.add(["account-token", "mail:pass:account-token:2fa"], later(90));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "available");
  assert.equal("token" in rows[0], false);
  assert.equal(JSON.stringify(rows).includes("mail:pass"), false);
  assert.equal(settings.get("dcord_rotating_boost_stock").includes("account-token"), false);
});

test("rejects regular-stock overlaps and invalid or insufficient subscription dates", async () => {
  const { stock } = fixture(["mail:pass:existing-token:2fa"]);
  await assert.rejects(stock.add(["existing-token"], later(90)), /regular stock/);
  for (const expiry of ["", "invalid", later(-1), later(32)]) {
    await assert.rejects(stock.add(["new-token"], expiry), /33 days/);
  }
  assert.deepEqual(await stock.list(), []);
});

test("concurrent orders cannot reserve the same account", async () => {
  const { stock } = fixture();
  await stock.add(["only-token"], later(90));
  const results = await Promise.allSettled([
    stock.reserve(1, { uniqid: "order-a" }), stock.reserve(1, { uniqid: "order-b" })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await stock.list())[0].status, "reserved");
});

test("earliest expiry is used first and a failed reservation leaves all accounts untouched", async () => {
  const { stock } = fixture();
  await stock.add(["long-token"], later(90));
  await stock.add(["short-token"], later(40));
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
  const { stock, read, write } = fixture();
  await stock.add(["token"], later(90));
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
  const { stock, read, write } = fixture();
  await stock.add(["token"], later(90));
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
  const { stock, read, write } = fixture();
  await stock.add(["token"], later(40));
  await stock.reserve(1, { uniqid: "o" });
  await stock.sync({ uniqid: "o", dcordResults: [{ status: "success", boosted: true }] });
  const rows = read(); rows[0].expiresAt = later(20); rows[0].customerEndsAt = later(-1); write(rows);
  const [released] = await stock.list();
  assert.equal(released.status, "expired");
  await assert.rejects(stock.reserve(1, { uniqid: "next" }), /Only 0/);
});

test("cancellation stays in separate review pool; legacy saves reject rotating identities", async () => {
  const { stock, settings } = fixture();
  await stock.add(["token"], later(90));
  await stock.reserve(1, { uniqid: "o" });
  assert.equal(await stock.release("o", ["token"]), 1);
  assert.equal((await stock.list())[0].status, "review");
  await assert.rejects(stock.saveLegacyStock({ oneMonth: ["m:p:token:2fa"], threeMonth: [] }), /Rotating accounts/);
  const original = { oneMonth: ["regular"], threeMonth: ["regular-three"] };
  assert.deepEqual(await stock.saveLegacyStock(original), original);
  assert.deepEqual(JSON.parse(Buffer.from(settings.get("dcord_boost_token_stock"), "base64").toString()), original);
});

test("restart recovers persisted delivery results and orphan reservations", async () => {
  const { stock, orders, read, write } = fixture();
  await stock.add(["delivered", "orphan"], later(90));
  await stock.reserve(1, { uniqid: "o" });
  await stock.reserve(1, { uniqid: "orphan-order" });
  orders.set("o", { uniqid: "o", status: "COMPLETED", dcordResults: [{ boosted: true, status: "success" }] });
  const rows = read(); rows[1].reservedAt = new Date(Date.now() - 11 * 60_000).toISOString(); write(rows);
  const recovered = await stock.list();
  assert.equal(recovered[0].status, "in_use");
  assert.equal(recovered[1].status, "review");
});

test("an aged reservation cannot submit and a failed setup can be safely rolled back", async () => {
  const { stock, read, write } = fixture();
  await stock.add(["token"], later(40));
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
  const { stock } = fixture();
  await stock.add(["a", "b"], later(90));
  const results = await Promise.allSettled([stock.reserve(1, { uniqid: "same" }, 2), stock.reserve(1, { uniqid: "same" }, 2)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await stock.list()).filter((row) => row.status === "available").length, 1);
});
