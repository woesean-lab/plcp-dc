import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";
import { planBotOnlinerConnection } from "./community-bot-onliner.mjs";
import { withoutManagedBotProfiles } from "./community-bot-management.mjs";

const sharedId = "111111111111111111", poolId = "222222222222222222";
const bot = (id = sharedId, token = "bot-token") => ({ id: `community-bot-${id}`,
  communityBotClientId: id, botToken: token, proxyUrl: "", richPresenceEnabled: false, discordUserId: id });

test("connect adds only the selected bot to existing profiles with Rich Presence off", () => {
  const member = { id: "member", botToken: "member-token", proxyUrl: "http://member-proxy", richPresenceEnabled: true };
  const current = { enabled: true, accounts: [member], statuses: ["idle"], games: ["Member game"] };
  const original = structuredClone(current);
  for (const id of [sharedId, poolId]) {
    const plan = planBotOnlinerConnection(current, { clientId: id, botToken: "selected-token" }, 3000);
    assert.equal(plan.config.accounts.length, 2);
    assert.equal(plan.config.accounts[0], member);
    assert.equal(plan.account.communityBotClientId, id);
    assert.equal(plan.account.richPresenceEnabled, false);
    assert.equal(plan.account.proxyUrl, "");
    assert.equal(plan.alreadyExisted, false);
    assert.deepEqual(withoutManagedBotProfiles(plan.config), plan.config);
  }
  assert.deepEqual(current, original);
});

test("connect is idempotent, reuses existing token profiles and enforces capacity only for additions", () => {
  const previous = { id: "existing", botToken: "selected-token", richPresenceEnabled: true };
  const current = { enabled: false, accounts: [previous] };
  const plan = planBotOnlinerConnection(current, { clientId: sharedId, botToken: previous.botToken }, 1);
  assert.equal(plan.alreadyExisted, true);
  assert.equal(plan.account.id, previous.id);
  assert.equal(plan.account.richPresenceEnabled, false);
  assert.equal(plan.config.enabled, false);
  const again = planBotOnlinerConnection(plan.config, { clientId: sharedId, botToken: "updated-token" }, 1);
  assert.equal(again.config.accounts.length, 1);
  assert.equal(again.account.botToken, "updated-token");
  assert.throws(() => planBotOnlinerConnection(current, { clientId: poolId, botToken: "other" }, 1), error => error.statusCode === 409);
});

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const code = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
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
  assert.equal(socket.options.agent, undefined);
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

test("rejected bot tokens are checked with Bot authorization through the bot REST API", async () => {
  const { scope } = gatewayFixture();
  let called = false;
  scope.requestDiscord = async (path, init) => {
    called = true;
    assert.equal(path, "users/@me");
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

test("Bots registration list returns only IDs of explicitly connected bots without credentials or member profiles", async () => {
  const scope = { getDiscordOnlinerConfig: async () => ({ accounts: [
    { id: "member", botToken: "member-token" },
    { id: "selected-bot", communityBotClientId: sharedId, communityBotOnlinerEnabled: true, botToken: "secret" }
  ] }) };
  vm.runInNewContext("this.route = " + routeCode("get", "/api/community/bots/onliner"), scope);
  const res = response();
  await scope.route({}, res, error => { throw error; });
  assert.deepEqual(JSON.parse(JSON.stringify(res.body)), { bots: [{ clientId: sharedId, accountId: "selected-bot" }] });
});
