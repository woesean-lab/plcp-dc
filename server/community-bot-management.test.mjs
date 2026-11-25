import test from "node:test";
import assert from "node:assert/strict";
import { botGatewayIdentify, managedOnlinerAccounts, onlinerGatewayIdentify, createManagedBotResolver, createBotOnlinerManagement, registerBotOnlinerManagement, safeBotConnectionError } from "./community-bot-management.mjs";

const sharedId = "111111111111111111", poolId = "222222222222222222";
test("bot management resolves the selected application's credentials without changing the shared configuration", async () => {
  const shared = { clientId: sharedId, botToken: "shared-token", guildId: "333333333333333333" };
  let poolReads = 0;
  const resolve = createManagedBotResolver({ getSharedConfig: async () => shared, loadPoolConfig: async id => {
    poolReads++; assert.equal(id, poolId); return { clientId: poolId, botToken: "pool-token" };
  } });
  assert.equal((await resolve(sharedId)).botToken, "shared-token");
  assert.equal(poolReads, 0);
  const pooled = await resolve(poolId);
  assert.equal(pooled.botToken, "pool-token");
  assert.equal(pooled.guildId, shared.guildId);
  assert.equal(pooled.configured, true);
  assert.deepEqual(shared, { clientId: sharedId, botToken: "shared-token", guildId: "333333333333333333" });
  await assert.rejects(resolve("invalid"), error => error.statusCode === 400);
  const mismatch = createManagedBotResolver({ getSharedConfig: async () => shared, loadPoolConfig: async () => shared });
  await assert.rejects(mismatch(poolId), error => error.statusCode === 409);
});

function fixture({ enabled = true, accounts = [], proxy = "http://proxy:8080", limit = 3000 } = {}) {
  let config = { enabled, accounts, untouched: "keep", proxyPool: [proxy] };
  const writes = [], starts = [];
  const service = createBotOnlinerManagement({
    resolveBot: async clientId => ({ clientId, botToken: `${clientId}-private-token` }),
    getConfig: async () => config,
    saveConfig: async value => { writes.push(value); config = value; },
    selectProxy: () => proxy, normalize: value => value,
    start: async (value, account) => starts.push({ value, account }), limit,
    snapshot: async value => ({ worker: { connectionPaused: false }, accounts: value.accounts.map(account => ({ id: account.id, connectionState: "connected" })) })
  });
  return { service, writes, starts, config: () => config };
}

test("linking a saved bot preserves other profiles, uses bot mode and reconnects the same profile without exposing tokens", async () => {
  const unrelated = { id: "other", botToken: "unrelated-private", proxyUrl: "http://other:8080", richPresenceEnabled: true };
  const f = fixture({ accounts: [unrelated] });
  const result = await f.service.connect(poolId);
  assert.deepEqual(f.config().accounts[0], unrelated);
  assert.equal(f.config().untouched, "keep");
  assert.equal(f.config().enabled, true);
  const linked = f.config().accounts[1];
  assert.equal(linked.isBot, true);
  assert.equal(linked.communityBotClientId, poolId);
  assert.equal(linked.botToken, `${poolId}-private-token`);
  assert.equal(linked.richPresenceEnabled, false);
  assert.equal(f.starts[0].account.id, linked.id);
  assert.ok(!JSON.stringify(result).includes("private"));
  await f.service.connect(poolId);
  assert.equal(f.config().accounts.length, 2);
  assert.equal(f.config().accounts[1].id, linked.id);
  assert.notEqual(f.config().accounts[1].connectionRevision, linked.connectionRevision);
  const state = await f.service.status([poolId]);
  assert.deepEqual(state, { bots: [{ clientId: poolId, linked: true, state: "connected", lastError: null }] });
  assert.ok(!JSON.stringify(state).includes("private"));
  assert.deepEqual(await f.service.status([sharedId]), { bots: [] });
});

test("existing token profiles are reused, disabled Onliner stays disabled and capacity/proxy failures save nothing", async () => {
  const f = fixture({ enabled: false, accounts: [{ id: "legacy", botToken: `${sharedId}-private-token`, proxyUrl: "http://existing:8080" }] });
  const result = await f.service.connect(sharedId);
  assert.equal(result.enabled, false);
  assert.equal(f.config().enabled, false);
  assert.equal(f.config().accounts.length, 1);
  assert.equal(f.config().accounts[0].id, "legacy");
  assert.equal(f.config().accounts[0].proxyUrl, "http://existing:8080");
  assert.equal((await f.service.status([sharedId])).bots[0].state, "disabled");
  for (const blocked of [fixture({ proxy: "" }), fixture({ limit: 0 })]) {
    await assert.rejects(blocked.service.connect(poolId), error => error.statusCode === 409);
    assert.equal(blocked.writes.length, 0);
    assert.equal(blocked.starts.length, 0);
  }
});

test("bot identify uses unprivileged bot intents and never requests user session capabilities", () => {
  const presence = { status: "online", activities: [], since: null, afk: false };
  const payload = botGatewayIdentify({ botToken: "private" }, presence);
  assert.equal(payload.op, 2);
  assert.equal(payload.d.token, "private");
  assert.equal(payload.d.intents, 1);
  assert.deepEqual(payload.d.presence, presence);
  assert.equal(payload.d.properties.browser, "Pulcip Onliner");
  assert.ok(!("capabilities" in payload.d));
  assert.ok(!("client_state" in payload.d));
  assert.deepEqual(botGatewayIdentify({ botToken: "private" }, { ...presence, activities: [{ name: "Must stay off" }] }).d.presence.activities, []);
});

test("legacy default/pool profiles receive bot IDENTIFY on the wire without changing account profiles or settings", () => {
  const config = { enabled: true, status: "idle", accounts: [
    { id: "old-default", botToken: "default-token", proxyUrl: "http://existing:8080", richPresenceEnabled: true },
    { id: "old-pool", botToken: "pool-token", isBot: false, proxyUrl: "http://pool:8080" },
    { id: "member", botToken: "member-token", discordUserId: "333333333333333333", richPresenceEnabled: true }
  ] };
  const original = structuredClone(config);
  const migrated = managedOnlinerAccounts(config, [{ clientId: sharedId, botToken: "default-token" }, { clientId: poolId, botToken: "pool-token" }]);
  const presence = { activities: [{ name: "Legacy activity" }], status: "idle", since: null, afk: false };
  const legacy = { properties: { browser: "existing-account-client" }, clientState: { previous: true } };
  for (const account of migrated.accounts.slice(0, 2)) {
    const wire = JSON.parse(JSON.stringify(onlinerGatewayIdentify(account, presence, legacy)));
    assert.equal(wire.op, 2);
    assert.equal(wire.d.intents, 1);
    assert.equal(wire.d.properties.browser, "Pulcip Onliner");
    assert.deepEqual(wire.d.presence.activities, []);
    assert.ok(!("capabilities" in wire.d) && !("client_state" in wire.d));
    assert.equal(account.richPresenceEnabled, false);
  }
  assert.deepEqual(config, original, "classification does not mutate saved configuration");
  assert.equal(migrated.accounts[0].proxyUrl, original.accounts[0].proxyUrl);
  const userWire = onlinerGatewayIdentify(migrated.accounts[2], presence, legacy);
  assert.deepEqual(userWire.d.properties, legacy.properties);
  assert.deepEqual(userWire.d.client_state, legacy.clientState);
  assert.equal(userWire.d.capabilities, 16381);
  assert.equal(migrated.accounts[2].richPresenceEnabled, true);
  assert.deepEqual(onlinerGatewayIdentify({ botToken: "token", communityBotClientId: poolId }, presence, legacy).d.intents, 1,
    "a linked application cannot fall back to the account packet if its old isBot flag is missing");
});

test("connection error details keep the diagnostic code and redact saved tokens and proxy credentials", async () => {
  const account = { id: "linked", communityBotClientId: poolId, botToken: "private-token", proxyUrl: "http://user:password@proxy:8080" };
  const message = "Proxy authentication failed (HTTP 407). http://user:password@proxy:8080 token=private-token";
  const service = createBotOnlinerManagement({
    getConfig: async () => ({ enabled: true, accounts: [account] }),
    snapshot: async () => ({ accounts: [{ id: "linked", connectionState: "error", lastError: message }] })
  });
  const result = (await service.status([poolId])).bots[0];
  assert.equal(result.state, "error");
  assert.match(result.lastError, /HTTP 407/);
  assert.ok(!JSON.stringify(result).includes("private-token"));
  assert.ok(!JSON.stringify(result).includes("password"));
  assert.equal(safeBotConnectionError("", account), null);
  assert.equal(safeBotConnectionError("Other socks5://name:secret@host:1234", account), "Other socks5://[redacted]@host:1234");
});

test("every bot Onliner route requires the admin session", () => {
  const routes = [];
  const session = () => {};
  registerBotOnlinerManagement({ get: (...args) => routes.push(args), post: (...args) => routes.push(args) }, session, {});
  assert.equal(routes.length, 2);
  assert.ok(routes.every(route => route[1] === session));
});
