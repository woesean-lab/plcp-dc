import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
import { BOT_GATEWAY_PROTOCOL_VERSION, managedWorkerStatus, createManagedBotStarter, botGatewayIdentify, managedOnlinerAccounts, onlinerGatewayIdentify, createManagedBotResolver, createBotOnlinerManagement, registerBotOnlinerManagement, safeBotConnectionError } from "./community-bot-management.mjs";

const sharedId = "111111111111111111", poolId = "222222222222222222";
test("bot management resolves the selected application's credentials without changing the shared configuration", async () => {
  const shared = { clientId: sharedId, botToken: "shared-token", guildId: "333333333333333333" };
  let poolReads = 0;
  const resolve = createManagedBotResolver({ getSharedConfig: async () => shared, loadPoolConfig: async id => {
    poolReads++; assert.equal(id, poolId); return { clientId: poolId, botToken: "pool-token" };
  } });
  assert.equal((await resolve(sharedId)).botToken, "shared-token");
  assert.equal(poolReads, 0);
  const pooled = await resolve(poolId);
  assert.equal(pooled.botToken, "pool-token");
  assert.equal(pooled.guildId, shared.guildId);
  assert.equal(pooled.configured, true);
  assert.deepEqual(shared, { clientId: sharedId, botToken: "shared-token", guildId: "333333333333333333" });
  await assert.rejects(resolve("invalid"), error => error.statusCode === 400);
  const mismatch = createManagedBotResolver({ getSharedConfig: async () => shared, loadPoolConfig: async () => shared });
  await assert.rejects(mismatch(poolId), error => error.statusCode === 409);
});

function fixture({ enabled = true, accounts = [], proxy = "http://proxy:8080", limit = 3000 } = {}) {
  let config = { enabled, accounts, untouched: "keep", proxyPool: [proxy] };
  const writes = [], starts = [];
  const service = createBotOnlinerManagement({
    resolveBot: async clientId => ({ clientId, botToken: `${clientId}-private-token` }),
    getConfig: async () => config,
    saveConfig: async value => { writes.push(value); config = value; },
    selectProxy: () => proxy, normalize: value => value,
    start: async (value, account) => starts.push({ value, account }), limit,
    snapshot: async value => ({ worker: { connectionPaused: false }, accounts: value.accounts.map(account => ({ id: account.id, connectionState: "connected" })) })
  });
  return { service, writes, starts, config: () => config };
}

test("linking a saved bot preserves other profiles, uses bot mode and reconnects the same profile without exposing tokens", async () => {
  const unrelated = { id: "other", botToken: "unrelated-private", proxyUrl: "http://other:8080", richPresenceEnabled: true };
  const f = fixture({ accounts: [unrelated] });
  const result = await f.service.connect(poolId);
  assert.deepEqual(f.config().accounts[0], unrelated);
  assert.equal(f.config().untouched, "keep");
  assert.equal(f.config().enabled, true);
  const linked = f.config().accounts[1];
  assert.equal(linked.isBot, true);
  assert.equal(linked.communityBotClientId, poolId);
  assert.equal(linked.botToken, `${poolId}-private-token`);
  assert.equal(linked.richPresenceEnabled, false);
  assert.equal(f.starts[0].account.id, linked.id);
  assert.ok(!JSON.stringify(result).includes("private"));
  await f.service.connect(poolId);
  assert.equal(f.config().accounts.length, 2);
  assert.equal(f.config().accounts[1].id, linked.id);
  assert.notEqual(f.config().accounts[1].connectionRevision, linked.connectionRevision);
  const state = await f.service.status([poolId]);
  assert.deepEqual(state, { bots: [{ clientId: poolId, linked: true, state: "connected", lastError: null }] });
  assert.ok(!JSON.stringify(state).includes("private"));
  assert.deepEqual(await f.service.status([sharedId]), { bots: [] });
});

test("existing token profiles are reused, disabled Onliner stays disabled and capacity/proxy failures save nothing", async () => {
  const f = fixture({ enabled: false, accounts: [{ id: "legacy", botToken: `${sharedId}-private-token`, proxyUrl: "http://existing:8080" }] });
  const result = await f.service.connect(sharedId);
  assert.equal(result.enabled, false);
  assert.equal(f.config().enabled, false);
  assert.equal(f.config().accounts.length, 1);
  assert.equal(f.config().accounts[0].id, "legacy");
  assert.equal(f.config().accounts[0].proxyUrl, "http://existing:8080");
  assert.equal((await f.service.status([sharedId])).bots[0].state, "disabled");
  for (const blocked of [fixture({ proxy: "" }), fixture({ limit: 0 })]) {
    await assert.rejects(blocked.service.connect(poolId), error => error.statusCode === 409);
    assert.equal(blocked.writes.length, 0);
    assert.equal(blocked.starts.length, 0);
  }
});

test("bot identify uses unprivileged bot intents and never requests user session capabilities", () => {
  const presence = { status: "online", activities: [], since: null, afk: false };
  const payload = botGatewayIdentify({ botToken: "private" }, presence);
  assert.equal(payload.op, 2);
  assert.equal(payload.d.token, "private");
  assert.equal(payload.d.intents, 1);
  assert.deepEqual(payload.d.presence, presence);
  assert.equal(payload.d.properties.browser, "Pulcip Onliner");
  assert.ok(!("capabilities" in payload.d));
  assert.ok(!("client_state" in payload.d));
  assert.deepEqual(botGatewayIdentify({ botToken: "private" }, { ...presence, activities: [{ name: "Must stay off" }] }).d.presence.activities, []);
});

test("legacy default/pool profiles receive bot IDENTIFY on the wire without changing account profiles or settings", () => {
  const config = { enabled: true, status: "idle", accounts: [
    { id: "old-default", botToken: "default-token", proxyUrl: "http://existing:8080", richPresenceEnabled: true },
    { id: "old-pool", botToken: "pool-token", isBot: false, proxyUrl: "http://pool:8080" },
    { id: "member", botToken: "member-token", discordUserId: "333333333333333333", richPresenceEnabled: true }
  ] };
  const original = structuredClone(config);
  const migrated = managedOnlinerAccounts(config, [{ clientId: sharedId, botToken: "default-token" }, { clientId: poolId, botToken: "pool-token" }]);
  const presence = { activities: [{ name: "Legacy activity" }], status: "idle", since: null, afk: false };
  const legacy = { properties: { browser: "existing-account-client" }, clientState: { previous: true } };
  for (const account of migrated.accounts.slice(0, 2)) {
    const wire = JSON.parse(JSON.stringify(onlinerGatewayIdentify(account, presence, legacy)));
    assert.equal(wire.op, 2);
    assert.equal(wire.d.intents, 1);
    assert.equal(wire.d.properties.browser, "Pulcip Onliner");
    assert.deepEqual(wire.d.presence.activities, []);
    assert.ok(!("capabilities" in wire.d) && !("client_state" in wire.d));
    assert.equal(account.richPresenceEnabled, false);
  }
  assert.deepEqual(config, original, "classification does not mutate saved configuration");
  assert.equal(migrated.accounts[0].proxyUrl, original.accounts[0].proxyUrl);
  const userWire = onlinerGatewayIdentify(migrated.accounts[2], presence, legacy);
  assert.deepEqual(userWire.d.properties, legacy.properties);
  assert.deepEqual(userWire.d.client_state, legacy.clientState);
  assert.equal(userWire.d.capabilities, 16381);
  assert.equal(migrated.accounts[2].richPresenceEnabled, true);
  assert.deepEqual(onlinerGatewayIdentify({ botToken: "token", communityBotClientId: poolId }, presence, legacy).d.intents, 1,
    "a linked application cannot fall back to the account packet if its old isBot flag is missing");
});

test("connection error details keep the diagnostic code and redact saved tokens and proxy credentials", async () => {
  const account = { id: "linked", communityBotClientId: poolId, botToken: "private-token", proxyUrl: "http://user:password@proxy:8080" };
  const message = "Proxy authentication failed (HTTP 407). http://user:password@proxy:8080 token=private-token";
  const service = createBotOnlinerManagement({
    getConfig: async () => ({ enabled: true, accounts: [account] }),
    snapshot: async () => ({ accounts: [{ id: "linked", connectionState: "error", lastError: message }] })
  });
  const result = (await service.status([poolId])).bots[0];
  assert.equal(result.state, "error");
  assert.match(result.lastError, /HTTP 407/);
  assert.ok(!JSON.stringify(result).includes("private-token"));
  assert.ok(!JSON.stringify(result).includes("password"));
  assert.equal(safeBotConnectionError("", account), null);
  assert.equal(safeBotConnectionError("Other socks5://name:secret@host:1234", account), "Other socks5://[redacted]@host:1234");
});

test("every bot Onliner route requires the admin session", () => {
  const routes = [];
  const session = () => {};
  registerBotOnlinerManagement({ get: (...args) => routes.push(args), post: (...args) => routes.push(args) }, session, {});
  assert.equal(routes.length, 2);
  assert.ok(routes.every(route => route[1] === session));
});

test("bot reconnect explicitly reaches the worker that owns the sockets, including standby all-role processes", async () => {
  const queued = [], started = [], configs = [];
  let owns = false;
  const start = createManagedBotStarter({ ownsWorker: () => owns,
    reconnect: (config, account) => started.push(account), setCurrentConfig: config => configs.push(config),
    enqueue: async command => queued.push(command)
  });
  const account = { id: "only-this-bot", connectionRevision: "revision-one" };
  await start({ enabled: true }, account);
  assert.deepEqual(queued, [{ accountId: account.id, connectionRevision: "revision-one" }]);
  assert.equal(started.length, 0, "a process without the worker lock must not open a duplicate connection");
  owns = true;
  await start({ enabled: true }, account);
  assert.deepEqual(started, [account]);
  assert.equal(configs.length, 1);
  assert.equal(queued.length, 1);
  await start({ enabled: false }, account);
  assert.equal(started.length, 1, "linking a disabled Onliner does not start it");
});

test("worker protocol support belongs to the active lock owner and cannot be inherited from a previous worker", () => {
  const now = Date.now();
  const current = { worker_id: "current", protocol_worker_id: "current", protocol_version: BOT_GATEWAY_PROTOCOL_VERSION, status: "online", heartbeat_at: new Date(now).toISOString() };
  assert.deepEqual(managedWorkerStatus(current, now), { online: true, paused: false, botGatewaySupported: true });
  assert.equal(managedWorkerStatus({ ...current, worker_id: "different" }, now).botGatewaySupported, false);
  assert.equal(managedWorkerStatus({ ...current, heartbeat_at: new Date(now - 60_000).toISOString() }, now).online, false);
  assert.equal(managedWorkerStatus(undefined, now).online, false);
});

test("a running worker without new capability metadata still receives the requested reconnect", async () => {
  const f = fixture();
  let started = false;
  const service = createBotOnlinerManagement({
    resolveBot: async () => ({ clientId: poolId, botToken: "saved-token" }),
    getConfig: f.config, saveConfig: async () => {}, selectProxy: () => "http://existing:8080",
    normalize: value => value, start: async () => { started = true; },
    getWorkerStatus: async () => ({ online: true, paused: false, botGatewaySupported: false })
  });
  await service.connect(poolId);
  assert.equal(started, true, "missing diagnostic metadata must not block a healthy running service");
});

test("only the matching acknowledged reconnect clears the previous error; queued attempts do not replay stale 4013 errors", async () => {
  let runtime = { id: "bot", connectionRevision: "old", connectionState: "error", lastError: "old error 4013" };
  const account = { id: "bot", communityBotClientId: poolId, botToken: "secret", connectionRevision: "new", connectionRequestedAt: new Date().toISOString() };
  const service = createBotOnlinerManagement({ getConfig: async () => ({ enabled: true, accounts: [account] }),
    snapshot: async () => ({ accounts: [runtime] }),
    getWorkerStatus: async () => ({ online: true, paused: false, botGatewaySupported: true })
  });
  let state = (await service.status([poolId])).bots[0];
  assert.equal(state.state, "connecting");
  assert.equal(state.lastError, null);
  runtime = { ...runtime, connectionRevision: "new", lastError: "new error 4013" };
  state = (await service.status([poolId])).bots[0];
  assert.equal(state.state, "error");
  assert.equal(state.lastError, "new error 4013", "an error from this attempt stays visible");
  runtime = { ...runtime, connectionState: "connected" };
  state = (await service.status([poolId])).bots[0];
  assert.equal(state.state, "connected");
  assert.equal(state.lastError, null);
  runtime = { ...runtime, connectionRevision: "old" };
  account.connectionRequestedAt = new Date(Date.now() - 60_000).toISOString();
  state = (await service.status([poolId])).bots[0];
  assert.equal(state.state, "error");
  assert.match(state.lastError, /not been acknowledged/);
});

const serverSource = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const serverAst = ts.createSourceFile("index.mjs", serverSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionCode = name => serverAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(serverAst);

test("the real Onliner HELLO handler sends bot intents and READY acknowledges this exact reconnect", () => {
  const sockets = [], persisted = [], logs = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor() { super(); this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
  }
  const context = { URL, WebSocket: Socket, onlinerGatewayIdentify, Date, Math, Number,
    getDiscordOnlinerProxyEndpoint: () => "proxy", createDiscordOnlinerProxyAgent: () => ({}),
    onlinerAuthorizationRouteKey: () => "route", appendDiscordOnlinerLog: (_level, message) => logs.push(message),
    buildDiscordOnlinerAccountPresence: () => ({ status: "online", activities: [], since: null, afk: false }),
    createDiscordGatewayIdentityProperties: () => ({ browser: "account-client" }), createDiscordGatewayClientState: () => ({}),
    setTimeout: () => ({ unref() {} }), clearTimeout() {}, clearInterval() {},
    queueDiscordOnlinerRuntimePersist: runtime => persisted.push({ ...runtime }),
    scheduleDiscordOnlinerActivityRotation() {}, advanceDiscordOnlinerConnectionQueue() {},
    isDiscordGuildId: id => /^\d{16,22}$/.test(id)
  };
  vm.runInNewContext(functionCode("connectDiscordOnliner") + ";this.connect=connectDiscordOnliner;", context);
  const runtime = { generation: 1, guildIds: new Set(), state: "error", reconnectAttempt: 0 };
  const account = { id: "bot", isBot: true, botToken: "private", proxyUrl: "http://proxy:8080", connectionRevision: "request-42" };
  context.connect({ enabled: true }, account, runtime, 1);
  assert.equal(sockets.length, 1);
  sockets[0].emit("message", JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
  assert.equal(sockets[0].sent[0].op, 2);
  assert.equal(sockets[0].sent[0].d.intents, 1);
  assert.ok(!("client_state" in sockets[0].sent[0].d));
  assert.ok(logs.some(message => message.includes("bot · intents=1")));
  sockets[0].emit("message", JSON.stringify({ op: 0, s: 1, t: "READY", d: { user: { id: poolId, username: "bot" }, guilds: [] } }));
  assert.equal(runtime.state, "connected");
  assert.equal(runtime.connectionRevision, "request-42");
  assert.equal(runtime.identifyMode, "bot");
  assert.equal(runtime.gatewayIntents, 1);
  assert.equal(runtime.lastError, null);
  assert.ok(persisted.some(value => value.connectionRevision === "request-42"));
});

test("worker reconnect commands skip an already started revision and never reconnect unrelated profiles", async () => {
  let commands = [];
  const calls = [], runtime = new Map();
  const account = { id: "target", connectionRevision: "latest" };
  const context = { pool: { query: async sql => sql.includes("RETURNING id, command_type, payload") ? { rows: commands } : { rows: [] } },
    discordOnlinerConnectionsPaused: false, getDiscordOnlinerConfig: async () => ({ enabled: true, accounts: [account, { id: "other" }] }),
    discordOnlinerRuntimes: runtime, reconnectDiscordOnlinerAccount: (_config, value) => { calls.push(value.id); runtime.set(value.id, { connectionRevision: value.connectionRevision }); }
  };
  vm.runInNewContext(functionCode("processDiscordOnlinerWorkerCommands") + ";this.process=processDiscordOnlinerWorkerCommands;", context);
  commands = [{ id: 1, command_type: "reconnect_account", payload: { accountId: "target", connectionRevision: "latest" } }];
  await context.process();
  await context.process();
  assert.deepEqual(calls, ["target"]);
  commands = [{ id: 2, command_type: "reconnect_account", payload: { accountId: "target", connectionRevision: "stale" } }];
  await context.process();
  assert.deepEqual(calls, ["target"]);
});
