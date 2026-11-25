import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { BOT_POOL_STORAGE_SQL } from "./community-bot-pool.mjs";
import { BOT_AUTHORIZATION_STORAGE_SQL, createBotAuthorizations } from "./community-bot-authorizations.mjs";
import { BOT_SYNC_STORAGE_SQL, createBotSync, registerBotSync } from "./community-bot-sync.mjs";

const runtime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
const options = { skip: !fs.existsSync(runtime) };
const shared = "111111111111111111", bot = "222222222222222222", other = "333333333333333333", guild = "444444444444444444";
const ids = Array.from({ length: 32 }, (_, index) => String(555555555555555550n + BigInt(index)));
const encrypt = value => Buffer.from(value).toString("base64"), decrypt = value => Buffer.from(value, "base64").toString();
const expiry = days => new Date(Date.now() + days * 86_400_000).toISOString();

async function fixture(run) {
  const { PGlite } = await import(runtime.href);
  const db = new PGlite();
  await db.exec(`CREATE TABLE community_stock_categories (guild_id TEXT,id TEXT,name TEXT);
    CREATE TABLE community_oauth_joins (guild_id TEXT,stock_type TEXT,discord_user_id TEXT,sort_position INT,
      encrypted_account_token TEXT,encrypted_access_token TEXT,encrypted_refresh_token TEXT,access_token_expires_at TIMESTAMPTZ,
      status TEXT DEFAULT 'authorized', details TEXT, authorized_at TIMESTAMPTZ);`);
  await db.exec(BOT_POOL_STORAGE_SQL); await db.exec(BOT_AUTHORIZATION_STORAGE_SQL); await db.exec(BOT_SYNC_STORAGE_SQL);
  for (const id of ["online", "offline", "new", "empty"]) await db.query("INSERT INTO community_stock_categories VALUES ($1,$2,$2)", [guild, id]);
  for (const id of [bot, other]) await db.query("INSERT INTO community_bot_pool(client_id,name,encrypted_value) VALUES ($1,'Bot',$2)", [id, encrypt(JSON.stringify({ clientId: id }))]);
  const query = async (sql, args) => { const result = await db.query(sql, args); return { ...result, rowCount: result.rows.length || result.affectedRows || 0 }; };
  const pool = { query };
  let config = { configured: true, clientId: shared, guildId: guild }, behavior = async () => {};
  const calls = [];
  const getConfig = async () => config;
  const loadBot = async clientId => {
    if (![bot, other].includes(clientId)) throw Error("Unknown bot");
    return { clientId, clientSecret: "secret", botToken: "bot-token" };
  };
  const legacy = createBotAuthorizations({ pool, getConfig, loadBot, decrypt, encrypt });
  const controller = () => createBotSync({ pool, getConfig, loadBot, decrypt, legacy, synchronize: async (settings, member) => {
    calls.push({ clientId: settings.clientId, poolBotId: settings.poolBotId, userId: member.discord_user_id, redirectUri: settings.redirectUri });
    await behavior(settings, member);
  } });
  const add = (index, category = "online", { raw = true, access = null, refresh = null, expiresAt = null, stockGuild = guild } = {}) => db.query(
    "INSERT INTO community_oauth_joins(guild_id,stock_type,discord_user_id,sort_position,encrypted_account_token,encrypted_access_token,encrypted_refresh_token,access_token_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [stockGuild, category, ids[index], index, raw ? "encrypted-account-secret" : null, access, refresh, expiresAt]);
  const grant = (clientId, index, { app = clientId, access = "access-secret", refresh = "refresh-secret", expiresAt = expiry(7) } = {}) => db.query(
    "INSERT INTO community_bot_pool_credentials VALUES ($1,$2,$3)", [clientId, ids[index], encrypt(JSON.stringify({ clientId: app, accessToken: access, refreshToken: refresh, expiresAt }))]);
  try { await run({ db, api: controller(), controller, calls, add, grant, legacy, setBehavior: value => { behavior = value; }, setConfig: value => { config = value; } }); }
  finally { await db.close(); }
}

test("pool sync covers all categories, skips healthy grants and never borrows another application's permission", options, () => fixture(async ({ api, add, grant, calls, db }) => {
  await add(0); await add(1, "offline"); await add(2); await add(3, "offline", { raw: false });
  await add(4, "online", { raw: false }); await add(5, "online", { stockGuild: other });
  await grant(bot, 0); await grant(other, 1); await grant(bot, 2, { expiresAt: expiry(1) });
  await grant(bot, 3, { expiresAt: expiry(-1) });
  const before = (await db.query("SELECT * FROM community_bot_pool_credentials ORDER BY client_id,discord_user_id")).rows;
  assert.deepEqual(await api.preview(bot), { totalAccounts: 5, pending: 3, upToDate: 1, unavailable: 1 });
  const job = await api.start(bot, {}, "https://example.com/callback");
  assert.equal(job.total, 3);
  for (const field of ["memberIds", "failedIds", "guildId", "redirectUri", "isDefault"]) assert.ok(!(field in job));
  assert.ok(!JSON.stringify(job).includes("secret"));
  await api.tick(); await api.tick(); await api.tick();
  assert.deepEqual(calls.map(call => call.userId), [ids[1], ids[2], ids[3]]);
  assert.ok(calls.every(call => call.poolBotId === bot && call.redirectUri === "https://example.com/callback"));
  assert.equal((await api.latest(bot)).status, "completed");
  assert.deepEqual((await db.query("SELECT * FROM community_bot_pool_credentials ORDER BY client_id,discord_user_id")).rows, before);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM community_oauth_joins")).rows[0].n, 6);
}));

test("default bot uses the same durable sync and considers only its shared grants", options, () => fixture(async ({ api, add, grant, calls, controller }) => {
  await add(0, "online", { access: "encrypted-shared-access", expiresAt: expiry(7) });
  await add(1, "offline"); await add(2, "offline", { raw: false, refresh: "encrypted-shared-refresh", expiresAt: expiry(-1) });
  await add(3, "online", { raw: false }); await grant(bot, 1);
  assert.deepEqual(await api.preview(shared), { totalAccounts: 4, pending: 2, upToDate: 1, unavailable: 1 });
  await api.start(shared); await api.tick(); await controller().tick();
  assert.ok(calls.every(call => call.clientId === shared && call.poolBotId === undefined));
  assert.deepEqual(calls.map(call => call.userId), [ids[1], ids[2]]);
  assert.equal((await api.latest(shared)).succeeded, 2);
}));

test("429 pauses without consuming an account; a resumed job continues and counts independent failures", options, () => fixture(async ({ api, add, setBehavior }) => {
  await add(0); await add(1);
  await api.start(bot);
  setBehavior(async () => { throw Object.assign(Error("Rate limited"), { statusCode: 429 }); });
  await api.tick();
  assert.equal((await api.latest(bot)).status, "paused"); assert.equal((await api.latest(bot)).processed, 0);
  await api.resume(bot);
  setBehavior(async () => { throw Error("Account unavailable"); }); await api.tick();
  setBehavior(async () => {}); await api.tick();
  const job = await api.latest(bot);
  assert.equal(job.status, "completed"); assert.equal(job.failed, 1); assert.equal(job.succeeded, 1);
}));

test("retry failed preserves every failed ID beyond the 25 public details and excludes successful accounts", options, () => fixture(async ({ api, add, setBehavior, calls }) => {
  for (let index = 0; index < 28; index++) await add(index);
  await api.start(bot);
  setBehavior(async (_, member) => { if (member.discord_user_id !== ids[27]) throw Error("Rejected"); });
  for (let index = 0; index < 28; index++) await api.tick();
  const done = await api.latest(bot);
  assert.equal(done.failed, 27); assert.equal(done.errors.length, 25);
  setBehavior(async () => {});
  const retry = await api.start(bot, { retryFailed: true }); assert.equal(retry.total, 27);
  for (let index = 0; index < 27; index++) await api.tick();
  assert.equal((await api.latest(bot)).succeeded, 27);
  assert.ok(!calls.slice(28).some(call => call.userId === ids[27]));
}));

test("cancel keeps in-flight results and does not start more accounts or overlap a replacement job", options, () => fixture(async ({ api, controller, add, setBehavior, calls }) => {
  await add(0); await add(1); await api.start(bot);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  setBehavior(async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  const work = api.tick(); await started;
  await controller().tick(); assert.equal(calls.length, 1);
  await api.cancel(bot);
  await assert.rejects(api.start(bot), error => error.statusCode === 409);
  release(); await work; await api.tick();
  assert.equal(calls.length, 1);
  const job = await api.latest(bot); assert.equal(job.status, "cancelled"); assert.equal(job.processed, 1); assert.equal(job.succeeded, 1);
  assert.equal((await api.start(bot)).status, "queued");
}));

test("only one active sync per application; other bots remain independently usable", options, () => fixture(async ({ api, controller, add }) => {
  await add(0); await api.start(bot);
  await assert.rejects(controller().start(bot), error => error.statusCode === 409);
  assert.equal((await api.start(other)).status, "queued");
}));

test("expired worker leases recover after restart and a stale worker cannot overwrite new progress", options, () => fixture(async ({ api, controller, add, db, setBehavior }) => {
  await add(0); await api.start(bot);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  setBehavior(async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  const work = api.tick(); await started;
  await db.exec("UPDATE community_bot_sync_jobs SET lease_until=NOW()-INTERVAL '1 minute'");
  setBehavior(async () => { throw Error("New worker result"); }); await controller().tick();
  release(); await work;
  const job = await api.latest(bot);
  assert.equal(job.failed, 1); assert.equal(job.succeeded, 0); assert.equal(job.processed, 1);
}));

test("configuration changes and transient failures pause without consuming the remaining stock", options, () => fixture(async ({ api, add, setConfig, setBehavior }) => {
  await add(0); await api.start(bot);
  setConfig({ configured: true, clientId: shared, guildId: other }); await api.tick();
  assert.equal((await api.latest(bot)).status, "paused"); assert.equal((await api.latest(bot)).processed, 0);
  setConfig({ configured: true, clientId: shared, guildId: guild }); await api.resume(bot);
  setBehavior(async () => { throw Object.assign(Error("Temporary refresh failure"), { oauthRefreshTransient: true }); }); await api.tick();
  assert.equal((await api.latest(bot)).status, "paused"); assert.equal((await api.latest(bot)).failed, 0);
}));

test("existing paused category jobs remain visible and controllable from the sync API", options, () => fixture(async ({ api, add, db }) => {
  await add(0);
  const payload = { guildId: guild, memberIds: [ids[0]], total: 1, processed: 0, succeeded: 0, failed: 0, errors: [] };
  await db.query("INSERT INTO community_bot_authorization_jobs(id,client_id,payload,status) VALUES ('earlier',$1,$2::jsonb,'paused')", [bot, JSON.stringify(payload)]);
  assert.equal((await api.latest(bot)).legacy, true);
  await assert.rejects(api.start(bot), /earlier authorization/);
  assert.equal((await api.resume(bot)).status, "queued");
  assert.equal((await api.cancel(bot)).status, "cancelled");
  assert.equal(await api.latest(bot), null);
  assert.equal((await api.start(bot)).status, "queued");
}));

test("invalid input saves no job, and healthy-only stock completes without OAuth requests", options, () => fixture(async ({ api, add, grant, calls, db }) => {
  for (const action of [() => api.start("invalid"), () => api.start(bot, null), () => api.start(bot, { retryFailed: "yes" }), () => api.start(bot, { retryFailed: true })]) await assert.rejects(action);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM community_bot_sync_jobs")).rows[0].n, 0);
  await add(0); await grant(bot, 0);
  assert.equal((await api.start(bot)).status, "completed");
  await api.tick(); assert.equal(calls.length, 0);
}));

test("all sync routes require an authenticated session", () => {
  const routes = [], auth = () => {};
  registerBotSync({ get: (...args) => routes.push(args), post: (...args) => routes.push(args) }, auth, {});
  assert.equal(routes.length, 7); assert.ok(routes.every(route => route[1] === auth));
});

test("category selection scopes both preview counts and persisted worker progress without moving or duplicating stock", options, () => fixture(async ({ api, add, grant, db, controller, calls }) => {
  await add(0, "new"); await add(1, "online"); await add(2, "new"); await add(3, "new", { raw: false }); await grant(bot, 2);
  const before = (await db.query("SELECT * FROM community_oauth_joins ORDER BY discord_user_id")).rows;
  assert.deepEqual(await api.preview(bot, "new"), { categoryId: "new", categoryName: "new", totalAccounts: 3, pending: 1, upToDate: 1, unavailable: 1 });
  const job = await api.start(bot, { categoryId: "new" }); assert.equal(job.total, 1); assert.equal(job.categoryId, "new");
  await controller().tick(); assert.deepEqual(calls.map(call => call.userId), [ids[0]]);
  const latest = await api.latest(bot); assert.equal(latest.status, "completed"); assert.equal(latest.categoryName, "new");
  const notification = (await api.notifications())[0]; assert.equal(notification.categoryId, "new"); assert.equal(notification.categoryName, "new");
  assert.deepEqual((await db.query("SELECT * FROM community_oauth_joins ORDER BY discord_user_id")).rows, before);
}));

test("all categories stays available and category lists are limited to this bot's shared stock guild", options, () => fixture(async ({ api, db, add }) => {
  await db.query("INSERT INTO community_stock_categories VALUES ($1,'private','Private category')", [other]);
  assert.deepEqual((await api.categories(bot)).map(category => category.id), ["empty", "new", "offline", "online"]);
  await add(0, "new"); await add(1, "online");
  assert.equal((await api.preview(bot, "")).totalAccounts, 2);
  assert.equal((await api.start(bot, { categoryId: "" })).total, 2);
}));

test("invalid, deleted or other-guild categories cannot preview or create a job; empty categories are a safe no-op", options, () => fixture(async ({ api, db, add, calls }) => {
  await add(0);
  await db.query("INSERT INTO community_stock_categories VALUES ($1,'private','Private category')", [other]);
  for (const categoryId of ["missing", "private", 7, ["online"], {}, "x".repeat(101)]) {
    await assert.rejects(api.preview(bot, categoryId), error => error.statusCode === 400);
    await assert.rejects(api.start(bot, { categoryId }), error => error.statusCode === 400);
  }
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM community_bot_sync_jobs")).rows[0].n, 0);
  const job = await api.start(bot, { categoryId: "empty" }); assert.equal(job.status, "completed"); assert.equal(job.total, 0);
  await api.tick(); assert.equal(calls.length, 0);
}));

test("paused category jobs resume in their original scope and retries cannot switch to another category", options, () => fixture(async ({ api, add, setBehavior, calls }) => {
  await add(0, "new"); await add(1, "online");
  await api.start(bot, { categoryId: "new" });
  setBehavior(async () => { throw Object.assign(Error("Limited"), { statusCode: 429 }); }); await api.tick();
  const paused = await api.latest(bot); assert.equal(paused.status, "paused"); assert.equal(paused.categoryId, "new");
  await assert.rejects(api.start(bot, { categoryId: "online" }), error => error.statusCode === 409);
  await api.resume(bot); setBehavior(async () => { throw Error("Failed account"); }); await api.tick();
  await assert.rejects(api.start(bot, { retryFailed: true, categoryId: "online" }), error => error.statusCode === 400);
  const retried = await api.start(bot, { retryFailed: true }); assert.equal(retried.categoryId, "new"); assert.equal(retried.total, 1);
  setBehavior(async () => {}); await api.tick();
  assert.ok(calls.every(call => call.userId === ids[0]));
}));

test("accounts moved out of the selected category before processing are skipped without authorization", options, () => fixture(async ({ api, add, db, calls }) => {
  await add(0, "new"); await add(1, "new"); await api.start(bot, { categoryId: "new" });
  await db.query("UPDATE community_oauth_joins SET stock_type='online' WHERE discord_user_id=$1", [ids[0]]);
  await api.tick(); await api.tick();
  assert.deepEqual(calls.map(call => call.userId), [ids[1]]);
  const done = await api.latest(bot); assert.equal(done.failed, 1); assert.equal(done.succeeded, 1);
  await assert.rejects(api.start(bot, { retryFailed: true, categoryId: "online" }), error => error.statusCode === 400);
  const retry = await api.start(bot, { retryFailed: true }); assert.equal(retry.total, 0); assert.equal(retry.status, "completed");
}));

test("notification feed restores server progress across controllers, includes paused/legacy work and exposes no credential or member lists", options, () => fixture(async ({ api, controller, add, db }) => {
  await add(0); await add(1, "offline");
  const started = await api.start(bot); await api.tick();
  const defaultJob = await api.start(shared);
  await db.query("UPDATE community_bot_sync_jobs SET status='paused',updated_at=NOW()-INTERVAL '2 days' WHERE id=$1", [defaultJob.id]);
  await db.query("INSERT INTO community_bot_authorization_jobs(id,client_id,status,payload) VALUES ('legacy',$1,'running',$2::jsonb)", [other, JSON.stringify({ memberIds: ids, guildId: guild, redirectUri: "private", total: 32, processed: 4, succeeded: 3, failed: 1, errors: [{ userId: ids[0], message: "private" }] })]);
  const notifications = await controller().notifications();
  assert.equal(notifications.length, 3);
  const resumed = notifications.find(job => job.id === started.id);
  assert.equal(resumed.processed, 1); assert.equal(resumed.total, 2); assert.equal(resumed.botName, "Bot");
  assert.equal(notifications.find(job => job.id === defaultJob.id).status, "paused");
  assert.equal(notifications.find(job => job.id === defaultJob.id).botName, "Default bot");
  assert.equal(notifications.find(job => job.id === "legacy").legacy, true);
  for (const job of notifications) {
    assert.ok(!("memberIds" in job)); assert.ok(!("failedIds" in job)); assert.ok(!("guildId" in job)); assert.ok(!("redirectUri" in job)); assert.deepEqual(job.errors, []);
  }
  assert.ok(!JSON.stringify(notifications).includes("secret")); assert.ok(!JSON.stringify(notifications).includes("private"));
}));

test("notification feed reports a completion missed while the browser was closed, expires old results and returns only the latest job per bot", options, () => fixture(async ({ api, controller, add, db }) => {
  await add(0);
  const initial = await api.start(bot); await api.tick();
  assert.equal((await controller().notifications())[0].status, "completed");
  const next = await api.start(bot);
  const current = await api.notifications(); assert.equal(current.length, 1); assert.equal(current[0].id, next.id); assert.notEqual(current[0].id, initial.id);
  await api.cancel(bot);
  assert.equal((await api.notifications())[0].status, "cancelled");
  await db.exec("UPDATE community_bot_sync_jobs SET updated_at=NOW()-INTERVAL '10 minutes'");
  assert.deepEqual(await api.notifications(), []);
}));

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const synchronizeCode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "synchronizeStockMemberForBot").getText(ast);
function stockSynchronizer(overrides = {}) {
  const calls = [];
  const context = vm.createContext({
    orderBotService: { token: async (...args) => { calls.push(["pool", ...args]); return "pool-access"; } },
    refreshStoredCommunityOAuthCredential: async (...args) => { calls.push(["refresh", ...args]); return "shared-refreshed"; },
    authorizeStockMemberForBot: async (...args) => { calls.push(["authorize", ...args]); return { accessToken: "new-access", refreshToken: "new-refresh", expiresAt: expiry(7) }; },
    encryptCredential: encrypt,
    pool: { query: async (...args) => { calls.push(["save", ...args]); } },
    ...overrides
  });
  return { synchronize: vm.runInContext(`(${synchronizeCode})`, context), calls };
}

test("stock sync reuses the existing per-application pool service and default credential refresh", async () => {
  const { synchronize, calls } = stockSynchronizer();
  const member = { discord_user_id: ids[0], encrypted_account_token: "saved" };
  assert.equal(await synchronize({ clientId: bot }, member), "pool-access");
  assert.equal(await synchronize({ isDefault: true, clientId: shared }, member), "shared-refreshed");
  assert.deepEqual(calls.map(call => call[0]), ["pool", "refresh"]);
  assert.equal(calls[0][1].gatewayBeforeAuth, false);
  assert.equal(calls[1][3], undefined);
});

test("invalid default refresh falls back to fresh authorization and saves only encrypted credentials for that stock account", async () => {
  const { synchronize, calls } = stockSynchronizer({ refreshStoredCommunityOAuthCredential: async () => { throw Object.assign(Error("Expired refresh"), { oauthRefreshInvalid: true }); } });
  await synchronize({ isDefault: true, clientId: shared, guildId: guild }, { discord_user_id: ids[0], encrypted_account_token: "saved" });
  assert.deepEqual(calls.map(call => call[0]), ["authorize", "save"]);
  assert.equal(calls[0][1].gatewayBeforeAuth, false);
  assert.match(calls[1][1], /WHERE guild_id=\$1 AND discord_user_id=\$2/);
  const args = calls[1][2];
  assert.equal(args[0], guild); assert.equal(args[1], ids[0]);
  assert.equal(decrypt(args[2]), "new-access"); assert.equal(decrypt(args[3]), "new-refresh");
  assert.ok(!args.includes("new-access")); assert.ok(!args.includes("new-refresh"));
});

test("limited/transient default refresh never creates fresh authorizations; missing raw material never overwrites stock", async () => {
  for (const flags of [{ statusCode: 429 }, { oauthRefreshTransient: true }, { oauthRefreshInvalid: true }]) {
    const error = Object.assign(Error("Refresh unavailable"), flags);
    const { synchronize, calls } = stockSynchronizer({ refreshStoredCommunityOAuthCredential: async () => { throw error; } });
    const raw = flags.oauthRefreshInvalid ? null : "saved";
    await assert.rejects(synchronize({ isDefault: true }, { discord_user_id: ids[0], encrypted_account_token: raw }), reason => reason === error);
    assert.equal(calls.length, 0);
  }
});

test("fresh default authorization repairs OAuth failures only and preserves delivery failures and other stock guilds", options, () => fixture(async ({ db, add }) => {
  await add(0); await add(1); await add(0, "online", { stockGuild: other, access: "other-guild-grant" });
  await db.query("UPDATE community_oauth_joins SET status='failed',details='OAuth expired' WHERE guild_id=$1 AND discord_user_id=$2", [guild, ids[0]]);
  await db.query("UPDATE community_oauth_joins SET status='failed',details='Delivery failed' WHERE discord_user_id=$1", [ids[1]]);
  const { synchronize } = stockSynchronizer({
    refreshStoredCommunityOAuthCredential: async () => { throw Object.assign(Error("Missing refresh"), { oauthAccessInvalid: true }); },
    pool: { query: (sql, args) => db.query(sql, args) }
  });
  for (const userId of [ids[0], ids[1]]) await synchronize({ isDefault: true, clientId: shared, guildId: guild }, { discord_user_id: userId, encrypted_account_token: "saved" });
  const rows = (await db.query("SELECT * FROM community_oauth_joins ORDER BY guild_id,discord_user_id")).rows;
  const repaired = rows.find(row => row.guild_id === guild && row.discord_user_id === ids[0]);
  const failed = rows.find(row => row.discord_user_id === ids[1]);
  assert.equal(repaired.status, "authorized"); assert.equal(repaired.details, null);
  assert.equal(decrypt(repaired.encrypted_access_token), "new-access");
  assert.equal(failed.status, "failed"); assert.equal(failed.details, "Delivery failed");
  assert.equal(rows.find(row => row.guild_id === other).encrypted_access_token, "other-guild-grant");
  assert.equal(rows.length, 3);
}));

test("stop reports an in-flight result as Stopping across reload and prevents new jobs until settlement", options, () => fixture(async ({ api, controller, add, setBehavior, db }) => {
  await add(0); await add(1); await api.start(bot);
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  setBehavior(async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  const work = api.tick(); await started;
  const stopping = await controller().cancel(bot);
  assert.equal(stopping.stopping, true);
  assert.equal((await controller().latest(bot)).stopping, true);
  assert.equal((await controller().notifications())[0].stopping, true);
  await assert.rejects(api.start(bot), error => error.statusCode === 409);
  release(); await work;
  const final = await controller().latest(bot);
  assert.equal(final.stopping, false); assert.equal(final.status, "cancelled"); assert.equal(final.processed, 1); assert.equal(final.succeeded, 1);
  const row = (await db.query("SELECT * FROM community_bot_sync_jobs WHERE id=$1", [final.id])).rows[0];
  assert.equal(row.worker_token, null);
}));

test("ETA is persisted for active work, hidden on pause and excludes paused time on resume", options, () => fixture(async ({ api, controller, add, db }) => {
  for (let index = 0; index < 8; index++) await add(index);
  const job = await api.start(bot);
  await db.query(`UPDATE community_bot_sync_jobs SET payload=payload || $2::jsonb WHERE id=$1`, [job.id, JSON.stringify({ processed: 3, succeeded: 3, timingSamplesMs: [5000, 6000, 7000], lastProgressAt: new Date().toISOString() })]);
  const restored = await controller().latest(bot);
  assert.ok(restored.estimatedRemainingSeconds >= 29 && restored.estimatedRemainingSeconds <= 30);
  assert.equal("timingSamplesMs" in restored, false);
  const notification = (await controller().notifications())[0];
  assert.ok(notification.estimatedRemainingSeconds >= 29 && notification.estimatedRemainingSeconds <= 30);
  assert.equal("timingSamplesMs" in notification, false);
  await db.query("UPDATE community_bot_sync_jobs SET status='paused',payload=payload || $2::jsonb WHERE id=$1", [job.id, JSON.stringify({ lastProgressAt: "2020-01-01T00:00:00Z" })]);
  assert.equal((await api.latest(bot)).estimatedRemainingSeconds, null);
  await api.resume(bot);
  const saved = (await db.query("SELECT payload FROM community_bot_sync_jobs WHERE id=$1", [job.id])).rows[0].payload;
  assert.ok(Date.parse(saved.lastProgressAt) > Date.now() - 5000);
  assert.ok((await api.latest(bot)).estimatedRemainingSeconds >= 29);
}));
