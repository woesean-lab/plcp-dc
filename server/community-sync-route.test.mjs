import test from "node:test";
import assert from "node:assert/strict";
import { describeBotSyncRoute } from "./community-sync-route.mjs";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("route diagnostics expose only a credential-free endpoint, including IPv6", () => {
  for (const [url, endpoint] of [["http://private-user:private-pass@proxy.example:8080/private-path?token=private-token", "proxy.example:8080"], ["socks5://u:p@[2001:db8::1]:1080", "[2001:db8::1]:1080"]]) {
    const route = describeBotSyncRoute({ mode: "authorization", transport: "proxy", source: "linked", proxyUrl: url, token: "account-secret" }, "123");
    assert.equal(route.endpoint, endpoint);
    assert.equal(route.source, "linked");
    assert.doesNotMatch(JSON.stringify(route), /private-|account-secret|u:p/);
  }
  for (const url of ["invalid secret", "file:///private", "javascript:secret"]) assert.equal(describeBotSyncRoute({ transport: "proxy", proxyUrl: url }, "123").endpoint, null);
});

test("server refresh and cached grants never manufacture a proxy or measured IP", () => {
  const refresh = describeBotSyncRoute({ mode: "refresh", transport: "server", proxyUrl: "http://secret@host" }, "123");
  assert.equal(refresh.endpoint, null); assert.equal(refresh.source, "server");
  const reused = describeBotSyncRoute({ mode: "reused", transport: "none" }, "123");
  assert.equal(reused.transport, "none"); assert.equal(reused.endpoint, null);
  assert.equal(describeBotSyncRoute({}, "123").mode, "unknown");
});

const ast = ts.createSourceFile("index.mjs", fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const code = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
test("fresh bot authorization publishes its actual selected proxy before network work, including offline accounts", async () => {
  for (const linked of [false, true]) {
    const events = [];
    const assigned = "http://u:p@assigned:8080", pooled = "http://u:p@pool:8080";
    const context = { decryptCredential: () => "account-token", normalizeDiscordOnlinerProxyUrl: value => value,
      getDiscordOnlinerConfig: async () => ({ accounts: linked ? [{ botToken: "account-token", proxyUrl: assigned }] : [] }),
      selectDiscordOnlinerProxy: () => pooled,
      authorizeCommunityStockAccount: async args => { events.push("network"); assert.equal(args.proxyUrl, linked ? assigned : pooled); assert.equal(args.gatewayBeforeAuth, false); return { discordUserId: "123", oauth: {}, oauthIdentity: {} }; },
      runWithHumanizerGatewaySession() {}, getConnectedCommunityAuthorizationGatewayUser() {}, requestDiscordThroughProxy() {}, exchangeCommunityOAuthAuthorizationCode() {}
    };
    vm.runInNewContext(code("authorizeStockMemberForBot") + ";this.run=authorizeStockMemberForBot", context);
    await context.run({ gatewayBeforeAuth: false, onSyncRoute: async route => { events.push("route"); assert.equal(route.mode, "authorization"); assert.equal(route.proxyUrl, linked ? assigned : pooled); assert.equal(route.source, linked ? "linked" : "pool"); } }, { discord_user_id: "123", encrypted_account_token: "encrypted" });
    assert.deepEqual(events, ["route", "network"]);
  }
});

test("OAuth refresh publishes a server route before its existing direct request", async () => {
  const events = [];
  const context = { URLSearchParams, AbortSignal, discordApiBase: "https://discord.invalid/api/v10",
    fetch: async () => { events.push("network"); return { ok: true, status: 200, json: async () => ({ access_token: "a".repeat(30), refresh_token: "r".repeat(30), expires_in: 3600 }) }; }
  };
  vm.runInNewContext(code("exchangeCommunityOAuthRefreshToken") + ";this.run=exchangeCommunityOAuthRefreshToken", context);
  await context.run({ clientId: "app", onSyncRoute: async route => { events.push("route"); assert.equal(route.mode, "refresh"); assert.equal(route.transport, "server"); } }, "refresh-secret");
  assert.deepEqual(events, ["route", "network"]);
});
