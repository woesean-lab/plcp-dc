import test from "node:test";
import assert from "node:assert/strict";
import { createOrderBotService } from "./community-order-bot.mjs";

const user = "111111111111111111";
const appId = "222222222222222222";
const base = { clientId: "333333333333333333", guildId: "444444444444444444", botToken: "shared-token", clientSecret: "shared-secret" };
const encrypt = value => Buffer.from(value).toString("base64");
const decrypt = value => Buffer.from(value, "base64").toString();
const config = (orderBotId = "order-one", clientId = appId) => ({ orderBotId, clientId, guildId: "555555555555555555", configured: true });
function fixture({ identityUser = user, identityApp = appId, scopes = ["identify", "guilds.join"], secretValid = true, identityStatus = 200 } = {}) {
  const settings = new Map();
  const tokens = new Map();
  const calls = { authorize: [], refresh: [] };
  const pool = { async query(sql, args) {
    if (sql.startsWith("INSERT INTO app_settings")) settings.set(args[0], args[1]);
    else if (sql.startsWith("SELECT encrypted_value FROM app_settings")) return { rows: settings.has(args[0]) ? [{ encrypted_value: settings.get(args[0]) }] : [] };
    else if (sql.startsWith("SELECT encrypted_value FROM community_order_bot_credentials")) return { rows: tokens.has(`${args[0]}:${args[1]}`) ? [{ encrypted_value: tokens.get(`${args[0]}:${args[1]}`) }] : [] };
    else if (sql.startsWith("INSERT INTO community_order_bot_credentials")) tokens.set(`${args[0]}:${args[1]}`, args[2]);
    else throw Error(`Unexpected database operation: ${sql}`);
    return { rows: [] };
  } };
  const oauth = prefix => ({ accessToken: `${prefix}-access`, refreshToken: `${prefix}-refresh`, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
  const service = createOrderBotService({ pool, encrypt, decrypt,
    async request(path) {
      if (path === "oauth2/applications/@me") return { response: { ok: true }, payload: { id: appId, name: "New app", secret: "must-not-return" } };
      if (path === "oauth2/token") return { response: { ok: secretValid }, payload: {} };
      if (path.startsWith("guilds/")) return { response: { ok: false }, payload: {} };
      return { response: { ok: identityStatus === 200, status: identityStatus }, payload: { user: { id: identityUser }, application: { id: identityApp }, scopes } };
    },
    async authorize(c, member) { calls.authorize.push([c.orderBotId, member.discord_user_id]); return oauth(c.orderBotId); },
    async refresh(c, refreshToken) { calls.refresh.push([c.orderBotId, refreshToken]); return oauth(`${c.orderBotId}-refreshed`); }
  });
  return { service, settings, tokens, calls, pool };
}

test("inspection returns identity without secrets, and supports a bot not yet in the target guild", async () => {
  const { service } = fixture();
  const safe = await service.inspect("a-valid-bot-token-long-enough", config().guildId);
  assert.equal(safe.clientId, appId);
  assert.equal(safe.botInGuild, false);
  assert.ok(!JSON.stringify(safe).includes("must-not-return"));
  assert.ok(!("botToken" in safe));
});

test("OAuth-only delivery cannot authorize raw stock accounts, including when authorization is explicitly requested", async () => {
  const { service, calls, tokens } = fixture();
  await assert.rejects(service.token({ ...config(), oauthOnly: true }, { discord_user_id: user, encrypted_account_token: "raw-account" }, { allowAuthorize: true }), error => error.oauthAccessInvalid);
  assert.equal(calls.authorize.length, 0); assert.equal(tokens.size, 0);
  assert.equal(await service.token(config(), { discord_user_id: user, encrypted_account_token: "raw-account" }), "order-one-access");
  assert.equal(calls.authorize.length, 1, "existing orders without the new policy keep their original behavior");
});

test("OAuth-only delivery can use an unexpired access token without a refresh token and never reauthorize after expiry", async () => {
  const { service, calls, tokens } = fixture();
  tokens.set(`order-one:${user}`, encrypt(JSON.stringify({ clientId: appId, accessToken: "synced-access", expiresAt: new Date(Date.now() + 3600000).toISOString() })));
  assert.equal(await service.token({ ...config(), oauthOnly: true }, { discord_user_id: user }), "synced-access");
  tokens.set(`order-one:${user}`, encrypt(JSON.stringify({ clientId: appId, accessToken: "expired-access", expiresAt: new Date(0).toISOString() })));
  await assert.rejects(service.token({ ...config(), oauthOnly: true }, { discord_user_id: user, encrypted_account_token: "raw-account" }), error => error.oauthAccessInvalid);
  assert.equal(calls.authorize.length, 0); assert.equal(calls.refresh.length, 0);
});

test("OAuth-only policy survives saved configuration loading and allows existing refresh grants", async () => {
  const { service, pool, tokens, calls } = fixture();
  await service.save(pool, { ...config(), oauthOnly: true });
  const loaded = await service.load({ customBot: true, uniqid: "order-one", serverId: config().guildId, botApplicationId: appId }, base);
  assert.equal(loaded.oauthOnly, true);
  tokens.set(`order-one:${user}`, encrypt(JSON.stringify({ clientId: appId, accessToken: "expired", refreshToken: "saved-refresh", expiresAt: new Date(0).toISOString() })));
  assert.equal(await service.token(loaded, { discord_user_id: user }), "order-one-refreshed-access");
  assert.equal(calls.refresh.length, 1); assert.equal(calls.authorize.length, 0);
});

test("an invalid refresh on an OAuth-only order cannot fall back to raw account authorization", async () => {
  const queries = [], stored = encrypt(JSON.stringify({ clientId: appId, refreshToken: "invalid-refresh", expiresAt: new Date(0).toISOString() }));
  let authorized = 0;
  const service = createOrderBotService({ encrypt, decrypt, pool: { query: async sql => { queries.push(sql); return { rows: [{ encrypted_value: stored }] }; } },
    authorize: async () => { authorized++; }, refresh: async () => { throw Object.assign(Error("Invalid refresh"), { oauthRefreshInvalid: true }); } });
  await assert.rejects(service.token({ ...config(), oauthOnly: true }, { discord_user_id: user, encrypted_account_token: "raw" }), error => error.oauthRefreshInvalid);
  assert.equal(authorized, 0); assert.equal(queries.length, 1);
});

test("prepared credentials are encrypted separately; loading a missing order bot never falls back to the shared bot", async () => {
  const { service, pool, settings } = fixture();
  const prepared = await service.prepare({ botToken: "a-valid-bot-token-long-enough", clientSecret: "private-secret" }, base,
    { orderId: "order-one", guildId: config().guildId, redirectUri: "https://example.com/callback" });
  await service.save(pool, prepared);
  assert.equal(settings.has("community_oauth_config"), false);
  assert.ok(!settings.get("community_order_bot:order-one").includes("private-secret"));
  const loaded = await service.load({ customBot: true, uniqid: "order-one", serverId: config().guildId, botApplicationId: appId }, base);
  assert.equal(loaded.clientSecret, "private-secret");
  assert.equal(loaded.stockGuildId, base.guildId);
  assert.equal(await service.load({}, base), base);
  await assert.rejects(service.load({ customBot: true, uniqid: "missing" }, base), /missing/);
  await assert.rejects(service.load({ customBot: true, uniqid: "order-one", botApplicationId: "wrong" }, base), /does not match/);
});

test("invalid secret and the shared application cannot be used as a new bot", async () => {
  await assert.rejects(fixture({ secretValid: false }).service.prepare({ botToken: "a-valid-bot-token-long-enough", clientSecret: "bad" }, base, { orderId: "one" }), /secret could not be verified/);
  await assert.rejects(fixture().service.prepare({ botToken: "a-valid-bot-token-long-enough", clientSecret: "ok" }, { ...base, clientId: appId }, { orderId: "one" }), /different Discord application/);
});

test("the same stock member receives isolated order grants and concurrent requests authorize only once", async () => {
  const { service, tokens, calls } = fixture();
  const member = { discord_user_id: user, encrypted_access_token: "shared-grant-must-never-be-used" };
  assert.deepEqual(await Promise.all([service.token(config(), member), service.token(config(), member)]), ["order-one-access", "order-one-access"]);
  assert.equal(calls.authorize.length, 1);
  assert.equal(await service.token(config("order-two"), member), "order-two-access");
  assert.equal(tokens.size, 2);
  assert.equal(member.encrypted_access_token, "shared-grant-must-never-be-used");
  assert.equal(await service.token(config(), member), "order-one-access");
  assert.equal(calls.authorize.length, 2);
});

test("wrong user, application or missing scope cannot persist a grant", async () => {
  for (const options of [{ identityUser: "wrong" }, { identityApp: "wrong" }, { scopes: ["identify"] }]) {
    const { service, tokens } = fixture(options);
    await assert.rejects(service.token(config(), { discord_user_id: user }), /different member or application/);
    assert.equal(tokens.size, 0);
  }
});

test("member checks do not authorize accounts, and refresh updates only the chosen order grant", async () => {
  const { service, tokens, calls } = fixture();
  await assert.rejects(service.token(config(), { discord_user_id: user }, { allowAuthorize: false }), /has not authorized/);
  assert.equal(calls.authorize.length, 0);
  for (const id of ["order-one", "order-two"]) await service.token(config(id), { discord_user_id: user });
  const other = tokens.get(`order-two:${user}`);
  const saved = JSON.parse(decrypt(tokens.get(`order-one:${user}`)));
  saved.expiresAt = new Date(0).toISOString();
  tokens.set(`order-one:${user}`, encrypt(JSON.stringify(saved)));
  assert.equal(await service.token(config(), { discord_user_id: user }, { allowAuthorize: false }), "order-one-refreshed-access");
  assert.deepEqual(calls.refresh, [["order-one", "order-one-refresh"]]);
  assert.equal(tokens.get(`order-two:${user}`), other);
  assert.equal(calls.authorize.length, 2);
});

test("Discord rate limits retain their status and cannot persist an unverified grant", async () => {
  const { service, tokens } = fixture({ identityStatus: 429 });
  await assert.rejects(service.token(config(), { discord_user_id: user }), error => error.statusCode === 429);
  assert.equal(tokens.size, 0);
});

test("saved grants from another application are rejected before reuse or refresh", async () => {
  const { service, tokens, calls } = fixture();
  tokens.set(`order-one:${user}`, encrypt(JSON.stringify({ clientId: "different-app", accessToken: "wrong-token", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() })));
  await assert.rejects(service.token(config(), { discord_user_id: user }), /another application/);
  assert.equal(calls.authorize.length, 0);
  assert.equal(calls.refresh.length, 0);
});
