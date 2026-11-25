import test from "node:test";
import assert from "node:assert/strict";
import { createManagedBotResolver, withoutManagedBotProfiles } from "./community-bot-management.mjs";

const sharedId="111111111111111111", poolId="222222222222222222";
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


test("removing bot Onliner only excludes profiles linked by the removed integration", () => {
  const user = { id: "member", botToken: "member-token", discordUserId: "333333333333333333", proxyUrl: "http://existing:8080", richPresenceEnabled: true };
  const manual = { id: "manual", botToken: "manual-token", proxyUrl: "http://manual:8080" };
  const config = { enabled: true, activityText: "Keep", proxyPool: [user.proxyUrl], accounts: [
    { id: "default-bot", communityBotClientId: sharedId, botToken: "default-token" }, user,
    { id: "pool-bot", communityBotClientId: poolId, botToken: "pool-token" }, manual
  ] };
  const original = structuredClone(config);
  const result = withoutManagedBotProfiles(config);
  assert.deepEqual(result.accounts, [user, manual]);
  assert.equal(result.enabled, true);
  assert.equal(result.activityText, "Keep");
  assert.deepEqual(result.proxyPool, config.proxyPool);
  assert.deepEqual(config, original);
  assert.equal(withoutManagedBotProfiles(null), null);
  assert.deepEqual(withoutManagedBotProfiles({ botToken: "legacy-member-token" }), { botToken: "legacy-member-token" });
});
