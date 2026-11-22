import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/components/ReactionEmojiPickerLoader.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX
} }).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(importer) {
  const state = []; let index = 0; let effect; let cleanup; let mounted = false; let reloads = 0;
  const exports = {};
  vm.runInNewContext(code, { exports, window: { location: { reload() { reloads++; } } }, require(name) {
    if (name === "react") return {
      useState(initial) {
        const slot = index++;
        if (!(slot in state)) state[slot] = initial;
        return [state[slot], (next) => { state[slot] = typeof next === "function" ? next(state[slot]) : next; }];
      },
      useEffect(callback) { if (!mounted) effect = callback; }
    };
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "./ui/button") return { Button: ({ children, ...props }) => React.createElement("button", props, children) };
    if (name === "./VirtualReactionEmojiPicker") return importer();
    throw new Error(`Unexpected import: ${name}`);
  } });
  return {
    preload: exports.preloadReactionEmojiPicker,
    render(props = { selectedEmojis: ["😀"], onSelect() {} }) {
      index = 0;
      const element = exports.ReactionEmojiPickerLoader(props);
      if (!mounted) { mounted = true; cleanup = effect(); }
      return element;
    },
    unmount() { cleanup(); }, state, reloads: () => reloads
  };
}

test("failed hover/focus prefetch resolves without an unhandled rejection", async () => {
  let calls = 0;
  const view = fixture(() => { calls++; throw new TypeError("Failed to fetch dynamically imported module"); });
  await Promise.all([view.preload(), view.preload()]);
  assert.equal(calls, 1, "concurrent prefetches share one import");
  await view.preload();
  assert.equal(calls, 2, "a failed prefetch does not poison the shared promise");
});

test("failed catalog loading renders a local refresh action instead of throwing", async () => {
  const view = fixture(() => { throw new TypeError("HTML returned instead of JavaScript"); });
  assert.equal(view.render().props["aria-label"], "Loading emojis");
  await flush();
  const error = view.render();
  const html = renderToStaticMarkup(error);
  assert.match(html, /role="alert"/);
  assert.match(html, /Emojis could not be loaded/);
  assert.match(html, /Refresh page/);
  React.Children.toArray(error.props.children).at(-1).props.onClick();
  assert.equal(view.reloads(), 1);
});

test("successful prefetch reuses the catalog and preserves picker props", async () => {
  let calls = 0;
  function Picker() { return null; }
  const view = fixture(() => { calls++; return { default: Picker }; });
  await view.preload();
  view.render();
  await flush();
  const onSelect = () => {};
  const result = view.render({ selectedEmojis: ["🔥"], onSelect });
  assert.equal(calls, 1);
  assert.equal(result.type, Picker);
  assert.deepEqual(result.props.selectedEmojis, ["🔥"]);
  assert.equal(result.props.onSelect, onSelect);
});

test("closing the picker before a rejected load ignores the stale result", async () => {
  const view = fixture(() => { throw new Error("Network unavailable"); });
  view.render();
  view.unmount();
  await flush();
  assert.equal(view.state[1], false);
});
