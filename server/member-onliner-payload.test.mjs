import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import ts from "typescript";

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const code = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
function fixture() {
  const sockets = [];
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
  }
  const scope = {
    URL, WebSocket: Socket, setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} }),
    appendDiscordOnlinerLog() {}, queueDiscordOnlinerRuntimePersist() {},
    onlinerAuthorizationRouteKey: () => "existing-member-route", createDiscordOnlinerProxyAgent: () => "existing-proxy-agent",
    getDiscordOnlinerProxyEndpoint: () => "member-proxy", recordDiscordOnlinerProxyHealth() {},
    buildDiscordOnlinerPresence: () => ({ since: null, activities: [{ name: "Member game", type: 0 }], status: "idle", afk: false }),
    chooseDiscordOnlinerStatus: () => "online"
  };
  vm.runInNewContext(["createDiscordGatewayIdentityProperties", "createDiscordGatewayClientState", "createDiscordOnlinerRuntime",
    "buildDiscordOnlinerAccountPresence", "connectDiscordOnliner", "verifyDiscordOnlinerRejectedToken"].map(code).join("\n"), scope);
  return { scope, sockets };
}

test("normal member IDENTIFY retains the original client properties, capabilities and client_state without bot intents", () => {
  const { scope, sockets } = fixture();
  const member = { id: "member", botToken: "member-token", proxyUrl: "http://member-proxy:8080", richPresenceEnabled: true };
  const config = { enabled: true, accounts: [member] };
  scope.connectDiscordOnliner(config, { ...member, proxyUrl: "" }, scope.createDiscordOnlinerRuntime(member.id), 0);
  assert.equal(sockets.length, 0);
  scope.connectDiscordOnliner(config, member, scope.createDiscordOnlinerRuntime(member.id), 0);
  sockets[0].emit("message", JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
  const identify = sockets[0].sent[0];
  assert.equal(sockets[0].options.agent, "existing-proxy-agent");
  assert.equal(identify.op, 2);
  assert.equal(identify.d.token, member.botToken);
  assert.equal(identify.d.intents, undefined);
  assert.equal(identify.d.capabilities, 16381);
  assert.equal(identify.d.compress, false);
  assert.equal(identify.d.properties.os, "Windows");
  assert.equal(identify.d.properties.browser, "Discord Client");
  assert.equal(identify.d.properties.device, "desktop");
  assert.equal(identify.d.properties.client_build_number, 280000);
  assert.deepEqual(identify.d.client_state, { guild_versions: {}, highest_last_message_id: "0", read_state_version: 0,
    user_guild_settings_version: -1, user_settings_version: -1, private_channels_version: "0", api_code_version: 0 });
  assert.deepEqual(identify.d.presence.activities, [{ name: "Member game", type: 0 }]);
});

test("member presence uses its existing settings without a special managed-bot override", () => {
  const { scope } = fixture();
  const account = { id: "member", richPresenceEnabled: true, communityBotClientId: "111111111111111111" };
  const runtime = scope.createDiscordOnlinerRuntime(account.id);
  assert.equal(scope.buildDiscordOnlinerAccountPresence({}, account, runtime).status, "idle");
  account.richPresenceEnabled = false;
  const presence = scope.buildDiscordOnlinerAccountPresence({}, account, runtime);
  assert.equal(presence.status, "online");
  assert.equal(presence.activities.length, 0);
});

test("normal member token checks retain the existing raw-token proxy transport", async () => {
  const { scope } = fixture();
  let called = false;
  scope.sendHumanizerDiscordRequest = async (path, proxy, token, method) => {
    called = true;
    assert.equal(path, "users/@me"); assert.equal(proxy, "http://member-proxy:8080");
    assert.equal(token, "member-token"); assert.equal(method, "GET");
    return { response: { status: 401, ok: false }, payload: {} };
  };
  await scope.verifyDiscordOnlinerRejectedToken({ id: "member", botToken: "member-token", proxyUrl: "http://member-proxy:8080" }, "111111111111111111");
  assert.equal(called, true);
});
