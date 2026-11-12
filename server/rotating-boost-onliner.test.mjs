import test from "node:test";
import assert from "node:assert/strict";
import { attachRotatingOnliner, createRotatingBoostOnliner } from "./rotating-boost-onliner.mjs";

function fixture({ proxy = "http://fixed:secret@assigned:8080", accounts = [], enabled = true, limit = 10 } = {}) {
  const row = { id: "r", token: "mail:pass:token:2fa", proxy, subscriptionStartedAt: null };
  let config = { enabled, accounts };
  const queries = [];
  const client = { query: async (...args) => { queries.push(args); } };
  const stock = { withAccount: async (id, operation) => {
    assert.equal(id, row.id);
    return operation(row, client);
  }, remove: async (id, operation) => { assert.equal(id, row.id); return operation(row, client); } };
  const service = createRotatingBoostOnliner({ stock, accountLimit: limit,
    readConfig: async () => config, writeConfig: async (_client, next) => { config = next; } });
  return { service, row, queries, config: () => config };
}

test("connect uses the assigned proxy and extracted token without starting subscription or rich presence", async () => {
  const f = fixture();
  const result = await f.service.connect("r");
  assert.equal(result.account.proxyUrl, f.row.proxy);
  assert.equal(result.account.botToken, "token");
  assert.equal(result.account.richPresenceEnabled, false);
  assert.equal(f.row.subscriptionStartedAt, null);
  await f.service.connect("r");
  assert.equal(f.config().accounts.length, 1);
});

test("missing assigned proxy and disabled Onliner fail without adding a profile", async () => {
  for (const options of [{ proxy: null }, { enabled: false }]) {
    const f = fixture(options);
    await assert.rejects(f.service.connect("r"), { statusCode: 409 });
    assert.equal(f.config().accounts.length, 0);
  }
});

test("existing token profile is reused with the account's fixed proxy even at capacity", async () => {
  const f = fixture({ accounts: [{ id: "old", botToken: "token", proxyUrl: "http://other:8080" }], limit: 1 });
  const { account } = await f.service.connect("r");
  assert.equal(account.id, "old");
  assert.equal(account.proxyUrl, f.row.proxy);
  assert.equal(f.config().accounts.length, 1);
  const full = fixture({ accounts: [{ id: "other", botToken: "other" }], limit: 1 });
  await assert.rejects(full.service.connect("r"), { statusCode: 409 });
});

test("disconnect and stock removal remove matching profiles and persisted runtime only", async () => {
  for (const action of ["disconnect", "remove"]) {
    const f = fixture({ accounts: [{ id: "a", botToken: "token" }, { id: "b", botToken: "other" }] });
    const result = await f.service[action]("r");
    assert.deepEqual(result.removedIds, ["a"]);
    assert.deepEqual(f.config().accounts.map((account) => account.id), ["b"]);
    assert.deepEqual(f.queries[0][1], [["a"]]);
    assert.equal(f.row.token, "mail:pass:token:2fa");
  }
});

test("status reports actual runtime rather than treating a registered profile as live", () => {
  const accounts = [{ id: "r", token: "mail:pass:token:2fa" }, { id: "other", token: "other" }];
  const config = { enabled: true, accounts: [{ id: "a", botToken: "token" }] };
  const snapshot = { accounts: [{ id: "a", connectionState: "error", lastError: "Proxy unavailable" }] };
  const rows = attachRotatingOnliner(accounts, config, snapshot);
  assert.equal(rows[0].onlinerConnected, true);
  assert.equal(rows[0].onlinerConnectionState, "error");
  assert.equal(rows[0].onlinerLastError, "Proxy unavailable");
  assert.equal(rows[1].onlinerConnected, false);
  assert.equal(rows[1].onlinerConnectionState, null);
  assert.equal(attachRotatingOnliner(accounts, { ...config, enabled: false }, snapshot)[0].onlinerConnectionState, "disabled");
  snapshot.accounts[0].connectionState = "connected";
  assert.equal(attachRotatingOnliner(accounts, config, snapshot)[0].onlinerConnectionState, "connected");
});
