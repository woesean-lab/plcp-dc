import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createOrderBotService } from "./community-order-bot.mjs";
import { authorizeCommunityStockAccount } from "./community-stock-authorization.mjs";

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const code = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
const user = "123456789012345678", app = "234567890123456789", proxy = "http://assigned-proxy:8080";
function fixture({ identityUser = user, identityApp = app, scopes = ["identify", "guilds.join"], rejection = false } = {}) {
  const events = [], saved = [];
  const member = { discord_user_id: user, encrypted_account_token: "encrypted-account" };
  const settings = { configured: true, clientId: app, poolBotId: app, guildId: "stock", redirectUri: "https://example.com/callback" };
  const scope = {
    Error, console,
    decryptCredential: value => value === "encrypted-account" ? "account-token" : value,
    encryptCredential: value => value,
    getDiscordOnlinerConfig: async options => { assert.equal(options.hydrateMedia, false); return { accounts: [{ id: "profile", botToken: "account-token", proxyUrl: proxy }] }; },
    normalizeDiscordOnlinerProxyUrl: value => value,
    selectDiscordOnlinerProxy: () => assert.fail("Keep the assigned proxy"),
    getConnectedCommunityAuthorizationGatewayUser: async () => { events.push("gateway-lookup"); return null; },
    runWithHumanizerGatewaySession: async (account, task) => { events.push("gateway-connect"); return task({ id: user }); },
    requestDiscordThroughProxy: async (path, route) => {
      assert.equal(route, proxy); events.push(path);
      if (path === "users/@me") return { response: { ok: true }, payload: { id: user } };
      if (path.startsWith("oauth2/authorize?")) return rejection
        ? { response: { ok: false, status: 403 }, payload: { message: "You need to verify your account in order to perform this action." } }
        : { response: { ok: true }, payload: { location: `${settings.redirectUri}?code=code` } };
      assert.equal(path, "oauth2/@me");
      return { response: { ok: true }, payload: { user: { id: identityUser }, application: { id: identityApp }, scopes } };
    },
    exchangeCommunityOAuthAuthorizationCode: async (_config, _code, _redirect, route) => {
      assert.equal(route, proxy); events.push("exchange"); return { accessToken: "access-token", refreshToken: "refresh-token", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
    },
    refreshStoredCommunityOAuthCredential: async () => { throw Object.assign(Error("Missing shared grant"), { oauthAccessInvalid: true }); },
    authorizeCommunityStockAccount,
    pool: { query: async (sql, args) => {
      if (sql.startsWith("SELECT encrypted_value")) return { rows: [] };
      if (sql.startsWith("INSERT INTO community_bot_pool_credentials") || sql.includes("UPDATE community_oauth_joins")) { saved.push(args); return { rows: [] }; }
      throw Error(`Unexpected SQL: ${sql}`);
    } }
  };
  vm.runInNewContext(`${code("authorizeStockMemberForBot")}\n${code("synchronizeStockMemberForBot")};this.sync = synchronizeStockMemberForBot;this.authorize = authorizeStockMemberForBot;`, scope);
  scope.orderBotService = createOrderBotService({ pool: scope.pool, encrypt: value => value, decrypt: value => value,
    authorize: scope.authorize, request: () => assert.fail("Fresh OAuth identity must not be fetched again"), refresh: () => assert.fail("No stored refresh grant") });
  return { scope, events, saved, member, settings };
}

test("pool Sync uses only the assigned proxy REST flow and verifies OAuth identity exactly once", async () => {
  const f = fixture();
  assert.equal(await f.scope.sync(f.settings, f.member), "access-token");
  assert.equal(f.events.some(event => event.startsWith("gateway")), false);
  assert.equal(f.events.filter(event => event === "oauth2/@me").length, 1);
  assert.equal(f.events.length, 4);
  assert.equal(f.settings.gatewayBeforeAuth, undefined);
  const grant = JSON.parse(f.saved[0][2]);
  assert.deepEqual(Object.keys(grant).sort(), ["accessToken", "clientId", "expiresAt", "refreshToken"]);
});

test("default Sync fallback also uses REST while ordinary authorization retains its Gateway step", async () => {
  const f = fixture();
  await f.scope.sync({ ...f.settings, isDefault: true }, f.member);
  assert.equal(f.events.some(event => event.startsWith("gateway")), false);
  await f.scope.authorize(f.settings, f.member);
  assert.equal(f.events.filter(event => event === "gateway-connect").length, 1);
});

test("reusing the OAuth identity never permits another application, member or missing guilds.join", async () => {
  for (const options of [{ identityApp: "wrong-app" }, { identityUser: "345678901234567890" }, { scopes: ["identify"] }]) {
    const f = fixture(options);
    await assert.rejects(f.scope.sync(f.settings, f.member));
    assert.equal(f.saved.length, 0);
  }
});

test("verification-required responses remain failed authorizations and store no grant", async () => {
  const f = fixture({ rejection: true });
  await assert.rejects(f.scope.sync(f.settings, f.member), error => error.statusCode === 409 && /verify your account/.test(error.message));
  assert.equal(f.saved.length, 0);
  assert.equal(f.events.includes("exchange"), false);
});
