import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AUTO_REPLACE_DEFAULTS, AUTO_REPLACE_GUARD_SQL, validateAutoReplaceSettings, registerAutoReplaceSettings, getAutoReplaceIndices, createAutoReplaceRunner, invokeReplacement, withOrderReplacementLock } from "./order-auto-replace.mjs";

const deps = {
  memberEligible: (_order, item) => !item.expired && item.membershipStatus !== "removed" && !item.leaveAllStatus,
  boostCount: item => item.boostCount || (item.boosted ? 2 : 0),
  boostPending: item => item.taskPending || item.transportUncertain || ["queued", "joining", "verifying", "pending"].includes(item.status)
};
const memberOrder = (extra = {}) => ({ uniqid: "members", provider: "community", autoReplace: true, status: "PARTIAL", autoReplaceRounds: 0, amount: 3, added: 1,
  communityResults: [{ state: "joined" }, { state: "failed" }, { state: "blocked" }], ...extra });
const boostOrder = (extra = {}) => ({ uniqid: "boosts", provider: "dcord", autoReplace: true, status: "ERROR", autoReplaceRounds: 0,
  dcordResults: [{ status: "error", boostCount: 0 }, { status: "joined", boostStatus: "failed", boostCount: 0 }], ...extra });

test("limits are separate, default to three, accept disabling, and reject unbounded/invalid input", () => {
  assert.deepEqual(AUTO_REPLACE_DEFAULTS, { members: 3, boosts: 3 });
  assert.deepEqual(validateAutoReplaceSettings({ members: 0, boosts: 10 }), { members: 0, boosts: 10 });
  for (const value of [null, {}, { members: "3", boosts: 3 }, { members: -1, boosts: 3 }, { members: 1.5, boosts: 3 }, { members: 3, boosts: 11 }]) assert.throws(() => validateAutoReplaceSettings(value), { statusCode: 400 });
});

test("only settled opted-in orders replace failed deliveries; diagnostics alone never replace joined members", () => {
  assert.deepEqual(getAutoReplaceIndices(memberOrder(), deps), [1, 2]);
  for (const status of ["PROCESS", "WAITING", "PAUSED", "INVITES PAUSED", "CANCELLED", "COMPLETED"]) assert.deepEqual(getAutoReplaceIndices(memberOrder({ status }), deps), []);
  for (const extra of [{ autoReplace: false }, { autoReplace: undefined }, { deliveryPaused: true }, { autoReplaceStopped: "replacement_unavailable" }]) assert.deepEqual(getAutoReplaceIndices(memberOrder(extra), deps), []);
  assert.deepEqual(getAutoReplaceIndices(memberOrder({ communityResults: [{ state: "joined", onlinerLive: false }, { state: "failed", expired: true }, { state: "failed", membershipStatus: "removed" }, { state: "failed", leaveAllStatus: "failed" }] }), deps), []);
  assert.deepEqual(getAutoReplaceIndices(memberOrder({ communityResults: [{ state: "failed" }, { state: "queued" }] }), deps), []);
});

test("boost rounds skip partial/successful/returned/uncertain/provider/server outcomes for both services", () => {
  for (const boostProvider of ["salta7", "dcord"]) {
    const order = boostOrder({ boostProvider, dcordResults: [
      { status: "error", boostCount: 0 }, { status: "partial", boostCount: 1 }, { status: "error", boostCount: 1 },
      { status: "joined + boosted", boosted: true }, { status: "returned", returnedToStock: true },
      { status: "error", providerBlocked: true }, { status: "error", serverBlocked: true },
      { status: "joined", boostStatus: "failed", boostCount: 0 }, { status: "unknown" }
    ] });
    assert.deepEqual(getAutoReplaceIndices(order, deps), [0, 7]);
    for (const result of [{ status: "verifying", taskPending: true }, { status: "error", transportUncertain: true }, { status: "queued" }]) {
      assert.deepEqual(getAutoReplaceIndices({ ...order, dcordResults: [...order.dcordResults, result] }, deps), []);
    }
  }
});

const pgRuntime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
const pgOptions = { skip: !fs.existsSync(pgRuntime) };
async function database(run) {
  const { PGlite } = await import(pgRuntime.href);
  const db = new PGlite();
  const locks = new Set();
  const query = async (sql, values) => {
    if (sql.includes("pg_try_advisory_lock")) { const locked = !locks.has(values[0]); if (locked) locks.add(values[0]); return { rows: [{ locked }] }; }
    if (sql.includes("pg_advisory_unlock")) { locks.delete(values[0]); return { rows: [] }; }
    return db.query(sql, values);
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const write = order => db.query("INSERT INTO tracked_orders (uniqid, payload) VALUES ($1, $2::jsonb) ON CONFLICT (uniqid) DO UPDATE SET payload = EXCLUDED.payload RETURNING payload", [order.uniqid, JSON.stringify(order)]);
  const read = async id => (await db.query("SELECT payload FROM tracked_orders WHERE uniqid=$1", [id])).rows[0].payload;
  try {
    await db.exec("CREATE TABLE tracked_orders (uniqid text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz DEFAULT NOW())");
    await db.exec(AUTO_REPLACE_GUARD_SQL);
    await run({ db, pool, write, read, locks });
  } finally { await db.close(); }
}

test("persisted limits stop repeated failures across runner restarts and respect live limit changes", pgOptions, async () => database(async ({ pool, write, read }) => {
  await write(memberOrder()); await write(boostOrder());
  let limits = { members: 2, boosts: 1 };
  const calls = [];
  const runner = () => createAutoReplaceRunner({ pool, ...deps, readSettings: async () => limits,
    replaceMembers: async order => { calls.push([order.uniqid, order.autoReplaceRounds]); assert.equal((await read(order.uniqid)).autoReplaceRounds, order.autoReplaceRounds); },
    replaceBoosts: async (order, indices) => { calls.push([order.uniqid, order.autoReplaceRounds]); assert.deepEqual(indices, [0, 1]); }, onError: error => assert.fail(String(error)) });
  await runner()(); await runner()(); await runner()(); await runner()();
  assert.deepEqual(calls, [["members", 1], ["boosts", 1], ["members", 2]]);
  assert.equal((await read("members")).autoReplaceStopped, "limit_reached");
  limits = { members: 3, boosts: 0 };
  await runner()();
  assert.equal((await read("members")).autoReplaceRounds, 3);
  assert.equal((await read("boosts")).autoReplaceRounds, 1);
}));

test("no stock stops future rounds; successful orders and busy deliveries do not consume rounds", pgOptions, async () => database(async ({ pool, write, read }) => {
  await write(memberOrder()); await write(boostOrder());
  let calls = 0, busy = true;
  const options = { pool, ...deps, readSettings: async () => ({ members: 3, boosts: 3 }), boostBusy: () => busy,
    replaceMembers: async () => { calls++; throw new Error("No replacement stock"); }, replaceBoosts: async order => { calls++; await write({ ...order, status: "COMPLETED" }); }, onError() {} };
  await createAutoReplaceRunner(options)(); await createAutoReplaceRunner(options)();
  assert.equal(calls, 1); assert.equal((await read("members")).autoReplaceStopped, "replacement_unavailable");
  assert.equal((await read("boosts")).autoReplaceRounds, 0);
  busy = false;
  await createAutoReplaceRunner(options)(); await createAutoReplaceRunner(options)();
  assert.equal(calls, 2); assert.equal((await read("boosts")).status, "COMPLETED");
}));

test("old direct/upsert snapshots cannot reset opt-in, round counts or a permanent stop", pgOptions, async () => database(async ({ write, read }) => {
  const original = memberOrder(); await write(original);
  await write({ ...original, autoReplaceRounds: 2, autoReplaceLastAttemptAt: "saved", autoReplaceStopped: "replacement_unavailable" });
  await write({ ...original, autoReplace: false, added: 2 });
  const latest = await read(original.uniqid);
  assert.equal(latest.autoReplace, true); assert.equal(latest.autoReplaceRounds, 2);
  assert.equal(latest.autoReplaceLastAttemptAt, "saved"); assert.equal(latest.autoReplaceStopped, "replacement_unavailable"); assert.equal(latest.added, 2);
}));

test("concurrent scanners share a per-order lock, and a failed callback always releases it", pgOptions, async () => database(async ({ pool, write, read, locks }) => {
  await write(memberOrder()); let calls = 0, unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  let started; const claimed = new Promise(resolve => { started = resolve; });
  const options = { pool, ...deps, readSettings: async () => ({ members: 1, boosts: 1 }), replaceMembers: async () => { calls++; started(); await gate; }, replaceBoosts: async () => {}, onError() {} };
  const first = createAutoReplaceRunner(options)(); await claimed;
  await createAutoReplaceRunner(options)(); unblock(); await first;
  assert.equal(calls, 1); assert.equal((await read("members")).autoReplaceRounds, 1); assert.equal(locks.size, 0);
  await assert.rejects(withOrderReplacementLock(pool, "other", async () => { throw new Error("failure"); }), /failure/);
  assert.equal(locks.size, 0);
}));

test("settings endpoints require the existing session middleware and retain exact saved values", async () => {
  const routes = new Map(); const auth = () => {}; let stored;
  const app = Object.fromEntries(["get", "put"].map(method => [method, (path, middleware, handler) => { assert.equal(middleware, auth); routes.set(method, handler); }]));
  const read = registerAutoReplaceSettings(app, { requireSession: auth, load: async () => stored, save: async (_key, value) => { stored = value; } });
  assert.deepEqual(await read(), { members: 3, boosts: 3 });
  const response = { set() { return this; }, json(value) { this.value = value; } };
  await routes.get("put")({ body: { members: 2, boosts: 0 } }, response, error => { throw error; });
  assert.deepEqual(await read(), { members: 2, boosts: 0 });
  let failure;
  await routes.get("put")({ body: { members: 999, boosts: 0 } }, response, error => { failure = error; });
  assert.equal(failure.statusCode, 400); assert.deepEqual(await read(), { members: 2, boosts: 0 });
});

test("internal replacement adapter propagates rejection and never uses user-supplied automation flags", async () => {
  let options;
  const result = await invokeReplacement(async (_req, res, _next, value) => { options = value; res.json({ ok: true }); }, "order", {}, { deferDelivery: true });
  assert.deepEqual(options, { automatic: true, deferDelivery: true }); assert.deepEqual(result, { ok: true });
  await assert.rejects(invokeReplacement(async (_req, res) => res.status(409).json({ message: "No stock" }), "order"), /No stock/);
});
