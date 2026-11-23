import test from "node:test";
import { integrationKeyHash } from "./eldorado-integration-settings.mjs";
import assert from "node:assert/strict";
import { registerEldoradoIntegration, integrationRequestHash, buildEldoradoDeliveryMessage } from "./eldorado-integration.mjs";
const externalId = "eldorado-test-1";
const key = "a".repeat(40);
const payload = { externalId, kind: "boosts", amount: 14, invite: "https://discord.gg/customer", settings: { duration: 1 } };
function fixture() {
  const routes = new Map(), records = new Map(), orders = new Map();
  let creates = 0, rejectInvite = false, failCreate = false;
  const app = { get: (path, ...handlers) => routes.set(`GET ${path}`, handlers), post: (path, ...handlers) => routes.set(`POST ${path}`, handlers) };
  const pool = { query: async (sql, args) => {
    if (sql.startsWith("SELECT payload")) return { rows: orders.has(args[0]) ? [{ payload: orders.get(args[0]) }] : [] };
    if (sql.startsWith("SELECT *")) return { rows: records.has(args[0]) ? [records.get(args[0])] : [] };
    if (sql.startsWith("INSERT")) {
      if (records.has(args[0])) return { rows: [] };
      const row = { external_id: args[0], uniqid: args[1], kind: args[2], amount: args[3], request_hash: args[4] };
      records.set(args[0], row); return { rows: [row] };
    }
    if (sql.startsWith("UPDATE")) return { rows: [] };
    throw new Error("Unexpected SQL");
  } };
  const create = async (req, res, next) => {
    creates++;
    if (failCreate) return next(new Error("Provider disconnected"));
    const order = { uniqid: req.integrationOrderId, provider: req.body.service ? "community" : "dcord", amount: req.body.amount, duration: req.body.duration, added: 0, status: "PROCESS", secretToken: "never-expose", dcordResults: [{ token: "never-expose" }], serverId: "guild" };
    orders.set(order.uniqid, order); res.json({ uniqid: order.uniqid });
  };
  registerEldoradoIntegration(app, { pool, readSettings: async () => ({ key_hash: integrationKeyHash(key), public_base: "https://dc.example.test" }), createMembers: create, createBoosts: create, recoverBoost: async value => value, getCatalog: async () => ({ categories: [] }), validateInvite: async () => { if (rejectInvite) throw Object.assign(new Error("New invite required"), { statusCode: 409, code: "join_application" }); } });
  const call = async (method, path, body = payload, authorization = `Bearer ${key}`) => {
    const req = { headers: { authorization }, body, params: { externalId } };
    const res = { statusCode: 200, set() { return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    const handlers = routes.get(`${method} /api/integrations/eldorado${path}`);
    let accepted = false;
    await handlers[0](req, res, () => { accepted = true; });
    if (accepted) await handlers[1](req, res, error => { throw error; });
    return res;
  };
  return { call, records, orders, get creates() { return creates; }, reject: () => { rejectInvite = true; }, fail: () => { failCreate = true; } };
}
test("API access rejects missing or incorrect keys before touching orders", async () => {
  const f = fixture();
  for (const auth of ["", "Bearer wrong", `Bearer ${"b".repeat(40)}`]) assert.equal((await f.call("POST", "/orders", payload, auth)).statusCode, 401);
  assert.equal(f.creates, 0);
});
test("concurrent duplicate requests create a single order and never expose tokens", async () => {
  const f = fixture(); await Promise.all([f.call("POST", "/orders"), f.call("POST", "/orders")]);
  const result = await f.call("GET", "/orders/:externalId");
  assert.equal(f.creates, 1);
  assert.equal(result.body.externalId, externalId);
  assert.equal(result.body.amount, 14);
  assert.equal(JSON.stringify(result.body).includes("never-expose"), false);
  assert.match(result.body.deliveryMessage, /https:\/\/dc.example.test\/monitor\//);
  assert.equal((await f.call("POST", "/orders", { ...payload, amount: 28 })).statusCode, 409);
  assert.equal(f.creates, 1);
});
test("join application warnings reserve no order and return a machine-readable code", async () => {
  const f = fixture(); f.reject();
  const result = await f.call("POST", "/orders");
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, "join_application");
  assert.equal(f.records.size, 0);
  assert.equal(f.creates, 0);
});
test("unconfirmed creation stays reviewable and retries cannot consume stock again", async () => {
  const f = fixture(); f.fail();
  assert.equal((await f.call("POST", "/orders")).body.status, "REVIEW");
  assert.equal((await f.call("POST", "/orders")).body.status, "REVIEW");
  assert.equal(f.creates, 1);
});
test("partial and completed boost status follow the same original order", async () => {
  const f = fixture(); const created = await f.call("POST", "/orders");
  const remote = f.orders.get(created.body.uniqid);
  Object.assign(remote, { added: 8, status: "PARTIAL" });
  assert.equal((await f.call("GET", "/orders/:externalId")).body.added, 8);
  Object.assign(remote, { added: 14, status: "COMPLETED" });
  assert.equal((await f.call("GET", "/orders/:externalId")).body.status, "COMPLETED");
  assert.equal(f.creates, 1);
});
test("delivery templates include monitor and bot instructions and JSON key order does not alter idempotency", () => {
  const message = buildEldoradoDeliveryMessage({ uniqid: "x", provider: "community", amount: 50, joinMethod: "create_invite", botInvite: "https://discord.com/oauth2/authorize?client_id=bot", delay: 30 }, "https://dc.example.test");
  assert.match(message, /Add Bot/); assert.match(message, /Create Invite/); assert.match(message, /monitor\/x/);
  assert.equal(integrationRequestHash({ b: 2, a: { x: 1, y: 2 } }), integrationRequestHash({ a: { y: 2, x: 1 }, b: 2 }));
});
