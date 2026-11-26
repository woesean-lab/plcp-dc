import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const output = await build({ stdin: { contents: 'export { BotSyncProgress } from "./src/components/BotSyncProgress.tsx";', resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "tsx" }, bundle: true, write: false, jsx: "automatic", format: "cjs", platform: "node", packages: "external", loader: { ".css": "empty" }, logLevel: "silent" });
const module = { exports: {} }; new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const job = { id: "job", clientId: "123456789012345678", status: "running", total: 750, processed: 250, succeeded: 247, failed: 3, estimatedRemainingSeconds: 5400, errors: [{ userId: "123456789012345678", message: "Discord OAuth authorization failed (HTTP 403): You need to verify your account in order to perform this action." }, { userId: "123456789012345679", message: "Gateway session fallback closed before READY (code 4004)." }] };
const render = patch => renderToStaticMarkup(React.createElement(module.exports.BotSyncProgress, { job: { ...job, ...patch }, categoryName: "OAuth Online" }));
test("saved failures show readable categories, real counters, filters, copy controls and capped diagnostics", () => {
  const html = render();
  for (const value of ["1h 30m", "Verification required", "Authentication failed", "Search failed accounts", "Error type", "Copy IDs", "Copy account ID 123456789012345678", "Technical details", "Showing 2 saved details of 3 failures."]) assert.ok(html.includes(value), value);
  assert.match(html, /aria-valuenow="250"/);
});
test("Stopping and paused jobs never show a running countdown", () => {
  const stopping = render({ status: "cancelled", stopping: true });
  assert.ok(stopping.includes("Stopping after the current account"));
  assert.equal(stopping.includes("Est. remaining"), false);
  assert.equal(render({ status: "paused" }).includes("Est. remaining"), false);
});

test("connection details distinguish selected proxy endpoints, server refresh and unrecorded earlier jobs", () => {
  const route = { userId: "123456789012345681", mode: "authorization", transport: "proxy", source: "pool", endpoint: "203.0.113.24:8080", status: "running", updatedAt: "2026-11-26T02:00:00Z" };
  const html = render({ route, routes: [{ ...route, status: "succeeded" }] });
  for (const text of ["Connection route", "Current account", route.userId, route.endpoint, "Onliner proxy pool", "public exit IP is not measured", "Copy proxy address", "Recent routes", "Sync does not add accounts to Onliner"]) assert.ok(html.includes(text), text);
  const direct = render({ route: { ...route, mode: "refresh", transport: "server", source: "server", endpoint: null } });
  assert.ok(direct.includes("Direct server request")); assert.ok(!direct.includes("Copy proxy address"));
  const cached = render({ route: { ...route, mode: "reused", transport: "none", source: "none", endpoint: null } });
  assert.ok(cached.includes("No Discord request"));
  assert.ok(render().includes("Earlier requests were not recorded"));
});
