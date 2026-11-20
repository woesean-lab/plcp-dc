import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const output = await build({
  stdin: { contents: 'export { ReactionPanel } from "./src/components/ReactionPanel.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, write: false, jsx: "automatic", format: "cjs", platform: "node", packages: "external",
  loader: { ".css": "empty" }, define: { "import.meta.env": "{}" }, logLevel: "silent"
});
const module = { exports: {} };
new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const noop = () => {};
function render(props) {
  return renderToStaticMarkup(React.createElement(module.exports.ReactionPanel, {
    collapsible: true, failed: 0, eligibleMembers: 50, messageDraft: "", countDraft: 1,
    selectedEmojis: ["mixed"], saving: false, requestEnabled: false, requests: [],
    onMessageChange: noop, onCountChange: noop, onEmojiSelectionChange: noop, onSubmit: noop, ...props
  }));
}

test("lowering the cap below usage preserves actual queued and delivered counts in the panel", () => {
  const html = render({ limit: 20, used: 100, completed: 50, remaining: 0 });
  const pending = html.match(/data-tone="pending"[\s\S]*?<small>/)?.[0] || "";
  assert.ok(pending.includes("<strong>50</strong>"), "the real pending count remains 50 even though the cap is 20");
  const delivered = html.match(/data-tone="success"[\s\S]*?<small>/)?.[0] || "";
  assert.ok(delivered.includes("<strong>50</strong>"));
  assert.ok(html.includes('aria-valuetext="0 of 20 reactions available today"'));
});

test("the manually raised first-day limit appears as 1000 with 950 left after 50 reactions", () => {
  const html = render({ limit: 1000, used: 50, completed: 50, remaining: 950 });
  const available = html.match(/data-tone="available"[\s\S]*?<small>/)?.[0] || "";
  assert.ok(available.includes("<strong>950</strong>"));
  assert.ok(html.includes('aria-valuetext="950 of 1000 reactions available today"'));
});

test("customer summary keeps its progress block and countdown without the repeated allowance paragraphs", () => {
  const html = render({ limit: 100, used: 0, completed: 0, remaining: 100, description: "Duplicate allowance description", resetsAt: "2099-01-01T21:00:00Z" });
  assert.equal(html.includes("Duplicate allowance description"), false);
  assert.ok(html.includes('class="monitor-reaction-overview"'));
  assert.equal(html.includes("0 of 100 reactions delivered"), false);
  assert.ok(html.includes("Daily reactions"));
  assert.ok(html.includes('aria-label="Reaction delivery summary"'));
  assert.ok(html.includes('class="reaction-reset-countdown"'));
  assert.ok(html.includes('aria-label="Daily reactions remaining"'));
  assert.equal((html.match(/class="reaction-reset-countdown"/g) || []).length, 1);
  const workspace = render({ collapsible: false, limit: 100, completed: 0, remaining: 100 });
  assert.ok(workspace.includes('class="monitor-reaction-overview"'), "the full admin workspace keeps its overview");
});
