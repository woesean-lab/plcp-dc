import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionCode = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
const routeCode = path => ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "app.get" && node.expression.arguments[0]?.text === path).expression.arguments.at(-1).getText(ast);
const userId = "123456789012345678";

function stockFixture() {
  const category = { id: "offline", summary: { joined: 0, authorized: 1, ready: 1, alreadyMember: 0, failed: 0 } };
  const calls = [];
  const scope = {
    console, Date, Error,
    getCommunityOAuthConfig: async () => ({ configured: true, guildId: "stock", clientId: "default" }),
    normalizeCommunityStockRecords: async () => {},
    parseCommunityCategoryId: value => value,
    loadCommunityStockCategories: async () => [category],
    communityBotCache: { clientId: "pool-bot", value: { id: "pool-bot" } },
    communityGuildCache: null,
    fallbackCommunityBot: config => ({ id: config.clientId, unavailable: true }),
    fallbackCommunityGuild: config => ({ id: config.guildId, unavailable: true }),
    loadCommunityBotSafe: () => { throw Error("Stock must not fetch live Discord identity"); },
    loadCommunityGuildSafe: () => { throw Error("Stock must not fetch live Discord guild"); },
    getDiscordOnlinerConfig: async options => {
      assert.equal(options.hydrateMedia, false);
      return { accounts: [] };
    },
    pool: { query: async (sql, args) => {
      calls.push({ sql, args });
      return { rows: [{ discord_user_id: userId, username: "sample", stock_type: args[1], status: "authorized", sort_position: 1, has_stored_account_token: true }] };
    } },
    communityMemberServerMembershipCache: new Map([[userId, new Set(["server"])]]),
    getCommunityAuthorizationSyncSnapshot: () => null,
    normalizeCommunityStockType: value => value
  };
  vm.runInNewContext(`${functionCode("loadCommunityStockOnlinerStates")}\nthis.route = ${routeCode("/api/community/status")};`, scope);
  const res = { set() { return this; }, json(body) { this.body = body; return this; } };
  return { scope, calls, res, run: categoryId => scope.route({ query: { categoryId } }, res, error => { throw error; }) };
}

test("stock loads its selected category after pool cache eviction without external identity or media calls", async () => {
  const fixture = stockFixture();
  await fixture.run("offline");
  assert.equal(fixture.res.body.authorized, 1);
  assert.equal(fixture.res.body.activeCategoryId, "offline");
  assert.equal(fixture.res.body.recent.length, 1);
  assert.equal(fixture.res.body.recent[0].joinedServerCount, 1);
  assert.equal(fixture.res.body.bot.id, "default");
  assert.equal(fixture.calls.length, 1);
  assert.deepEqual(Array.from(fixture.calls[0].args), ["stock", "offline"]);
});

test("a removed category falls back to the returned category, and query failures remain errors", async () => {
  const fixture = stockFixture();
  await fixture.run("removed-category");
  assert.equal(fixture.res.body.activeCategoryId, "offline");
  assert.equal(fixture.res.body.recent[0].stockType, "offline");
  fixture.scope.pool.query = async () => { throw Error("Database unavailable"); };
  await assert.rejects(fixture.run("offline"), /Database unavailable/);
});

test("saved Onliner config skips media hydration only when explicitly requested", async () => {
  let hydrated = 0;
  const scope = {
    loadEncryptedSetting: async () => JSON.stringify({ accounts: [{ id: "member", botToken: "private" }] }),
    discordOnlinerSettingKey: "onliner",
    normalizeDiscordOnlinerConfig: value => value,
    withoutManagedBotProfiles: value => value,
    hydrateDiscordOnlinerSpotifyPlaylist: async config => { hydrated++; return { ...config, hydrated: true }; }
  };
  vm.runInNewContext(`${functionCode("getDiscordOnlinerConfig")};this.load = getDiscordOnlinerConfig;`, scope);
  assert.equal((await scope.load({ hydrateMedia: false })).accounts.length, 1);
  assert.equal(hydrated, 0);
  assert.equal((await scope.load()).hydrated, true);
  assert.equal(hydrated, 1);
});

test("compact stock polling retains member runtime state without returning tokens or media", async () => {
  const scope = {
    Date,
    getDiscordOnlinerConfig: async ({ hydrateMedia }) => {
      assert.equal(hydrateMedia, false);
      return { accounts: [{ id: "member", discordUserId: userId, botToken: "private-token", richPresenceEnabled: false }] };
    },
    isDiscordGuildId: value => /^\d{18}$/.test(value),
    serviceRunsOnliner: false, discordOnlinerWorkerHeartbeatMs: 10000,
    normalizeDiscordOnlinerConnectionState: value => value,
    pool: { query: async sql => ({ rows: sql.includes("FROM discord_onliner_runtime")
      ? [{ account_id: "member", discord_user_id: userId, payload: { connectionState: "online", lastError: null, media: "private-media" } }]
      : [{ status: "online", heartbeat_at: new Date().toISOString() }] }) }
  };
  vm.runInNewContext(`${functionCode("loadCommunityStockOnlinerStates")}\nthis.route = ${routeCode("/api/community/stock-onliner")};`, scope);
  const res = { set() { return this; }, json(body) { this.body = body; } };
  await scope.route({}, res, error => { throw error; });
  assert.deepEqual(JSON.parse(JSON.stringify(res.body)), { accounts: [{ id: "member", connectionState: "online", lastError: null, richPresenceEnabled: false }] });
  scope.pool.query = async sql => ({ rows: sql.includes("FROM discord_onliner_runtime") ? [] : [{ status: "offline" }] });
  await scope.route({}, res, error => { throw error; });
  assert.equal(res.body.accounts[0].connectionState, "disconnected");
  assert.equal(res.body.accounts[0].lastError, "Onliner worker is offline.");
});
