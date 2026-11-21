import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
import { getCustomerReactionSummary } from "../server/customer-order-reactions.mjs";

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
assert.ok(ts.isConditionalExpression(section.parent), "the complete section has a visibility condition");
const code = ts.transpileModule(`export function render(result, reactionSettingsOrder, isCommunityProvider = true) { return (${section.parent.getText(source)}); }`, {
  compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const components = {
  CustomerOrderReactionPanel: () => null,
  OrderReactionAccessCard: () => null,
  OrderReactionSettingsDialog: () => null
};
const exports = {};
vm.runInNewContext(code, { React, exports, ...components });
const order = (enabled) => ({ uniqid: "same-order", customerReactions: { enabled, canConfigure: true, disabled: !enabled, dailyLimit: 50, firstDayLimit: 500 } });
const children = (enabled, settings = null) => React.Children.toArray(exports.render(order(enabled), settings).props.children);

test("unsupported categories and expired support omit the entire section, including its dialog", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const allocation = { reactionUseEnabled: true, isPeriodic: true, expiredAt: "2026-12-21T12:00:00Z" };
  const supported = { ...order(false), provider: "community", amount: 500, categoryAllocations: [allocation] };
  for (const patch of [{ reactionUseEnabled: false }, { isPeriodic: false }, { expiredAt: "2026-11-20T12:00:00Z" }]) {
    const unsupported = { ...supported, categoryAllocations: [{ ...allocation, ...patch }] };
    unsupported.customerReactions = getCustomerReactionSummary(unsupported, now);
    assert.equal(exports.render(unsupported, "same-order"), null);
  }
  assert.equal(exports.render({ uniqid: "no-summary" }, null), null);
  assert.equal(exports.render(order(true), null, false), null);
  const mixed = { ...supported, categoryAllocations: [{ ...allocation, reactionUseEnabled: false }, allocation] };
  mixed.customerReactions = getCustomerReactionSummary(mixed, now);
  assert.ok(exports.render(mixed, null), "a supported active portion keeps access in mixed-category orders");
});

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
