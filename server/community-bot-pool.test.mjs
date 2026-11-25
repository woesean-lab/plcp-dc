import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BOT_POOL_STORAGE_SQL, createCommunityBotPool, loadBotDeliveryMetrics, registerCommunityBotPool } from "./community-bot-pool.mjs";
import { createOrderBotService } from "./community-order-bot.mjs";

const pgRuntime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
const options = { skip: !fs.existsSync(pgRuntime) };
const sharedId = "111111111111111111";
const a = "222222222222222222", b = "333333333333333333", guild = "444444444444444444", user = "555555555555555555";
const encrypt = value => Buffer.from(value).toString("base64");
const decrypt = value => Buffer.from(value, "base64").toString();

test("existing pool bots load cached Discord avatars without changing credentials or exposing them", async () => {
  let calls = 0;
  let credential = encrypt(JSON.stringify({ clientId: a, botToken: "token-one", clientSecret: "private-secret" }));
  const queries = [];
  const service = createCommunityBotPool({ encrypt, decrypt,
    pool: { query: async sql => {
      queries.push(sql);
      return { rows: sql.includes("FROM community_bot_pool_credentials") ? [] : [
        { client_id: a, name: "Custom label", enabled: true, encrypted_value: credential, active_orders: 2, pending_members: 90 }
      ] };
    } },
    getBotIdentity: async config => {
      calls++;
      assert.equal(config.clientId, a);
      if (config.botToken === "token-two") throw new Error("Discord unavailable");
      return { name: "Discord name", avatarUrl: "https://cdn.discordapp.com/avatars/example.png", botToken: config.botToken };
    }
  });
  const [first, concurrent] = await Promise.all([service.list(), service.list()]);
  assert.equal(calls, 1, "concurrent reads share the identity request");
  assert.equal(first[0].name, "Custom label");
  assert.equal(first[0].avatarUrl, "https://cdn.discordapp.com/avatars/example.png");
  assert.equal(first[0].activeOrders, 2);
  assert.deepEqual(first, concurrent);
  assert.equal(first[0].authorizedAccounts, 0);
  assert.ok(!JSON.stringify(first).includes("private-secret"));
  assert.ok(!JSON.stringify(first).includes("token-one"));
  await service.list();
  assert.equal(calls, 1);
  credential = encrypt(JSON.stringify({ clientId: a, botToken: "token-two", clientSecret: "private-secret" }));
  const unavailable = await service.list();
  assert.equal(calls, 2, "changed credentials invalidate the cached identity");
  assert.equal(unavailable[0].avatarUrl, null);
  assert.equal(unavailable[0].name, "Custom label");
  assert.equal(unavailable[0].enabled, true);
  await service.list();
  assert.equal(calls, 2, "failed identity reads are cached to avoid repeated requests");
  assert.ok(queries.every(sql => sql.trim().startsWith("SELECT")), "viewing profiles never rewrites settings or credentials");
});

test("unreadable pool credentials still produce a usable row without a Discord request", async () => {
  let called = false;
  const service = createCommunityBotPool({ encrypt, decrypt,
    pool: { query: async sql => ({ rows: sql.includes("FROM community_bot_pool_credentials") ? [] : [
      { client_id: a, name: "Existing bot", enabled: false, encrypted_value: "unreadable" }
    ] }) },
    getBotIdentity: async () => { called = true; return {}; }
  });
  const bots = await service.list();
  assert.equal(bots[0].name, "Existing bot");
  assert.equal(bots[0].avatarUrl, null);
  assert.equal(bots[0].enabled, false);
  assert.equal(called, false);
});

async function fixture(run) {
  const { PGlite } = await import(pgRuntime.href);
  const db = new PGlite();
  await db.exec("CREATE TABLE tracked_orders (uniqid TEXT PRIMARY KEY, payload JSONB NOT NULL); CREATE TABLE app_settings (setting_key TEXT PRIMARY KEY, encrypted_value TEXT, updated_at TIMESTAMPTZ);");
  await db.exec(BOT_POOL_STORAGE_SQL);
  const queries = [];
  const query = async (sql, args) => { queries.push(sql); const result = await db.query(sql, args); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const verify = async input => ({ clientId: input.botToken, botName: `Bot ${input.botToken}`, clientSecret: input.clientSecret, botToken: input.botToken });
  const service = createCommunityBotPool({ pool, encrypt, decrypt, verify, getSharedConfig: async () => ({ clientId: sharedId, guildId: guild }) });
  const add = id => service.save({ botToken: id, clientSecret: `secret-${id}`, name: id === a ? "Bot A" : "Bot B" });
  const write = order => db.query("INSERT INTO tracked_orders (uniqid,payload) VALUES ($1,$2::jsonb)", [order.uniqid, JSON.stringify({ provider: "community", serverId: guild, ...order })]);
  const acquire = (id, amount = 100) => service.acquire({ orderId: id, amount, base: { clientId: sharedId, guildId: guild }, redirectUri: "https://example.com/api/community/oauth/callback" });
  try { await run({ db, pool, service, add, write, acquire, queries }); } finally { await db.close(); }
}

test("pool credentials are encrypted, lists contain no secrets and duplicate apps are rejected", options, () => fixture(async ({ service, add, db }) => {
  const bots = await add(a);
  assert.equal(bots[0].clientId, a);
  assert.equal(bots[0].name, "Bot A");
  assert.equal(bots[0].hasBotToken, true);
  assert.ok(!JSON.stringify(bots).includes(`secret-${a}`));
  assert.ok(!("encrypted_value" in bots[0]) && !("botToken" in bots[0]));
  const stored = (await db.query("SELECT encrypted_value FROM community_bot_pool")).rows[0].encrypted_value;
  assert.ok(!stored.includes(`secret-${a}`));
  assert.equal(JSON.parse(decrypt(stored)).clientSecret, `secret-${a}`);
  await assert.rejects(add(a), error => error.statusCode === 409);
  await service.save({ name: "Renamed" }, a);
  assert.equal((await service.list())[0].name, "Renamed");
  assert.equal((await service.load(a)).clientSecret, `secret-${a}`);
  await assert.rejects(service.save({ botToken: b, clientSecret: "wrong-app" }, a), /same Discord application/);
}));

test("delivery metrics isolate each bot, include partial/completed deliveries and preserve legacy default history", options, () => fixture(async ({ service, add, write, pool }) => {
  await add(a); await add(b);
  await write({ uniqid: "a-finished", botApplicationId: a, status: "COMPLETED", amount: 500, added: 500 });
  await write({ uniqid: "a-running", botApplicationId: a, status: "PROCESS", amount: 100, added: 35 });
  await write({ uniqid: "a-stopped", botApplicationId: a, status: "STOPPED", amount: 50, added: 10 });
  await write({ uniqid: "b-finished", botApplicationId: b, status: "COMPLETED", amount: 200, added: 200 });
  await write({ uniqid: "shared-finished", botApplicationId: sharedId, status: "COMPLETED", amount: 30, added: 30 });
  await write({ uniqid: "shared-old", status: "COMPLETED", amount: 20, added: 20 });
  await write({ uniqid: "legacy-custom", customBot: true, status: "COMPLETED", amount: 800, added: 800 });
  await write({ uniqid: "direct", botApplicationId: sharedId, joinMethod: "directly", status: "COMPLETED", amount: 900, added: 900 });
  const bots = await service.list();
  const first = bots.find(bot => bot.clientId === a);
  assert.equal(first.deliveredMembers, 545);
  assert.equal(first.totalOrders, 3);
  assert.equal(first.activeOrders, 1);
  assert.equal(first.pendingMembers, 65);
  assert.equal(bots.find(bot => bot.clientId === b).deliveredMembers, 200);
  assert.deepEqual(await loadBotDeliveryMetrics(pool, a), { deliveredMembers: 545, totalOrders: 3, activeOrders: 1, pendingMembers: 65 });
  assert.deepEqual(await loadBotDeliveryMetrics(pool, sharedId, { includeLegacy: true }), { deliveredMembers: 50, totalOrders: 2, activeOrders: 0, pendingMembers: 0 });
}));

test("selection uses remaining members before order count, ignores completed work and keeps sticky bindings", options, () => fixture(async ({ service, add, write, acquire }) => {
  await add(a); await add(b);
  await write({ uniqid: "large", botApplicationId: a, status: "PROCESS", amount: 1000, added: 100 });
  await write({ uniqid: "small-one", botApplicationId: b, status: "PROCESS", amount: 50, added: 25 });
  await write({ uniqid: "small-two", botApplicationId: b, status: "WAITING", amount: 50, added: 25 });
  await write({ uniqid: "done", botApplicationId: b, status: "COMPLETED", amount: 5000, added: 5000 });
  const choice = await acquire("new");
  assert.equal(choice.poolBotId, b);
  assert.equal(choice.orderBotId, "new");
  assert.equal(choice.guildId, guild);
  const bots = await service.list();
  assert.equal(bots.find(bot => bot.clientId === b).activeOrders, 2);
  assert.equal(bots.find(bot => bot.clientId === b).pendingMembers, 50);
  await service.setEnabled(b, false);
  assert.equal((await service.load(b)).clientId, b, "disabling affects only future assignments");
  assert.equal((await acquire("later")).poolBotId, a);
}));

test("in-flight reservations distribute orders and failed/expired reservations release capacity", options, () => fixture(async ({ service, add, acquire, db, queries }) => {
  await add(a); await add(b);
  const first = await acquire("one", 500);
  const second = await acquire("two", 500);
  assert.notEqual(first.poolBotId, second.poolBotId);
  assert.ok(queries.some(sql => sql.includes("pg_advisory_xact_lock")));
  await service.release("one");
  assert.equal((await acquire("three", 5)).poolBotId, first.poolBotId);
  await db.query("UPDATE community_bot_pool_reservations SET expires_at = NOW() - INTERVAL '1 second'");
  await acquire("four");
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM community_bot_pool_reservations")).rows[0].n, 1);
}));

test("disabled/empty pools never fall back to the shared bot", options, () => fixture(async ({ service, add, acquire, db }) => {
  await assert.rejects(acquire("empty"), error => error.statusCode === 409);
  await add(a); await service.setEnabled(a, false);
  await assert.rejects(acquire("disabled"), error => error.statusCode === 409);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM community_bot_pool_reservations")).rows[0].n, 0);
  await assert.rejects(service.setEnabled(a, "yes"), /enabled/);
}));

test("a pool application reuses its own grant across orders and keeps different applications separate", options, () => fixture(async ({ pool, add, db }) => {
  await add(a); await add(b);
  const authorizations = [];
  const oauth = config => ({ accessToken: `grant-${config.clientId}`, refreshToken: "refresh", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
  const service = createOrderBotService({ pool, encrypt, decrypt,
    request: async (_path, init) => ({ response: { ok: true }, payload: { user: { id: user }, application: { id: init.headers.Authorization.slice("Bearer grant-".length) }, scopes: ["guilds.join"] } }),
    authorize: async config => { authorizations.push(config.poolBotId); return oauth(config); }, refresh: async config => oauth(config)
  });
  const config = (id, orderBotId) => ({ clientId: id, poolBotId: id, orderBotId });
  assert.equal(await service.token(config(a, "one"), { discord_user_id: user }), `grant-${a}`);
  assert.equal(await service.token(config(a, "two"), { discord_user_id: user }), `grant-${a}`);
  assert.equal(await service.token(config(b, "three"), { discord_user_id: user }), `grant-${b}`);
  assert.deepEqual(authorizations, [a,b]);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM community_bot_pool_credentials")).rows[0].n, 2);
}));

test("every bot pool API route requires the admin session", () => {
  const routes = [], auth = () => {};
  const app = Object.fromEntries(["get", "post", "put", "patch"].map(method => [method, (...args) => routes.push(args)]));
  registerCommunityBotPool(app, auth, {});
  assert.equal(routes.length, 4);
  assert.ok(routes.every(route => route[1] === auth));
});

test("automatic assignment can use imported OAuth-only stock but never another application's grants", options, () => fixture(async ({ service,db,add,write }) => {
  await db.exec("CREATE TABLE community_oauth_joins (discord_user_id TEXT,guild_id TEXT,stock_type TEXT,status TEXT,encrypted_account_token TEXT)");
  await add(a); await add(b);
  await write({ uniqid:"busy",botApplicationId:b,status:"PROCESS",amount:100,added:0 });
  await db.query("INSERT INTO community_oauth_joins VALUES ($1,$2,'offline','authorized',NULL)",[user,guild]);
  await db.query("INSERT INTO community_bot_pool_credentials VALUES ($1,$2,$3)",[b,user,encrypt(JSON.stringify({clientId:b,accessToken:"imported",expiresAt:new Date(Date.now()+86400000).toISOString()}))]);
  const args = { orderId:"oauth-order",amount:1,base:{clientId:sharedId,guildId:guild},redirectUri:"https://example.com/callback",stockAllocations:[{categoryId:"offline",amount:1}] };
  assert.deepEqual(await service.grantUserIds(a),[]);
  assert.deepEqual(await service.grantUserIds(b),[user]);
  assert.equal((await service.acquire(args)).poolBotId,b,"eligibility takes priority over a lower-load bot without authorization");
  await assert.rejects(service.acquire({...args,orderId:"experimental",accountTokenOnly:true}),error=>error.statusCode===409);
  await assert.rejects(service.acquire({...args,orderId:"delivered",excludedUserIds:[user]}),error=>error.statusCode===409);
}));

test("separate workers cannot authorize the same pool grant concurrently and expired locks recover", options, () => fixture(async ({ pool, service, add, db }) => {
  await add(a);
  await db.query("INSERT INTO community_bot_pool_credential_leases VALUES ($1,$2,'dead-worker',NOW() - INTERVAL '1 second')", [a,user]);
  let calls = 0;
  const createWorker = () => createOrderBotService({ pool, encrypt, decrypt, withPoolGrantLock: service.withGrantLock,
    request: async () => ({ response: { ok: true }, payload: { user: { id: user }, application: { id: a }, scopes: ["guilds.join"] } }),
    authorize: async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 30));
      return { accessToken: "shared-pool-grant", refreshToken: "shared-pool-refresh", expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() };
    }, refresh: async () => { throw Error("Fresh grant should not refresh"); }
  });
  const first = createWorker(), second = createWorker();
  const config = { poolBotId: a, clientId: a };
  const values = await Promise.all([
    first.token({ ...config, orderBotId: "one" }, { discord_user_id: user }),
    second.token({ ...config, orderBotId: "two" }, { discord_user_id: user })
  ]);
  assert.deepEqual(values, ["shared-pool-grant", "shared-pool-grant"]);
  assert.equal(calls, 1);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM community_bot_pool_credential_leases")).rows[0].n, 0);
}));

test("existing pooled orders load updated credentials without changing application or using shared settings", options, () => fixture(async ({ pool, service, add }) => {
  await add(a);
  const orderBots = createOrderBotService({ pool, encrypt, decrypt, loadPoolConfig: service.load });
  await pool.query("INSERT INTO app_settings (setting_key,encrypted_value) VALUES ($1,$2)", ["community_order_bot:existing", encrypt(JSON.stringify({ clientId: a, poolBotId: a, orderBotId: "existing", botToken: "old-token", stockGuildId: guild }))]);
  const base = { clientId: sharedId, botToken: "shared-token" };
  const order = { uniqid: "existing", customBot: true, botApplicationId: a, serverId: guild };
  await service.setEnabled(a, false);
  const config = await orderBots.load(order, base);
  assert.equal(config.botToken, a);
  assert.equal(config.poolBotId, a);
  assert.equal(config.orderBotId, "existing");
  assert.equal(base.botToken, "shared-token");
}));
