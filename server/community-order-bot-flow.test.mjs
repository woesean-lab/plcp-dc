import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const code = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
const guildId = "123456789012345678";
const stockId = "234567890123456789";
const clientId = "345678901234567890";
const userId = "456789012345678901";

function fixture({ waiting = false, paused = false, stockCount = 1 } = {}) {
  const calls = [];
  const member = { discord_user_id: userId, username: "Member", category_id: "offline", encrypted_account_token: "encrypted-account" };
  const query = async (sql, args = []) => {
    calls.push({ sql, args });
    if (sql.includes("FROM community_stock_categories")) return { rowCount: 1, rows: [{ id: "offline", name: "Offline", join_methods: ["create_invite"] }] };
    if (sql.includes("FROM community_oauth_joins")) return { rowCount: stockCount, rows: stockCount ? [member] : [] };
    return { rowCount: 1, rows: [] };
  };
  const client = { query, release() { calls.push({ sql: "RELEASE" }); } };
  const scope = {
    console, Date, pool: { query, connect: async () => client },
    getCommunityOAuthConfig: async () => ({ configured: true, guildId: stockId, clientId: "shared" }),
    orderBotService: {
      async prepare(input, base, options) {
        calls.push({ sql: "PREPARE", input, options });
        return { configured: true, orderBotId: options.orderId, clientId, guildId: base.guildId, clientSecret: input.clientSecret, botToken: input.botToken, botName: "Nova" };
      },
      async save(connection, config) { assert.equal(connection, client); calls.push({ sql: "SAVE_BOT", config }); }
    },
    communityBotPool: {
      async grantUserIds() { return [userId]; },
      async acquire(options) { calls.push({ sql: "ACQUIRE_POOL", options }); return { configured: true, clientId, poolBotId: clientId, orderBotId: options.orderId, guildId: options.base.guildId, botName: "Pool bot" }; },
      async release(orderId) { calls.push({ sql: "RELEASE_POOL", orderId }); }
    },
    async resolveConfiguredCommunityInvite(invite, options) {
      calls.push({ sql: "RESOLVE", options });
      return { config: { ...(options.configOverride || { clientId: "shared", guildId: stockId }), guildId },
        serverInfo: { guildId, guildName: "Nova" }, waitingForBot: waiting, invitesPaused: paused, botInvite: "https://example.com/bot" };
    },
    isCommunityServiceType: () => true, normalizeCommunitySpeedProfile: () => "safe",
    isDiscordGuildId: value => /^\d{16,22}$/.test(String(value)),
    normalizeCommunityJoinMethod: value => value || "create_invite", normalizeSubmittedDiscordResolution: () => null,
    parseCommunityCategoryJoinMethods: value => value, getCommunityStockTypeFromService: () => "offline", parseCommunityCategoryId: value => value,
    validateCustomerReactionLimit: () => 0, createCommunityOrderId: () => "order-one",
    loadCommunityUnavailableUserIds: async () => [], communityJoinMethodUsesAccountToken: () => false,
    interleaveCommunityMembers: groups => groups.flat(),
    async processCommunityOrder(order, members, config) { calls.push({ sql: "PROCESS", order, members, config }); },
    saveTrackedOrderPayload: async () => {}, loadDcordApiKey: async () => {}
  };
  vm.runInNewContext(`${code("createCommunityOrder")};this.create = createCommunityOrder;`, scope);
  const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  const req = { protocol: "https", get: () => "console.example.com", body: { service: "COMMUNITY-OFFLINE", id: "invite", amount: 1, delay: 1,
    newBot: { botToken: "new-private-bot-token", clientSecret: "new-private-client-secret" } } };
  return { calls, res, req, run: () => scope.create(req, res, error => { throw error; }) };
}

test("new bot creation binds encrypted configuration atomically and starts only with account-token stock", async () => {
  const { calls, res, run } = fixture();
  await run();
  assert.equal(res.statusCode, 200);
  const selected = calls.find(call => call.sql.includes("FROM community_oauth_joins"));
  assert.equal(selected.args[4], true);
  const inserted = JSON.parse(calls.find(call => call.sql.includes("INSERT INTO tracked_orders")).args[1]);
  assert.equal(inserted.customBot, true);
  assert.equal(inserted.botApplicationId, clientId);
  assert.equal(inserted.botName, "Nova");
  assert.ok(!JSON.stringify(inserted).includes("private"));
  assert.ok(!JSON.stringify(res.body).includes("private"));
  const savedIndex = calls.findIndex(call => call.sql === "SAVE_BOT");
  const commitIndex = calls.findIndex(call => call.sql === "COMMIT");
  const processIndex = calls.findIndex(call => call.sql === "PROCESS");
  assert.ok(savedIndex < commitIndex && commitIndex < processIndex);
  assert.equal(calls[processIndex].config.orderBotId, "order-one");
  assert.equal(calls[processIndex].config.clientId, clientId);
  assert.equal(calls.find(call => call.sql === "PREPARE").options.redirectUri, "https://console.example.com/api/community/oauth/callback");
});

test("waiting and restricted orders persist their bot without starting account authorizations or delivery", async () => {
  for (const options of [{ waiting: true }, { paused: true }]) {
    const { calls, run } = fixture(options);
    await run();
    assert.ok(calls.some(call => call.sql === "SAVE_BOT"));
    assert.ok(!calls.some(call => call.sql === "PROCESS"));
  }
});

test("insufficient reauthorizable stock rolls back without persisting the bot or starting delivery", async () => {
  const { calls, res, run } = fixture({ stockCount: 0 });
  await run();
  assert.equal(res.statusCode, 409);
  assert.ok(calls.some(call => call.sql === "ROLLBACK"));
  assert.ok(!calls.some(call => call.sql === "SAVE_BOT" || call.sql === "PROCESS"));
});

test("leaving New bot off preserves the existing shared application path", async () => {
  const { calls, req, run } = fixture();
  delete req.body.newBot;
  await run();
  assert.ok(!calls.some(call => call.sql === "PREPARE" || call.sql === "SAVE_BOT"));
  assert.equal(calls.find(call => call.sql === "PROCESS").config.clientId, "shared");
  assert.equal(calls.find(call => call.sql.includes("FROM community_oauth_joins")).args[4], false);
});

test("pool orders pin their selected bot and release the reservation after committing the order", async () => {
  const { calls, req, run } = fixture();
  delete req.body.newBot; req.body.useBotPool = true;
  await run();
  const order = JSON.parse(calls.find(call => call.sql.includes("INSERT INTO tracked_orders")).args[1]);
  assert.equal(order.poolBotId, clientId);
  assert.equal(order.botApplicationId, clientId);
  assert.equal(order.customBot, true);
  assert.equal(calls.find(call => call.sql === "PROCESS").config.poolBotId, clientId);
  assert.equal(calls.find(call => call.sql.includes("FROM community_oauth_joins")).args[4], true);
  assert.ok(calls.findIndex(call => call.sql === "COMMIT") < calls.findIndex(call => call.sql === "RELEASE_POOL"));
});

test("failed pool orders release reservations without saving credentials or starting delivery", async () => {
  const { calls, req, res, run } = fixture({ stockCount: 0 });
  delete req.body.newBot; req.body.useBotPool = true;
  await run();
  assert.equal(res.statusCode, 409);
  assert.equal(calls.filter(call => call.sql === "RELEASE_POOL").length, 1);
  assert.ok(!calls.some(call => call.sql === "SAVE_BOT" || call.sql === "PROCESS"));
});

test("invalid pool flags and mixed selection are rejected before acquiring a bot", async () => {
  for (const flag of [true, "yes"]) {
    const { calls, req, res, run } = fixture();
    req.body.useBotPool = flag;
    await run();
    assert.equal(res.statusCode, 400);
    assert.ok(!calls.some(call => call.sql === "ACQUIRE_POOL"));
  }
});
