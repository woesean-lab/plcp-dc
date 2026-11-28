import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
import { planBotOnlinerConnection, assignMissingBotOnlinerProxies } from "./community-bot-onliner.mjs";
import { withoutManagedBotProfiles } from "./community-bot-management.mjs";

const sharedId = "111111111111111111", poolId = "222222222222222222";
const proxyUrl = "http://pool-proxy:8080";
const selectProxy = () => proxyUrl;
const bot = (id = sharedId, token = "bot-token") => ({ id: `community-bot-${id}`,
  communityBotClientId: id, botToken: token, proxyUrl, richPresenceEnabled: false, discordUserId: id });

test("connect adds only the selected bot to existing profiles with Rich Presence off", () => {
  const member = { id: "member", botToken: "member-token", proxyUrl: "http://member-proxy", richPresenceEnabled: true };
  const current = { enabled: true, accounts: [member], statuses: ["idle"], games: ["Member game"] };
  const original = structuredClone(current);
  for (const id of [sharedId, poolId]) {
    const plan = planBotOnlinerConnection(current, { clientId: id, botToken: "selected-token" }, 3000, selectProxy);
    assert.equal(plan.config.accounts.length, 2);
    assert.equal(plan.config.accounts[0], member);
    assert.equal(plan.account.communityBotClientId, id);
    assert.equal(plan.account.richPresenceEnabled, false);
    assert.equal(plan.account.proxyUrl, proxyUrl);
    assert.equal(plan.alreadyExisted, false);
    assert.deepEqual(withoutManagedBotProfiles(plan.config), plan.config);
  }
  assert.deepEqual(current, original);
});

test("connect is idempotent, reuses existing token profiles and enforces capacity only for additions", () => {
  const previous = { id: "existing", botToken: "selected-token", richPresenceEnabled: true };
  const current = { enabled: false, accounts: [previous] };
  const plan = planBotOnlinerConnection(current, { clientId: sharedId, botToken: previous.botToken }, 1, selectProxy);
  assert.equal(plan.alreadyExisted, true);
  assert.equal(plan.account.id, previous.id);
  assert.equal(plan.account.richPresenceEnabled, false);
  assert.equal(plan.config.enabled, false);
  const again = planBotOnlinerConnection(plan.config, { clientId: sharedId, botToken: "updated-token" }, 1, () => assert.fail("Keep the assigned proxy"));
  assert.equal(again.config.accounts.length, 1);
  assert.equal(again.account.botToken, "updated-token");
  assert.throws(() => planBotOnlinerConnection(current, { clientId: poolId, botToken: "other" }, 1, selectProxy), error => error.statusCode === 409);
  assert.throws(() => planBotOnlinerConnection({ accounts: [] }, { clientId: poolId, botToken: "other" }, 1, () => ""), error => error.statusCode === 409 && /proxy pool/.test(error.message));
});

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const code = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
test("proxy repair uses the existing pool balancer and leaves member and assigned bot routes intact", () => {
  const p1 = "http://pool-one:8080", p2 = "http://pool-two:8080", reserved = "http://stock-auth:8080";
  const member = { id: "member", proxyUrl: p1, richPresenceEnabled: true };
  const assigned = { ...bot("333333333333333333"), communityBotOnlinerEnabled: true, proxyUrl: p1 };
  const missing = [sharedId, poolId].map(id => ({ ...bot(id), communityBotOnlinerEnabled: true, proxyUrl: "" }));
  const current = { enabled: true, proxyPool: [p1, p2, reserved], stockAuthProxyPool: [reserved], accounts: [member, assigned, ...missing] };
  const original = structuredClone(current);
  const scope = { discordOnlinerProxyHealth: new Map(), discordOnlinerProxySelectionSequence: 0 };
  vm.runInNewContext(code("selectDiscordOnlinerProxy"), scope);
  const result = assignMissingBotOnlinerProxies(current, scope.selectDiscordOnlinerProxy);
  assert.deepEqual(result.assignedIds, missing.map(account => account.id));
  assert.equal(result.config.accounts[0], member);
  assert.equal(result.config.accounts[1], assigned);
  assert.deepEqual(result.config.accounts.slice(2).map(account => account.proxyUrl), [p2, p2]);
  assert.deepEqual(current, original);
  assert.equal(assignMissingBotOnlinerProxies(result.config, () => assert.fail("Do not rotate existing assignments")).config, result.config);
  assert.equal(assignMissingBotOnlinerProxies(current, () => "").config, current);
});

function repairFixture({ removed = false, failWrite = false } = {}) {
  const missing = { ...bot(), communityBotOnlinerEnabled: true, proxyUrl: "" };
  const member = { id: "member", botToken: "member-token", proxyUrl: "http://member-proxy", richPresenceEnabled: true };
  const original = { enabled: true, proxyPool: [proxyUrl], accounts: [member, missing] };
  let stored = { ...original, accounts: removed ? [member] : original.accounts, activityText: "Latest saved settings" };
  const calls = [];
  let released = 0;
  const client = { query: async (sql, args) => {
    calls.push(sql);
    if (sql.startsWith("SELECT")) return { rows: [{ encrypted_value: JSON.stringify(stored) }] };
    if (sql.startsWith("UPDATE")) {
      if (failWrite) throw Error("Database write failed");
      stored = JSON.parse(args[1]);
    }
    return { rows: [] };
  }, release: () => { released++; } };
  const scope = {
    getDiscordOnlinerConfig: async options => { assert.equal(options.hydrateMedia, false); return original; },
    pool: { connect: async () => client }, discordOnlinerSettingKey: "onliner",
    encryptCredential: value => value, decryptCredential: value => value,
    normalizeDiscordOnlinerConfig: value => value, withoutManagedBotProfiles,
    assignMissingBotOnlinerProxies, selectDiscordOnlinerProxy: selectProxy,
    hydrateDiscordOnlinerSpotifyPlaylist: async value => value
  };
  vm.runInNewContext(code("getDiscordOnlinerWorkerConfig"), scope);
  return { scope, calls, stored: () => stored, released: () => released };
}

test("worker repairs saved proxyless bots under the settings row lock before connecting", async () => {
  const f = repairFixture();
  const config = await f.scope.getDiscordOnlinerWorkerConfig();
  assert.equal(config.accounts[1].proxyUrl, proxyUrl);
  assert.equal(f.stored().accounts[1].proxyUrl, proxyUrl);
  assert.equal(config.accounts[0].proxyUrl, "http://member-proxy");
  assert.equal(config.activityText, "Latest saved settings");
  assert.match(f.calls[1], /FOR UPDATE/);
  assert.equal(f.calls.at(-1), "COMMIT");
  assert.equal(f.released(), 1);
});

test("proxy repair respects a concurrent disconnect and rolls back failed writes", async () => {
  const removed = repairFixture({ removed: true });
  const config = await removed.scope.getDiscordOnlinerWorkerConfig();
  assert.equal(config.accounts.length, 1);
  assert.equal(removed.calls.some(sql => sql.startsWith("UPDATE")), false);
  const failing = repairFixture({ failWrite: true });
  await assert.rejects(failing.scope.getDiscordOnlinerWorkerConfig(), /Database write failed/);
  assert.equal(failing.calls.at(-1), "ROLLBACK");
  assert.equal(failing.released(), 1);
  assert.equal(failing.stored().accounts[1].proxyUrl, "");
});

function gatewayFixture() {
  const sockets = [], timers = [], reconnects = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
  }
  const scope = {
    URL, process: { platform: "test" }, WebSocket: Socket,
    setTimeout: callback => { const timer = { callback, unref() {} }; timers.push(timer); return timer; },
    setInterval: () => ({ unref() {} }), clearTimeout() {}, clearInterval() {},
    appendDiscordOnlinerLog() {}, queueDiscordOnlinerRuntimePersist() {},
    onlinerAuthorizationRouteKey: () => "member-route", createDiscordOnlinerProxyAgent: () => "member-agent",
    getDiscordOnlinerProxyEndpoint: () => "member-proxy", recordDiscordOnlinerProxyHealth() {},
    createDiscordGatewayIdentityProperties: () => ({ browser: "existing-member-client" }), createDiscordGatewayClientState: () => ({}),
    buildDiscordOnlinerPresence: () => ({ activities: [{ name: "Member game" }], status: "idle" }),
    scheduleDiscordOnlinerActivityRotation() {}, advanceDiscordOnlinerConnectionQueue() {},
    isDiscordGuildId: value => /^\d{18}$/.test(value), discordGatewayCloseDiagnostics: new Map(),
    discordOnlinerShortSessionMs: 30_000, discordOnlinerFlapWindowMs: 600_000, discordOnlinerFlapThreshold: 5,
    getDiscordOnlinerAgeLabel: () => "0s", scheduleDiscordOnlinerReconnect: (...args) => reconnects.push(args)
  };
  vm.runInNewContext(["createDiscordOnlinerRuntime", "buildDiscordOnlinerAccountPresence", "connectDiscordOnliner", "verifyDiscordOnlinerRejectedToken"].map(code).join("\n"), scope);
  return { scope, sockets, timers, reconnects };
}

test("real transport sends bot IDENTIFY with online/empty activities and reuses heartbeat, READY and RESUME", () => {
  const { scope, sockets, timers, reconnects } = gatewayFixture();
  const account = bot(), config = { enabled: true, accounts: [account], statuses: ["idle"], randomizeEnabled: true };
  const runtime = scope.createDiscordOnlinerRuntime(account.id);
  runtime.config = config;
  scope.getDiscordOnlinerRuntime = () => runtime;
  scope.discordOnlinerConnectionsPaused = false;
  vm.runInNewContext(code("scheduleDiscordOnlinerAccountStart"), scope);
  scope.scheduleDiscordOnlinerAccountStart(config, account);
  const socket = sockets[0];
  assert.equal(socket.options.agent, "member-agent");
  socket.emit("message", JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
  const identify = socket.sent[0];
  assert.equal(identify.op, 2);
  assert.equal(identify.d.intents, 0);
  assert.deepEqual(identify.d.presence, { since: null, activities: [], status: "online", afk: false });
  assert.equal(identify.d.client_state, undefined);
  assert.equal(identify.d.capabilities, undefined);
  timers[0].callback();
  assert.deepEqual(socket.sent.at(-1), { op: 1, d: null });
  socket.emit("message", JSON.stringify({ op: 11 }));
  assert.equal(runtime.heartbeatAcknowledged, true);
  socket.emit("message", JSON.stringify({ op: 0, t: "READY", s: 42,
    d: { user: { id: sharedId, username: "Armut" }, session_id: "session", resume_gateway_url: "wss://gateway.discord.gg/" } }));
  assert.equal(runtime.state, "connected");
  socket.emit("close", 1006);
  assert.equal(reconnects.length, 1);
  scope.connectDiscordOnliner(config, account, runtime, 0);
  sockets[1].emit("message", JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
  assert.deepEqual(sockets[1].sent[0], { op: 6, d: { token: account.botToken, session_id: "session", seq: 42 } });
});

test("member IDENTIFY and dedicated proxy requirements stay intact", () => {
  const { scope, sockets } = gatewayFixture();
  const member = { id: "member", botToken: "member-token", proxyUrl: "http://member-proxy", richPresenceEnabled: true };
  const config = { enabled: true, accounts: [member] };
  scope.connectDiscordOnliner(config, { ...member, proxyUrl: "" }, scope.createDiscordOnlinerRuntime(member.id), 0);
  assert.equal(sockets.length, 0);
  scope.connectDiscordOnliner(config, member, scope.createDiscordOnlinerRuntime(member.id), 0);
  sockets[0].emit("message", JSON.stringify({ op: 10 }));
  assert.equal(sockets[0].options.agent, "member-agent");
  assert.equal(sockets[0].sent[0].d.capabilities, 16381);
  assert.deepEqual(sockets[0].sent[0].d.presence.activities, [{ name: "Member game" }]);
});

test("rejected bot tokens are checked with Bot authorization through the assigned proxy", async () => {
  const { scope } = gatewayFixture();
  let called = false;
  scope.requestDiscordThroughProxy = async (path, route, init) => {
    called = true;
    assert.equal(path, "users/@me");
    assert.equal(route, proxyUrl);
    assert.equal(init.headers.Authorization, "Bot bot-token");
    return { response: { status: 401, ok: false }, payload: {} };
  };
  await scope.verifyDiscordOnlinerRejectedToken(bot(), sharedId);
  assert.equal(called, true);
});

const routeCode = (method, path) => ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(ast) === "app." + method && node.expression.arguments[0]?.text === path).expression.arguments.at(-1).getText(ast);
function response() { return { statusCode: 200, status(value) { this.statusCode = value; return this; }, set() { return this; }, json(body) { this.body = body; return this; } }; }

test("Bots action resolves stored credentials and saves through the existing worker configuration; repeated requests do not duplicate", async () => {
  let config = { enabled: true, accounts: [{ id: "member", botToken: "member-token", richPresenceEnabled: true }] };
  const writes = [], reconciled = [];
  const scope = {
    resolveManagedCommunityBot: async id => { assert.equal(id, poolId); return { clientId: id, botToken: "stored-token" }; },
    getDiscordOnlinerConfig: async () => config, planBotOnlinerConnection, discordOnlinerAccountLimit: 3000,
    selectDiscordOnlinerProxy: selectProxy,
    normalizeDiscordOnlinerConfig: value => value, discordOnlinerSettingKey: "onliner",
    saveEncryptedSetting: async (key, value) => { assert.equal(key, "onliner"); config = JSON.parse(value); writes.push(config); },
    serviceRunsOnliner: false, discordOnlinerWorkerLockClient: null,
    reconcileDiscordOnlinerWorkerConfig: async (...args) => reconciled.push(args)
  };
  vm.runInNewContext("this.route = " + routeCode("post", "/api/community/bots/:clientId/onliner"), scope);
  const req = { params: { clientId: poolId }, body: { botToken: "untrusted-token", richPresenceEnabled: true } };
  const first = response();
  await scope.route(req, first, error => { throw error; });
  assert.equal(first.statusCode, 201);
  assert.equal(config.accounts[1].botToken, "stored-token");
  assert.equal(config.accounts[1].richPresenceEnabled, false);
  assert.equal(config.accounts[1].proxyUrl, proxyUrl);
  assert.equal(first.body.connected, undefined);
  assert.equal(JSON.stringify(first.body).includes("stored-token"), false);
  assert.equal(reconciled.length, 0);
  const second = response();
  await scope.route(req, second, error => { throw error; });
  assert.equal(second.statusCode, 200);
  assert.equal(config.accounts.length, 2);
  assert.equal(second.body.alreadyExisted, true);
  scope.serviceRunsOnliner = true;
  await scope.route(req, response(), error => { throw error; });
  assert.equal(reconciled.length, 0);
  scope.discordOnlinerWorkerLockClient = {};
  scope.discordOnlinerWorkerCurrentConfig = config;
  await scope.route(req, response(), error => { throw error; });
  assert.equal(reconciled.length, 1);
  scope.resolveManagedCommunityBot = async () => { throw Object.assign(Error("Unknown bot"), { statusCode: 404 }); };
  const before = writes.length;
  let failure;
  await scope.route(req, response(), error => { failure = error; });
  assert.equal(failure.statusCode, 404);
  assert.equal(writes.length, before);
});

test("Bots reads the same live worker states as Members, including failures and an offline worker, without credentials", async () => {
  const config = { enabled: true, accounts: [
    { id: "member", botToken: "member-token" },
    { id: "selected-bot", discordUserId: sharedId, communityBotClientId: sharedId, communityBotOnlinerEnabled: true, botToken: "secret" }
  ] };
  let state = "connected", failure = null, workerOnline = true;
  const scope = {
    getDiscordOnlinerConfig: async () => config,
    isDiscordGuildId: value => /^\d{18}$/.test(value), serviceRunsOnliner: false,
    discordOnlinerWorkerHeartbeatMs: 10000, normalizeDiscordOnlinerConnectionState: value => value,
    pool: { query: async sql => ({ rows: sql.includes("FROM discord_onliner_runtime")
      ? [{ account_id: "selected-bot", discord_user_id: sharedId, payload: { connectionState: state, lastError: failure } }]
      : [{ status: workerOnline ? "online" : "offline", heartbeat_at: new Date().toISOString() }] }) }
  };
  vm.runInNewContext(code("loadCommunityStockOnlinerStates"), scope);
  vm.runInNewContext("this.route = " + routeCode("get", "/api/community/bots/onliner"), scope);
  const res = response();
  await scope.route({}, res, error => { throw error; });
  assert.deepEqual(JSON.parse(JSON.stringify(res.body)), { bots: [{ clientId: sharedId, accountId: "selected-bot", connectionState: "connected", lastError: null }] });
  state = "error"; failure = "Discord rejected the token.";
  await scope.route({}, res, error => { throw error; });
  assert.equal(res.body.bots[0].connectionState, "error");
  assert.equal(res.body.bots[0].lastError, failure);
  state = "connected"; workerOnline = false;
  await scope.route({}, res, error => { throw error; });
  assert.equal(res.body.bots[0].connectionState, "disconnected");
  assert.equal(res.body.bots[0].lastError, "Onliner worker is offline.");
  config.enabled = false; workerOnline = true;
  await scope.route({}, res, error => { throw error; });
  assert.equal(res.body.bots[0].connectionState, "disconnected");
  assert.equal(res.body.bots[0].lastError, "Onliner is disabled.");
});

test("existing profile removal disconnects only the selected bot and clears its runtime", async () => {
  let config = { enabled: true, accounts: [bot(), bot(poolId), { id: "member", botToken: "member-token" }] };
  const stopped = [], queries = [];
  const scope = {
    getDiscordOnlinerConfig: async () => config, normalizeDiscordOnlinerConfig: value => value,
    discordOnlinerSettingKey: "onliner", saveEncryptedSetting: async (_key, value) => { config = JSON.parse(value); },
    serviceRunsOnliner: true, discordOnlinerWorkerLockClient: {},
    discordOnlinerRuntimes: new Map(config.accounts.map(account => [account.id, { accountId: account.id }])),
    discordOnlinerPendingRuntimeWrites: new Map(config.accounts.map(account => [account.id, {}])),
    stopDiscordOnlinerRuntime: runtime => stopped.push(runtime.accountId), appendDiscordOnlinerLog() {},
    pool: { query: async (sql, args) => { queries.push({ sql, args }); return { rows: [] }; } },
    getDiscordOnlinerSnapshotForApi: async value => ({ accounts: value.accounts.map(account => ({ id: account.id })) })
  };
  vm.runInNewContext("this.route = " + routeCode("delete", "/api/onliner/accounts/:accountId"), scope);
  await scope.route({ params: { accountId: bot().id } }, response(), error => { throw error; });
  assert.deepEqual(stopped, [bot().id]);
  assert.deepEqual(config.accounts.map(account => account.id), [bot(poolId).id, "member"]);
  assert.equal(scope.discordOnlinerRuntimes.has(bot().id), false);
  assert.equal(scope.discordOnlinerPendingRuntimeWrites.has(bot().id), false);
  assert.equal(queries[0].args[0], bot().id);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.discordOnlinerWorkerCurrentConfig)), config);
});
