import test from "node:test";
import assert from "node:assert/strict";
import { planOnlinerBulkAction } from "./onliner-bulk-actions.mjs";

const fixture = () => ({ enabled: true, accounts: [
  { id: "a", proxyUrl: "proxy-one", botToken: "token-a" },
  { id: "b", proxyUrl: "proxy-two", botToken: "token-b" },
  { id: "c", proxyUrl: "proxy-three", botToken: "token-c" }
] });

test("bulk reconnect targets only selected existing IDs once", () => {
  const current = fixture();
  const plan = planOnlinerBulkAction(current, ["a", "a", "c", "missing"], "reconnect");
  assert.deepEqual(plan.succeeded, ["a", "c"]);
  assert.equal(plan.failed[0].accountId, "missing");
  assert.deepEqual(plan.accounts, current.accounts);
});

test("bulk removal preserves unselected accounts and saved input", () => {
  const current = fixture();
  const plan = planOnlinerBulkAction(current, ["a", "c"], "remove");
  assert.deepEqual(plan.accounts, [current.accounts[1]]);
  assert.equal(current.accounts.length, 3);
});

test("proxy rotation updates usage between selections and preserves failures", () => {
  const current = fixture();
  let calls = 0;
  const plan = planOnlinerBulkAction(current, ["a", "b"], "rotate-proxy", (config, reserved, excluded) => {
    calls++;
    assert.equal(reserved.length, 0);
    if (calls === 1) { assert.deepEqual(excluded, ["proxy-one"]); return "proxy-new"; }
    assert.equal(config.accounts[0].proxyUrl, "proxy-new");
    assert.deepEqual(excluded, ["proxy-two"]);
    return "";
  });
  assert.deepEqual(plan.succeeded, ["a"]);
  assert.equal(plan.failed[0].accountId, "b");
  assert.equal(plan.accounts[1].proxyUrl, "proxy-two");
  assert.deepEqual(current, fixture());
});
