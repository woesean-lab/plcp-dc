import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

// Exercise the real section's JSX in every transition without calling live APIs.
const filename = new URL("../src/pages/OrderPage.tsx", import.meta.url);
const source = ts.createSourceFile("OrderPage.tsx", fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let section;
function find(node) {
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className"
      && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "lookup-reaction-section"
  )) section = node;
  ts.forEachChild(node, find);
}
find(source);
assert.ok(section, "the order's reaction section exists");
const code = ts.transpileModule(`export function render(result, reactionSettingsOrder) { return (${section.getText(source)}); }`, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const components = {
  CustomerOrderReactionPanel: () => null,
  OrderReactionAccessCard: () => null,
  OrderReactionSettingsDialog: () => null
};
const exports = {};
vm.runInNewContext(code, { React, exports, ...components });
const order = (enabled) => ({ uniqid: "same-order", customerReactions: { enabled, disabled: !enabled, dailyLimit: 50 } });
const children = (enabled, settings = null) => React.Children.toArray(exports.render(order(enabled), settings).props.children);

test("opening settings never gives the reaction panel and dialog the same sibling key", () => {
  const open = children(true, "same-order");
  assert.equal(open.length, 2);
  assert.equal(new Set(open.map((child) => child.key)).size, 2);
  assert.equal(open[0].type, components.CustomerOrderReactionPanel);
  assert.equal(open[1].type, components.OrderReactionSettingsDialog);
});

test("disabling and re-enabling replace the card while keeping the open dialog's identity", () => {
  const enabled = children(true, "same-order");
  const disabled = children(false, "same-order");
  assert.equal(disabled.length, 2);
  assert.equal(disabled[0].type, components.OrderReactionAccessCard);
  assert.notEqual(disabled[0].key, enabled[0].key);
  assert.equal(disabled[1].key, enabled[1].key);
  assert.notEqual(disabled[0].key, disabled[1].key);
  assert.equal(children(false).length, 1);
  assert.equal(children(true).length, 1);
  assert.equal(children(true)[0].key, enabled[0].key);
});
