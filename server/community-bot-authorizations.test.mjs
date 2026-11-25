import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BOT_POOL_STORAGE_SQL, createCommunityBotPool } from "./community-bot-pool.mjs";
import { BOT_AUTHORIZATION_STORAGE_SQL, createBotAuthorizations, registerBotAuthorizations } from "./community-bot-authorizations.mjs";

const runtime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
const options = { skip: !fs.existsSync(runtime) };
const bot = "111111111111111111", other = "222222222222222222", guild = "333333333333333333";
const one = "444444444444444444", two = "555555555555555555", unknown = "666666666666666666";
const encrypt = value => Buffer.from(value).toString("base64"), decrypt = value => Buffer.from(value,"base64").toString();

async function fixture(run) {
  const { PGlite } = await import(runtime.href);
  const db = new PGlite();
  await db.exec(`CREATE TABLE tracked_orders (uniqid TEXT PRIMARY KEY,payload JSONB);
    CREATE TABLE community_stock_categories (guild_id TEXT,id TEXT);
    CREATE TABLE community_oauth_joins (guild_id TEXT,stock_type TEXT,discord_user_id TEXT,encrypted_account_token TEXT,sort_position INT,encrypted_access_token TEXT);`);
  await db.exec(BOT_POOL_STORAGE_SQL); await db.exec(BOT_AUTHORIZATION_STORAGE_SQL);
  await db.query("INSERT INTO community_stock_categories VALUES ($1,'offline')",[guild]);
  for (const id of [bot,other]) await db.query("INSERT INTO community_bot_pool(client_id,name,encrypted_value) VALUES ($1,'Bot',$2)",[id,encrypt(JSON.stringify({ clientId:id }))]);
  for (const [index,id] of [one,two].entries()) await db.query("INSERT INTO community_oauth_joins VALUES ($1,'offline',$2,'encrypted-account',$3,'shared-grant')",[guild,id,index]);
  const query = async (sql,args) => { const result = await db.query(sql,args); return { ...result,rowCount:result.rows.length || result.affectedRows || 0 }; };
  const pool = { query,connect:async()=>({ query,release(){} }) };
  let behavior = async () => {};
  let identityApp = bot, identityUser = one, identityStatus = 200;
  const authorized = [];
  const poolService = createCommunityBotPool({ pool,encrypt,decrypt,getSharedConfig:async()=>({guildId:guild}) });
  const controller = () => createBotAuthorizations({ pool,encrypt,decrypt,getConfig:async()=>({guildId:guild}),loadBot:poolService.load,withGrantLock:poolService.withGrantLock,
    token:async(config,member)=> { authorized.push([config.poolBotId,member.discord_user_id]); await behavior(); },
    request:async()=>({response:{ok:identityStatus===200,status:identityStatus},payload:{user:{id:identityUser},application:{id:identityApp},scopes:["guilds.join"]}}),
    refresh:async()=>{throw Error("Unexpected refresh");},parseExpiry:()=>new Date(Date.now()+86400000)
  });
  try { await run({ db,api:controller(),controller,poolService,authorized,setBehavior:value=>{behavior=value;},setIdentity:(app,user,status=200)=>{identityApp=app;identityUser=user;identityStatus=status;} }); }
  finally { await db.close(); }
}

test("bulk authorization selects existing account tokens, persists progress and excludes IDs from public job snapshots", options, () => fixture(async ({api,db,authorized,controller})=>{
  const job = await api.start(bot,{categoryId:"offline"},"https://example.com/callback");
  assert.equal(job.total,2); assert.equal(job.status,"queued"); assert.ok(!("memberIds" in job));
  await assert.rejects(api.start(bot,{categoryId:"offline"},"https://example.com/callback"),error=>error.statusCode===409);
  await api.tick();
  assert.equal((await api.latest(bot)).processed,1);
  await controller().tick();
  const done = await api.latest(bot);
  assert.equal(done.status,"completed"); assert.equal(done.succeeded,2);
  assert.deepEqual(authorized,[[bot,one],[bot,two]]);
  assert.equal((await db.query("SELECT encrypted_access_token FROM community_oauth_joins LIMIT 1")).rows[0].encrypted_access_token,"shared-grant");
}));

test("selected accounts are category-scoped and invalid selection saves no job", options, () => fixture(async ({api,db})=>{
  await assert.rejects(api.start(bot,{categoryId:"missing"},"url"),/category/);
  await assert.rejects(api.start(bot,{categoryId:"offline",discordUserIds:[]},"url"),/Select/);
  await assert.rejects(api.start(bot,{categoryId:"offline",discordUserIds:[unknown]},"url"),/No accounts/);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM community_bot_authorization_jobs")).rows[0].n,0);
  assert.equal((await api.start(bot,{categoryId:"offline",discordUserIds:[two]},"url")).total,1);
}));

test("429 pauses without consuming the member, then resume continues; failures are counted independently", options, () => fixture(async ({api,setBehavior})=>{
  await api.start(bot,{categoryId:"offline"},"url");
  setBehavior(async()=>{throw Object.assign(new Error("limited"),{statusCode:429});});
  await api.tick();
  assert.equal((await api.latest(bot)).status,"paused");
  assert.equal((await api.latest(bot)).processed,0);
  await api.resume(bot);
  setBehavior(async()=>{throw Error("Account unavailable");});
  await api.tick();
  assert.equal((await api.latest(bot)).failed,1);
  setBehavior(async()=>{}); await api.tick();
  const job = await api.latest(bot);
  assert.equal(job.status,"completed"); assert.equal(job.succeeded,1); assert.equal(job.failed,1);
}));

test("cancelled jobs do not start additional account work", options, () => fixture(async ({api,authorized})=>{
  await api.start(bot,{categoryId:"offline"},"url");
  await api.cancel(bot); await api.tick();
  assert.equal(authorized.length,0);
  assert.equal((await api.latest(bot)).status,"cancelled");
}));

const record = id => ({user_id:id,access_token:"access-token-that-is-long-enough",refresh_token:"refresh-token-that-is-long-enough",authed_timestamp:Math.floor(Date.now()/1000),expires_in:86400});
test("pool JSON import validates the exact application, updates only its grants and exports the matching category", options, () => fixture(async ({api,db,setIdentity,poolService})=>{
  setIdentity(other,one);
  let result = await api.importRecords(bot,{categoryId:"offline",records:[record(one)]});
  assert.equal(result.failed,1); assert.match(result.errors[0].message,/another bot/);
  setIdentity(bot,one);
  result = await api.importRecords(bot,{categoryId:"offline",records:[record(one),record(one),record(unknown)]});
  assert.equal(result.imported,1); assert.equal(result.skipped,1); assert.equal(result.failed,1);
  assert.equal((await db.query("SELECT encrypted_access_token FROM community_oauth_joins LIMIT 1")).rows[0].encrypted_access_token,"shared-grant");
  const saved = (await db.query("SELECT encrypted_value FROM community_bot_pool_credentials")).rows[0].encrypted_value;
  assert.ok(!saved.includes("access-token"));
  const exported = await api.exportRecords(bot,"offline");
  assert.equal(exported.length,1); assert.equal(exported[0].user_id,one); assert.equal(exported[0].access_token,record(one).access_token);
  assert.equal((await api.exportRecords(other,"offline")).length,0);
  const counts = (await poolService.list()).find(value=>value.clientId===bot);
  assert.equal(counts.authorizedAccounts,1); assert.equal(counts.activeAccounts,1); assert.equal(counts.expiredAccounts,0);
}));

test("every bulk authorization route is protected by the existing session middleware",()=>{
  const routes=[],auth=()=>{};
  registerBotAuthorizations({get:(...args)=>routes.push(args),post:(...args)=>routes.push(args)},auth,{});
  assert.equal(routes.length,5); assert.ok(routes.every(route=>route[1]===auth));
});
