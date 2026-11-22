import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const output = await build({ stdin: { contents: 'export * from "./src/components/MembersStockWorkspace.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" }, bundle: true, write: false, jsx: "automatic", format: "cjs", platform: "node", packages: "external", loader: { ".css": "empty" }, logLevel: "silent" });
const module = { exports: {} };
new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { MembersStockRow, MembersStockCategory, MembersStockSecret } = module.exports;
const render = (Component, props, child) => renderToStaticMarkup(React.createElement(Component, props, child));
const record = { id: "sample", username: "sample_user", displayName: "Sample member", avatarUrl: null, authorizedAt: "2026-11-22T09:00:00Z", status: "authorized" };
const rowProps = { record, selected: false, onSelect() {}, open: false, onToggle() {}, badges: React.createElement("span", null, "Active"), actions: React.createElement("button", { disabled: true }, "Reserved member action") };

test("collapsed member rows do not mount secrets or long diagnostics", () => {
  const html = render(MembersStockRow, rowProps, React.createElement("div", null, "sample-secret-token"));
  assert.equal(html.includes("sample-secret-token"), false);
  assert.ok(html.includes("Sample member"));
  assert.ok(html.includes("Active"));
  assert.ok(html.includes('aria-expanded="false"'));
  assert.ok(html.includes('disabled=""'));
});

test("expanded details are tied to the row disclosure and preserve member actions", () => {
  const html = render(MembersStockRow, { ...rowProps, open: true }, "Account diagnostics");
  const controlledId = html.match(/aria-controls="([^"]+)"/)[1];
  assert.ok(html.includes(`id="${controlledId}"`));
  assert.ok(html.includes('aria-expanded="true"'));
  assert.ok(html.includes("Account diagnostics"));
  assert.ok(html.includes("Reserved member action"));
});

test("category management actions stay outside the category selection button", () => {
  const html = render(MembersStockCategory, { category: { name: "Sample pool", colorKey: "violet", isPeriodic: true, summary: { ready: 1735, authorized: 1735, failed: 85 } }, selected: true, icon: null, indicators: null, actions: React.createElement("button", null, "Edit category"), onSelect() {} });
  const selectButton = html.match(/<button[^>]*class="members-stock-category-select"[\s\S]*?<\/button>/)[0];
  assert.ok(selectButton.includes('aria-pressed="true"'));
  assert.ok(selectButton.includes("1,735"));
  assert.ok(selectButton.includes("1,820 total"));
  assert.equal(selectButton.includes("Edit category"), false);
  assert.ok(html.includes("Edit category"));
});

test("secret controls render hidden until explicitly revealed, without starting a fetch", () => {
  let called = false;
  const props = { label: "Access token", username: "sample", busy: false, disabled: false, onToggle() { called = true; }, onCopy() {} };
  const hidden = render(MembersStockSecret, props);
  assert.equal(called, false);
  assert.ok(hidden.includes("Hidden"));
  assert.ok(hidden.includes('aria-label="Show sample access token"'));
  assert.equal(hidden.includes('aria-label="Copy sample access token"'), false);
  const visible = render(MembersStockSecret, { ...props, value: "sample-token" });
  assert.ok(visible.includes("sample-token"));
  assert.ok(visible.includes('aria-label="Hide sample access token"'));
  assert.ok(visible.includes('aria-label="Copy sample access token"'));
});

test("stock status fields retain zero servers and explicit negative states", () => {
  const html = render(module.exports.MembersStockBadges, { record: { ...record, onlinerConnected: true, onlinerConnectionState: "error", onlinerRichPresenceEnabled: false, joinedServerCount: 0, status: "failed" } });
  for (const value of ["Onliner", "Failed", "Rich Presence", "Off", "Servers", ">0<", "OAuth", "Inactive"]) assert.ok(html.includes(value), value);
  assert.equal((html.match(/ui-badge-destructive/g) || []).length, 2);
  const disconnected = render(module.exports.MembersStockBadges, { record: { ...record, onlinerConnected: false, joinedServerCount: 1 } });
  assert.equal(disconnected.includes("Onliner"), false);
  assert.equal(disconnected.includes("Rich Presence"), false);
  assert.ok(disconnected.includes("Servers"));
  assert.ok(disconnected.includes("Active"));
});
