import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(fs.readFileSync(new URL("../src/lib/order-status.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const exports = {};
vm.runInNewContext(code, { exports });
const { mergeOrderStatus } = exports;
const current = { uniqid: "order", status: "PROCESS", added: 0,
  customerReactions: { settingsRevision: 2, dailyLimit: 100, used: 10, remaining: 90 } };

test("a poll started before Save limit cannot restore its old reaction settings", () => {
  const merged = mergeOrderStatus(current, { ...current, added: 20, customerReactions: { settingsRevision: 1, dailyLimit: 50 } });
  assert.equal(merged.customerReactions.dailyLimit, 100);
  assert.equal(merged.customerReactions.settingsRevision, 2);
  assert.equal(merged.added, 20, "fresh delivery progress remains visible");
});

test("same-revision usage updates and newer settings still apply", () => {
  const usage = { ...current.customerReactions, used: 20, remaining: 80 };
  assert.equal(mergeOrderStatus(current, { ...current, customerReactions: usage }).customerReactions.remaining, 80);
  const newer = { ...usage, settingsRevision: 3, dailyLimit: 200 };
  assert.equal(mergeOrderStatus(current, { ...current, customerReactions: newer }).customerReactions.dailyLimit, 200);
});

test("settings revision comparison does not cross order identities", () => {
  const another = { ...current, uniqid: "another", customerReactions: { settingsRevision: 0, dailyLimit: 50 } };
  assert.equal(mergeOrderStatus(current, another).customerReactions.dailyLimit, 50);
});
