import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

// Exercise the real TypeScript view model without a browser or production API.
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => name.startsWith(".") ? load(path.relative(root, path.resolve(path.dirname(filename), name + ".ts"))) : require(name), Date, Number });
  return exports;
}

const { filterWorkspaceOrders, EMPTY_ORDERS_FILTERS, orderDelivery, orderStatus, canStartOrderLeave } = load("src/lib/orders-workspace.ts");
const now = Date.parse("2026-11-19T12:00:00Z");
const day = 86400_000;
const at = (days) => new Date(now + days * day).toISOString();
const base = { uniqid: "base", provider: "community", service: "COMMUNITY-ONLINE", status: "COMPLETED", createdAt: at(-10), expiredAt: at(10), amount: 500, added: 500 };
const orders = [
  { ...base, uniqid: "expired-old", serverName: "Builders", createdAt: at(-30), expiredAt: at(-10) },
  { ...base, uniqid: "expired-new", serverName: "Midnight", createdAt: at(-25), expiredAt: at(-1), autoLeaveJob: { status: "completed_with_errors", failed: 20 } },
  { ...base, uniqid: "soon", serverName: "Builders Lounge", expiredAt: at(3) },
  { ...base, uniqid: "live", serverName: "Builders Live", status: "PROCESS", added: 30 },
  { ...base, uniqid: "boosts", provider: "dcord", service: "DCORD-BOOSTS", expiredAt: null },
  { ...base, uniqid: "no-period", expiredAt: "invalid" }
];
const ids = (filters) => Array.from(filterWorkspaceOrders(orders, { ...EMPTY_ORDERS_FILTERS, ...filters }, now), (order) => order.uniqid);

test("service, delivery, search and support filters combine without changing the source", () => {
  assert.deepEqual(ids({ search: "BUILDERS", service: "members", status: "COMPLETED", period: "soon" }), ["soon"]);
  assert.deepEqual(ids({ status: "live" }), ["live"]);
  assert.deepEqual(ids({ service: "boosts" }), ["boosts"]);
  assert.deepEqual(ids({ period: "leave_failed" }), ["expired-new"]);
  assert.deepEqual(orders.map((order) => order.uniqid), ["expired-old", "expired-new", "soon", "live", "boosts", "no-period"]);
});

test("expiry shortcuts sort by support end, with unknown dates last", () => {
  assert.deepEqual(ids({ period: "expired", sort: "expiry_desc" }), ["expired-new", "expired-old"]);
  assert.deepEqual(ids({ period: "soon", sort: "expiry_asc" }), ["soon"]);
  const sorted = ids({ sort: "expiry_asc" });
  assert.deepEqual(sorted.slice(-2), ["boosts", "no-period"]);
});

test("delivery progress is independent of expired support and clamps invalid totals", () => {
  assert.equal(orderStatus(orders[1].status).label, "Completed");
  assert.equal(orderDelivery(orders[1]).percent, 100);
  assert.equal(orderDelivery({ ...base, added: 900 }).delivered, 500);
  assert.equal(orderDelivery({ ...base, amount: 0 }).percent, 0);
  assert.equal(orderDelivery({ ...base, amount: undefined }).total, null);
});

test("leave action only targets eligible expired members and cannot repeat finished jobs", () => {
  assert.equal(canStartOrderLeave({ ...orders[0], autoLeaveCandidateCount: 500 }, now), true);
  assert.equal(canStartOrderLeave({ ...orders[1], autoLeaveCandidateCount: 500 }, now), false);
  assert.equal(canStartOrderLeave({ ...orders[0], membersLeftAt: at(-1) }, now), false);
  assert.equal(canStartOrderLeave({ ...base, provider: "dcord", autoLeaveCandidateCount: 500 }, now), false);
  const mixed = { ...base, categoryAllocations: [{ categoryId: "expired", isPeriodic: true, expiredAt: at(-1) }, { categoryId: "active", isPeriodic: true, expiredAt: at(20) }], communityResults: [{ categoryId: "expired", state: "joined", membershipStatus: "active" }, { categoryId: "active", state: "joined" }] };
  assert.equal(canStartOrderLeave(mixed, now), true);
  assert.equal(canStartOrderLeave({ ...mixed, communityResults: [{ categoryId: "expired", state: "joined", membershipStatus: "removed" }] }, now), false);
});
