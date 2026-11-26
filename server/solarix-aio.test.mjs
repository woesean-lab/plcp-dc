import test from "node:test";
import assert from "node:assert/strict";
import { createSolarixClient, createSolarixService, normalizeSolarixDelivery, registerSolarixRoutes, solarixSignature } from "./solarix-aio.mjs";

const timestamp = 1795683600000;
const credentials = { slug: "my-integration", secret: "test-only-signing-secret-1234" };
const id = "a1b2c3d4-1234-4abc-8def-123456789abc";
const input = { invite: "sample-invite", amount: 10, duration: "1m" };
const stock = { tiers: [{ duration: "1m", tokens: 60, boosts: 120 }, { duration: "3m", tokens: 20, boosts: 40 }] };
const result = { orderId: "provider-order", orderRef: id, guildId: "123456789012345678", guildName: "Sample server", boosted: 8, failed: 2 };
function signed(payload, { secret = credentials.secret, at = timestamp, signature, status = 200 } = {}) {
  const raw = JSON.stringify(payload), time = String(Math.floor(at / 1000));
  return new Response(raw, { status, headers: { "Content-Type": "application/json", "X-Timestamp": time, "X-Signature": signature ?? solarixSignature(secret, time, raw) } });
}
function storage() {
  const values = new Map([["solarix_aio_config", JSON.stringify(credentials)]]);
  return { values, load: async key => values.get(key) || null, save: async (key, value) => values.set(key, value), claim: async (key, value) => { if (values.has(key)) return false; values.set(key, value); return true; }, remove: async key => values.delete(key) };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test("GET stock signs an empty body; POST sends only delivery fields and its stable reference", async () => {
  const calls = [];
  const api = createSolarixClient({ credentials, now: () => timestamp, fetch: async (url, init) => { calls.push({ url, ...init }); return signed(url.endsWith("/stock") ? stock : result); } });
  assert.equal((await api.stock()).tiers[0].boosts, 120);
  assert.equal(calls[0].method, "GET"); assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].headers["X-Signature"], solarixSignature(credentials.secret, String(timestamp / 1000), ""));
  const response = await api.submit({ ...input, tokens: ["private-token"], proxy: "private-proxy" }, id);
  assert.equal(response.boosted, 8); assert.equal(response.failed, 2);
  assert.deepEqual(JSON.parse(calls[1].body), { ...input, order_ref: id });
  assert.equal(calls[1].headers["X-Signature"], solarixSignature(credentials.secret, String(timestamp / 1000), calls[1].body));
  assert.equal(calls[1].redirect, "error");
  assert.equal(calls[1].url, "https://api.solarixaio.com/tools/public/boost-bot/orders/my-integration");
});

test("validation rejects odd/oversized boosts and unsupported durations before any delivery", () => {
  for (const patch of [{ amount: 3 }, { amount: 0 }, { amount: 1002 }, { amount: "10" }, { duration: "30d" }, { invite: "https://example.com/steal" }]) assert.throws(() => normalizeSolarixDelivery({ ...input, ...patch }), { statusCode: 400 });
  assert.deepEqual(normalizeSolarixDelivery({ ...input, invite: "https://discord.gg/sample-invite" }), input);
});

test("unsigned, tampered or expired responses and mismatched results remain uncertain", async () => {
  for (const options of [{ signature: "0".repeat(64) }, { at: timestamp - 301000 }, { secret: "wrong" }]) {
    const api = createSolarixClient({ credentials, now: () => timestamp, fetch: async () => signed(result, options) });
    await assert.rejects(api.submit(input, id), { uncertain: true });
  }
  for (const patch of [{ orderRef: "different" }, { boosted: 11, failed: 0 }, { boosted: -1, failed: 11 }, { guildId: "wrong" }, { failed: -1 }, { failed: 1.5 }, { failed: Number.MAX_SAFE_INTEGER + 1 }, { failed: undefined }, { boosted: undefined }]) {
    const api = createSolarixClient({ credentials, now: () => timestamp, fetch: async () => signed({ ...result, ...patch }) });
    await assert.rejects(api.submit(input, id), { uncertain: true });
  }
});

test("reported failures are independent of delivered boosts, including a fully delivered 16/24 result", async () => {
  for (const [boosted, failed] of [[16, 24], [16, 0], [8, 24], [8, 0], [0, 24], [0, 0]]) {
    const api = createSolarixClient({ credentials, now: () => timestamp, fetch: async () => signed({ ...result, boosted, failed }) });
    const response = await api.submit({ ...input, amount: 16 }, id);
    assert.equal(response.boosted, boosted);
    assert.equal(response.failed, failed);
  }
});

test("a fully delivered order with extra reported failures is saved as completed and never resubmitted", async () => {
  const store = storage(); let calls = 0;
  const service = createSolarixService({ ...store, now: () => timestamp, fetch: async () => { calls++; return signed({ ...result, boosted: 16, failed: 24 }); } });
  await service.start({ ...input, amount: 16, requestId: id });
  await service.executions.get(id);
  const receipt = await service.read(id);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.result.boosted, 16);
  assert.equal(receipt.result.failed, 24);
  const restarted = createSolarixService({ ...store, now: () => timestamp, fetch: () => { throw Error("Must never resubmit"); } });
  assert.deepEqual(await restarted.start({ ...input, amount: 16, requestId: id }), receipt);
  assert.equal(calls, 1);
});

test("transport failures and server errors never turn into confirmed failed boost counts", async () => {
  for (const fetch of [async () => { throw Error("network"); }, async () => signed({}, { status: 500 })]) {
    const api = createSolarixClient({ credentials, now: () => timestamp, fetch });
    await assert.rejects(api.submit(input, id), { uncertain: true });
  }
  for (const status of [400, 401, 403, 404, 429]) {
    const api = createSolarixClient({ credentials, now: () => timestamp, fetch: async () => signed({ detail: credentials.secret }, { status }) });
    await assert.rejects(api.submit(input, id), error => error.uncertain === false && !error.message.includes(credentials.secret));
  }
});

test("invalid stock does not become zero inventory and credentials are verified before saving", async () => {
  const store = storage();
  const api = createSolarixService({ ...store, now: () => timestamp, fetch: async () => signed({ tiers: [{ duration: "1m", tokens: 2, boosts: 3 }] }) });
  await assert.rejects(api.stock(), /invalid stock/);
  await assert.rejects(api.saveConfig({ slug: "new-slug", secret: "new-secret" }));
  assert.deepEqual(JSON.parse(store.values.get("solarix_aio_config")), credentials);
  const metadata = await api.config();
  assert.deepEqual(metadata, { configured: true, slug: credentials.slug, secretSuffix: "1234" });
  assert.equal(JSON.stringify(metadata).includes(credentials.secret), false);
});

test("an integration may expose one duration without inventing counts for the other", async () => {
  const api = createSolarixClient({ credentials, now: () => timestamp, fetch: async () => signed({ tiers: [stock.tiers[1]] }) });
  assert.deepEqual((await api.stock()).tiers, [{ duration: "3m", label: "3 Months", tokens: 20, boosts: 40 }]);
});

test("concurrent submissions share one atomic receipt and make only one upstream order", async () => {
  const gate = deferred(), store = storage(), calls = [];
  const service = createSolarixService({ ...store, now: () => timestamp, fetch: async (url, options) => { calls.push(options); await gate.promise; return signed(result); } });
  const [first, second] = await Promise.all([service.start({ ...input, requestId: id }), service.start({ ...input, requestId: id })]);
  assert.equal(first.id, second.id); assert.equal(first.status, "running"); assert.equal(calls.length, 1);
  assert.equal((await service.read(id)).status, "running");
  gate.resolve(); await service.executions.get(id);
  const finished = await service.read(id);
  assert.equal(finished.status, "completed"); assert.deepEqual(finished.result, { orderId: result.orderId, guildId: result.guildId, guildName: result.guildName, boosted: 8, failed: 2 });
  await service.start({ ...input, requestId: id }); assert.equal(calls.length, 1);
  await assert.rejects(service.start({ ...input, requestId: id, amount: 12 }), { statusCode: 409 });
  assert.ok([...store.values.keys()].every(key => key.startsWith("solarix_aio_")));
});

test("a lost upstream response is saved as uncertain, and a restart never repeats it", async () => {
  const store = storage(); let calls = 0;
  const service = createSolarixService({ ...store, now: () => timestamp, fetch: async () => { calls++; throw Error("socket closed"); } });
  await service.start({ ...input, requestId: id }); await service.executions.get(id);
  assert.equal((await service.read(id)).status, "uncertain");
  const restarted = createSolarixService({ ...store, now: () => timestamp, fetch: async () => { calls++; return signed(result); } });
  assert.equal((await restarted.start({ ...input, requestId: id })).status, "uncertain");
  assert.equal(calls, 1);
});

test("interrupted running receipts become unconfirmed instead of resubmitting after restart", async () => {
  const store = storage();
  store.values.set(`solarix_aio_delivery_${id}`, JSON.stringify({ id, input, status: "running", startedAt: new Date(timestamp - 241000).toISOString() }));
  const service = createSolarixService({ ...store, now: () => timestamp, fetch: () => { throw Error("Must never call provider"); } });
  assert.equal((await service.read(id)).status, "uncertain");
  assert.equal((await service.start({ ...input, requestId: id })).status, "uncertain");
});

test("stock is briefly cached, configuration removal disables access, receipts stay readable", async () => {
  const store = storage(); let calls = 0, time = timestamp;
  const service = createSolarixService({ ...store, now: () => time, fetch: async () => { calls++; return signed(stock, { at: time }); } });
  await service.stock(); await service.stock(); assert.equal(calls, 1);
  time += 16000; await service.stock(); assert.equal(calls, 2);
  await service.clearConfig();
  assert.equal((await service.config()).configured, false);
  await assert.rejects(service.stock(), { statusCode: 503 });
});

test("every Solarix route requires the existing authenticated session", () => {
  const routes = [], requireSession = () => {};
  const app = Object.fromEntries(["get", "put", "delete", "post"].map(method => [method, (path, ...handlers) => routes.push({ method, path, handlers })]));
  registerSolarixRoutes(app, { requireSession, service: {} });
  assert.equal(routes.length, 6);
  assert.ok(routes.every(route => route.handlers[0] === requireSession && route.path.startsWith("/api/solarix-aio/")));
});
