import test from "node:test";
import assert from "node:assert/strict";
import { createBotOrderSettings, registerBotOrderSettings } from "./community-bot-order-settings.mjs";

const shared = "111111111111111111", poolBot = "222222222222222222";
function fixture() {
  const settings = new Map([["community_oauth_config", "existing-credentials"], ["unrelated", "keep"]]);
  const writes = [], toggles = [];
  let config = { clientId: shared, configured: true };
  const service = createBotOrderSettings({
    load: async key => settings.get(key), save: async (key, value) => { writes.push(key); settings.set(key, value); }, getConfig: async () => config,
    bots: { setEnabled: async (id, enabled) => { if (id !== poolBot) throw Object.assign(Error("Bot missing"), { statusCode: 404 }); toggles.push({ id, enabled }); } }
  });
  return { service, settings, writes, toggles, setConfig: value => { config = value; } };
}

test("default participation starts off and reading settings never changes credentials or pool flags", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.read(), { defaultClientId: shared, defaultUseForNewOrders: false });
  assert.equal(f.writes.length, 0); assert.equal(f.toggles.length, 0); assert.equal(f.settings.get("community_oauth_config"), "existing-credentials");
});

test("default participation persists independently and is bound to the exact application", async () => {
  const f = fixture();
  await f.service.update({ clientId: shared, useForNewOrders: true });
  assert.equal((await f.service.read()).defaultUseForNewOrders, true);
  assert.deepEqual(f.writes, ["community_bot_new_orders"]);
  assert.equal(f.settings.get("community_oauth_config"), "existing-credentials"); assert.equal(f.settings.get("unrelated"), "keep");
  f.setConfig({ clientId: "333333333333333333", configured: true });
  assert.equal((await f.service.read()).defaultUseForNewOrders, false, "changing applications does not inherit the old setting");
  f.setConfig({ clientId: shared, configured: true });
  await f.service.update({ clientId: shared, useForNewOrders: false });
  assert.equal((await f.service.read()).defaultUseForNewOrders, false); assert.equal(f.toggles.length, 0);
});

test("pool settings use the existing new-assignment flag and never modify the default preference", async () => {
  const f = fixture();
  await f.service.update({ clientId: poolBot, useForNewOrders: false });
  await f.service.update({ clientId: poolBot, useForNewOrders: true });
  assert.deepEqual(f.toggles, [{ id: poolBot, enabled: false }, { id: poolBot, enabled: true }]);
  assert.equal(f.writes.length, 0); assert.equal((await f.service.read()).defaultUseForNewOrders, false);
});

test("invalid or unavailable bots cannot change settings", async () => {
  const f = fixture();
  for (const input of [null, {}, { clientId: "invalid", useForNewOrders: true }, { clientId: shared, useForNewOrders: "yes" }]) await assert.rejects(f.service.update(input), error => error.statusCode === 400);
  f.setConfig({ clientId: shared, configured: false });
  await assert.rejects(f.service.update({ clientId: shared, useForNewOrders: true }), error => error.statusCode === 409);
  await assert.rejects(f.service.update({ clientId: "333333333333333333", useForNewOrders: true }), error => error.statusCode === 404);
  assert.equal(f.writes.length, 0); assert.equal(f.toggles.length, 0);
});

test("both order-setting routes require the existing authenticated admin session", () => {
  const routes = [], auth = () => {};
  registerBotOrderSettings({ get: (...args) => routes.push(args), put: (...args) => routes.push(args) }, auth, {});
  assert.equal(routes.length, 2); assert.ok(routes.every(route => route[1] === auth));
});
