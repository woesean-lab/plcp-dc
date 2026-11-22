import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const output = await build({
  stdin: { contents: 'export { default as SettingsWorkspace } from "./src/components/SettingsWorkspace.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" },
  bundle: true, write: false, jsx: "automatic", format: "cjs", platform: "node", packages: "external", loader: { ".css": "empty" }, logLevel: "silent"
});
const module = { exports: {} };
new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const noop = () => {};
const config = { configured: true, stored: true, clientId: "123456789012345678", guildId: "234567890123456789", hasClientSecret: true, hasBotToken: true, guildName: "Sample server", activeGuildCount: 1, activeGuildCountExact: true, serverLimit: 100 };
function render(overrides = {}) {
  const props = {
    loading: false, onRefresh: noop,
    members: { config, draft: { clientId: config.clientId, guildId: config.guildId, clientSecret: "", botToken: "" }, saving: false, onDraftChange: noop, onSave: noop, onRemove: noop },
    dcord: { configured: true, draft: "", saving: false, onDraftChange: noop, onSave: noop, onRemove: noop },
    guilds: { items: [], loading: false, leaving: false, selected: {}, onSelectionChange: noop, onOpen: noop, onRefresh: noop, onLeave: noop, progress: null },
    account: { draft: { accountToken: "", guildId: "" }, leaving: false, onDraftChange: noop, onSubmit: noop }
  };
  for (const [key, value] of Object.entries(overrides)) props[key] = typeof value === "object" ? { ...props[key], ...value } : value;
  return renderToStaticMarkup(React.createElement(module.exports.SettingsWorkspace, props));
}
function form(html, label) {
  return html.match(new RegExp(`<form[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</form>`))[1];
}
const submitDisabled = html => /<button[^>]*type="submit"[^>]*disabled=""/.test(html);

test("saved Members secrets can remain blank while IDs are updated", () => {
  const html = form(render(), "Members bot settings");
  assert.equal(submitDisabled(html), false);
  assert.equal((html.match(/type="password"/g) || []).length, 2);
  assert.equal((html.match(/placeholder="Keep saved value"/g) || []).length, 2);
  assert.equal((html.match(/type="password"[^>]*value=""/g) || []).length, 2);
});

test("a new Members connection requires both credentials before saving", () => {
  const unsaved = { ...config, configured: false, stored: false, hasClientSecret: false, hasBotToken: false };
  for (const secrets of [{ clientSecret: "", botToken: "" }, { clientSecret: "sample-secret", botToken: "" }, { clientSecret: "", botToken: "sample-token" }]) {
    assert.equal(submitDisabled(form(render({ members: { config: unsaved, draft: { clientId: config.clientId, guildId: "", ...secrets } } }), "Members bot settings")), true);
  }
  assert.equal(submitDisabled(form(render({ members: { config: unsaved, draft: { clientId: config.clientId, guildId: "", clientSecret: "sample-secret", botToken: "sample-token" } } }), "Members bot settings")), false);
});

test("saving Dcord does not lock Members, while bot departure locks Members changes", () => {
  const savingKey = render({ dcord: { draft: "replacement", saving: true } });
  assert.equal(submitDisabled(form(savingKey, "Dcord settings")), true);
  assert.equal(submitDisabled(form(savingKey, "Members bot settings")), false);
  const leaving = form(render({ guilds: { leaving: true } }), "Members bot settings");
  assert.equal(submitDisabled(leaving), true);
  assert.equal((leaving.match(/<input[^>]*disabled=""/g) || []).length, 4);
});

test("account removal needs both fields and stays locked during removal", () => {
  assert.equal(submitDisabled(form(render(), "Leave a Discord server")), true);
  const draft = { accountToken: "sample-token", guildId: config.guildId };
  assert.equal(submitDisabled(form(render({ account: { draft } }), "Leave a Discord server")), false);
  assert.equal(submitDisabled(form(render({ account: { draft, leaving: true } }), "Leave a Discord server")), true);
});

test("failed server reads show a retry rather than claim the bot has no servers", () => {
  const html = render({ guilds: { error: "Server list unavailable." } });
  assert.ok(html.includes("Server list unavailable."));
  assert.ok(html.includes("Retry"));
  assert.equal(html.includes("No servers found"), false);
});
