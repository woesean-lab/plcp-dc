import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { createBotsOnliner, parseBotProxies, registerBotsOnliner, BOTS_ONLINER_SQL } from "./bots-onliner.mjs";
import { createBotGateway } from "./bot-onliner-gateway.mjs";

const id = "111111111111111111", other = "222222222222222222";
const proxy1 = "socks5://user:pass@one.example:1080", proxy2 = "http://two.example:8080/";
const pgRuntime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
const databaseTest = { skip: !fs.existsSync(pgRuntime) };
const encrypt = value => Buffer.from(value).toString("base64"), decrypt = value => Buffer.from(value, "base64").toString();
async function fixture() {
  const { PGlite } = await import(pgRuntime.href);
  const db = new PGlite();
  await db.exec(`CREATE TABLE app_settings (setting_key TEXT PRIMARY KEY,encrypted_value TEXT NOT NULL,updated_at TIMESTAMPTZ DEFAULT NOW()); ${BOTS_ONLINER_SQL}`);
  // A realistic existing member configuration must remain byte-for-byte untouched.
  const members = JSON.stringify({ enabled: true, accounts: Array.from({ length: 2500 }, (_, index) => ({ id: `member-${index}`, botToken: `member-${index}-token`, proxyUrl: "http://member-only:8080", richPresenceEnabled: true })), proxyPool: ["http://member-only:8080"] });
  await db.query("INSERT INTO app_settings VALUES ('discord_onliner_config',$1,NOW())", [encrypt(members)]);
  let lockOwner = null, clock = Date.now();
  const calls = [], transports = [], errors = [];
  const query = async (sql, args) => {
    calls.push({ sql, args });
    assert.equal(sql.includes("discord_onliner"), false, "Bot service must not query member runtime/settings");
    if (sql.includes("app_settings")) assert.equal(args[0], "bots_onliner_proxies");
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    return db.query(sql, args);
  };
  const pool = { query, connect: async () => {
    const client = new EventEmitter();
    client.query = async (sql, args) => {
      if (sql.includes("pg_try_advisory_lock")) {
        assert.equal(args[0], 1746203914);
        const acquired = lockOwner === null || lockOwner === client;
        if (acquired) lockOwner = client;
        return { rows: [{ acquired }] };
      }
      if (sql.includes("pg_advisory_unlock")) { if (lockOwner === client) lockOwner = null; return { rows: [] }; }
      return query(sql, args);
    };
    client.release = () => { if (lockOwner === client) lockOwner = null; };
    return client;
  } };
  const gateway = (account, options) => {
    const transport = { account, state: { connectionState: "connecting", lastError: null }, stopped: false,
      start() {}, stop() { this.stopped = true; }, snapshot() { return this.state; },
      publish(connectionState, lastError = null) { this.state = { connectionState, lastError }; options.publish(this.state); }
    };
    transports.push(transport); return transport;
  };
  const deps = { pool, encrypt, decrypt, resolveBot: async clientId => ({ clientId, botToken: `bot-token-${clientId}` }), gateway, now: () => clock, onError: error => errors.push(error) };
  const service = createBotsOnliner(deps);
  return { db, service, deps, transports, errors, calls, members, setClock: value => { clock = value; },
    cleanup: async () => { await service.stop(); await db.close(); } };
}

test("bot proxy parser handles URL and provider formats and does not reveal invalid credentials", () => {
  assert.deepEqual(parseBotProxies(`one.example:1080:user:pass\n${proxy1}\n${proxy2}`), [proxy1, proxy2]);
  assert.throws(() => parseBotProxies("http://user:secret@bad.example:bad"), error => error.message === "Invalid bot proxy on line 1.");
  assert.throws(() => parseBotProxies("file:///secret"), /line 1/);
});

test("independent bot pool, status and disconnect never change any of 2500 member profiles", databaseTest, async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.service.connect(id), error => error.statusCode === 409 && /Bots Onliner/.test(error.message));
    await f.service.saveProxies(`${proxy1}\n${proxy2}`); await f.service.tick();
    await f.service.connect(id); await f.service.tick();
    await f.service.connect(other); await f.service.tick();
    assert.equal(f.transports.length, 2);
    assert.equal(f.transports[0].account.proxyUrl, proxy1);
    assert.equal(f.transports[1].account.proxyUrl, proxy2);
    f.transports[0].publish("connected"); await f.service.tick();
    assert.equal((await f.service.status()).bots.find(bot => bot.clientId === id).connectionState, "connected");
    const publicState = JSON.stringify(await f.service.status());
    assert.equal(publicState.includes("bot-token"), false); assert.equal(publicState.includes("pass"), false);
    await f.service.disconnect(id); await f.service.tick();
    assert.equal(f.transports[0].stopped, true); assert.equal(f.transports[1].stopped, false);
    assert.deepEqual((await f.service.status()).bots.map(bot => bot.clientId), [other]);
    const stored = await f.db.query("SELECT encrypted_value FROM app_settings WHERE setting_key='discord_onliner_config'");
    assert.equal(decrypt(stored.rows[0].encrypted_value), f.members);
    assert.deepEqual(f.errors, []);
  } finally { await f.cleanup(); }
});

test("repeated connects are stable; proxy edits restart only affected bots; stale runtime cannot resurrect removed profiles", databaseTest, async () => {
  const f = await fixture();
  try {
    await f.service.saveProxies(`${proxy1}\n${proxy2}`); await f.service.tick();
    await f.service.connect(id); await f.service.tick(); await f.service.connect(other); await f.service.tick();
    await f.service.connect(id); await f.service.tick();
    assert.equal(f.transports.length, 2);
    await f.service.saveProxies(proxy2); await f.service.tick();
    assert.equal(f.transports.length, 3); assert.equal(f.transports[0].stopped, true); assert.equal(f.transports[1].stopped, false);
    await assert.rejects(f.service.saveProxies(""), error => error.statusCode === 409);
    await f.service.disconnect(id);
    f.transports[0].publish("connected"); await f.service.tick();
    assert.equal((await f.service.status()).bots.length, 1);
    assert.equal((await f.db.query("SELECT * FROM bots_onliner_runtime WHERE client_id=$1", [id])).rows.length, 0);
    f.setClock(Date.now() + 60000);
    const state = (await f.service.status()).bots[0];
    assert.equal(state.connectionState, "disconnected"); assert.match(state.lastError, /offline/);
  } finally { await f.cleanup(); }
});

test("two web instances share a bot-only advisory lock and hand over independently", databaseTest, async () => {
  const f = await fixture(), second = createBotsOnliner(f.deps);
  try {
    await f.service.saveProxies(proxy1); await f.service.tick(); await f.service.connect(id); await f.service.tick();
    await second.tick(); assert.equal(f.transports.length, 1);
    await f.service.stop(); await second.tick(); assert.equal(f.transports.length, 2);
    assert.equal(f.transports[0].stopped, true);
  } finally { await second.stop(); await f.cleanup(); }
});

function gatewayFixture() {
  const sockets = [], pending = new Set(), changes = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close(code) { this.readyState = 3; this.emit("close", code); }
    terminate() { this.close(1006); }
  }
  const timers = { setTimeout(callback, delay) { const task = { callback, delay, unref() {} }; pending.add(task); return task; }, clearTimeout(task) { pending.delete(task); } };
  const transport = createBotGateway({ clientId: id, botToken: "bot-only-token", proxyUrl: proxy1 }, {
    Socket, timers, agent: proxy => { assert.equal(proxy, proxy1); return "bot-proxy-agent"; }, random: () => 0,
    publish: state => changes.push(state)
  });
  const emit = (socket, frame) => socket.emit("message", JSON.stringify(frame));
  return { sockets, pending, changes, transport, emit };
}

test("bot transport sends only bot IDENTIFY, handles heartbeats and resumes its own session", () => {
  const f = gatewayFixture(); f.transport.start();
  const socket = f.sockets[0]; assert.equal(socket.options.agent, "bot-proxy-agent");
  f.emit(socket, { op: 10, d: { heartbeat_interval: 45000 } });
  assert.deepEqual(socket.sent[0], { op: 2, d: { token: "bot-only-token", intents: 0,
    properties: { os: process.platform, browser: "Pulcip Bots", device: "Pulcip Bots" },
    presence: { since: null, activities: [], status: "online", afk: false } } });
  [...f.pending].find(task => task.delay === 0).callback(); assert.equal(socket.sent.at(-1).op, 1);
  f.emit(socket, { op: 11 });
  f.emit(socket, { op: 0, t: "READY", s: 42, d: { user: { id, bot: true }, session_id: "bot-session", resume_gateway_url: "wss://gateway.discord.gg/" } });
  assert.equal(f.transport.snapshot().connectionState, "connected");
  socket.close(1006); [...f.pending].find(task => task.delay === 1000).callback();
  f.emit(f.sockets[1], { op: 10, d: { heartbeat_interval: 45000 } });
  assert.deepEqual(f.sockets[1].sent[0], { op: 6, d: { token: "bot-only-token", session_id: "bot-session", seq: 42 } });
  f.transport.stop();
});

test("fatal errors stop retries and disconnect cancels all bot timers without touching other transports", () => {
  const f = gatewayFixture(); f.transport.start(); f.sockets[0].close(4013);
  assert.equal(f.transport.snapshot().connectionState, "error"); assert.match(f.transport.snapshot().lastError, /4013/);
  assert.equal(f.pending.size, 0);
  const next = gatewayFixture(); next.transport.start(); next.emit(next.sockets[0], { op: 10 });
  next.transport.stop(); assert.equal(next.pending.size, 0); assert.equal(next.sockets[0].readyState, 3);
  assert.equal(f.transport.snapshot().connectionState, "error");
});

test("bot transport rejects wrong identities, respects rate limits and stops proxy-auth retry loops", () => {
  const f = gatewayFixture(); f.transport.start();
  f.emit(f.sockets[0], { op: 0, t: "READY", d: { user: { id: other, bot: true } } });
  assert.equal(f.transport.snapshot().connectionState, "error"); assert.equal(f.pending.size, 0);
  const limited = gatewayFixture(); limited.transport.start();
  limited.sockets[0].emit("unexpected-response", {}, { statusCode: 429, headers: { "retry-after": "600" }, resume() {} });
  assert.equal([...limited.pending][0].delay, 600000); limited.transport.stop();
  const proxy = gatewayFixture(); proxy.transport.start();
  proxy.sockets[0].emit("unexpected-response", {}, { statusCode: 407, resume() {} });
  assert.match(proxy.transport.snapshot().lastError, /407/); assert.equal(proxy.pending.size, 0);
});

test("bot routes are authenticated and never expose a member runtime endpoint", () => {
  const registered = [], app = Object.fromEntries(["get", "post", "put", "delete"].map(method => [method, (...args) => registered.push({ method, args })]));
  const requireSession = () => {};
  registerBotsOnliner(app, requireSession, {});
  assert.equal(registered.length, 5);
  for (const route of registered) { assert.equal(route.args[1], requireSession); assert.match(route.args[0], /^\/api\/community\/bots\//); }
});
