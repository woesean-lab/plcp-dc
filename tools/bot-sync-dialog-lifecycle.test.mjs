import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/components/BotPoolSettings.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("BotPoolSettings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let dialog;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "BotSyncDialog") dialog = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(dialog);
function callback(name, scope) {
  const attribute = dialog.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === name);
  const expression = attribute.initializer.expression.getText(ast);
  return vm.runInNewContext(`(${expression})`, scope);
}

test("closing sync after start, resume or Cancel preserves the settings page and bot list", () => {
  const calls = [];
  const scope = { setSyncing: value => calls.push(["close", value]), load: () => calls.push(["load"]), onRefreshDefault: () => calls.push(["reload-settings"]) };
  callback("onClose", scope)();
  assert.deepEqual(calls, [["close", null]]);
});

test("completed sync refreshes pool counts without reloading default connections", () => {
  const calls = [];
  const scope = { load: async () => calls.push("pool-counts"), onRefreshDefault: () => calls.push("reload-settings") };
  callback("onChanged", scope)();
  assert.deepEqual(calls, ["pool-counts"]);
});
