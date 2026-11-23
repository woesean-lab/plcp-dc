import test from "node:test";
import assert from "node:assert/strict";
import { createRotatingBoostOnliner } from "./rotating-boost-onliner.mjs";

function fixture() {
  const rows = [{ id: "r", token: "mail:pass:token:2fa", status: "in_use" }];
  let config = { enabled: true, accounts: [{ id: "legacy", botToken: "token" }, { id: "members", botToken: "other" }] };
  const queries = []; const client = { query: async (...args) => queries.push(args) };
  const service = createRotatingBoostOnliner({ stock: { withAccounts: operation => operation(rows, client), remove: (_id, operation) => operation(rows[0], client), removeMany: (ids, operation) => operation(rows.filter(row => ids.includes(row.id)), client) }, readConfig: async () => config, writeConfig: async (_client, value) => { config = value; } });
  return { rows, service, queries, config: () => config };
}

test("retiring rotating Onliner removes only matching profiles and runtimes, including in-use accounts", async () => {
  const f = fixture(); const result = await f.service.retire();
  assert.deepEqual(result.removedIds, ["legacy"]); assert.deepEqual(f.config().accounts.map(item => item.id), ["members"]);
  assert.deepEqual(f.queries[0][1], [["legacy"]]); assert.equal(f.rows[0].status, "in_use");
  assert.equal(f.service.connect, undefined);
});

test("legacy retirement is idempotent and removal cleans matching profiles", async () => {
  const f = fixture(); await f.service.retire(); await f.service.retire(); assert.equal(f.queries.length, 1);
  const fresh = fixture(); assert.deepEqual((await fresh.service.remove("r")).removedIds, ["legacy"]);
});


test("bulk removal detaches matching legacy profiles in one cleanup", async () => {
  const f = fixture(); const result = await f.service.removeMany(["r"]);
  assert.deepEqual(result.removedIds, ["legacy"]); assert.equal(f.queries.length, 1);
  assert.deepEqual(f.config().accounts.map(account => account.id), ["members"]);
});
