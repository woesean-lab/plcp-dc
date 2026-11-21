import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

function load(path, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => name === "react/jsx-runtime" ? jsxRuntime : dependencies[name] });
  return exports;
}
const state = load("../src/lib/humanizer-job-state.ts");
const base = { id: "run", status: "running", completed: 1, total: 4, succeeded: 1, failed: 0, results: [], skipped: [] };

test("delayed polling cannot resurrect stopped/failed runs, undo a stop or reduce progress", () => {
  for (const status of ["stopped", "completed", "failed"]) {
    const current = { ...base, status };
    assert.equal(state.mergeHumanizerJob(current, base), current);
  }
  const stopping = { ...base, status: "stopping", stopRequestedAt: "now" };
  assert.equal(state.mergeHumanizerJob(stopping, base), stopping);
  assert.equal(state.isHumanizerJobActive(stopping), true);
  const advanced = { ...base, completed: 3 };
  assert.equal(state.mergeHumanizerJob(advanced, base), advanced);
  const stopped = { ...stopping, status: "stopped" };
  assert.equal(state.mergeHumanizerJob(stopping, stopped), stopped);
});

const icons = new Proxy({}, { get: () => () => null });
const { HumanizerRunHeader } = load("../src/components/HumanizerRunHeader.tsx", { "lucide-react": icons, "./ui/button": { Button: (props) => React.createElement("button", props, props.children) }, "../lib/humanizer-job-state": state });
const render = (job, stopping = false) => renderToStaticMarkup(React.createElement(HumanizerRunHeader, { job, stopping, onStop() {} }));

test("header distinguishes failed, stopped and completed runs and only enables stop while running", () => {
  assert.match(render(base), /Stop run/);
  assert.match(render({ ...base, status: "stopping" }), /disabled=""/);
  assert.match(render({ ...base, status: "stopped", cancelled: 3 }), /Run stopped/);
  assert.match(render({ ...base, status: "stopped", cancelled: 3 }), /3 not started/);
  assert.match(render({ ...base, status: "failed", failed: 0 }), /Run failed/);
  assert.doesNotMatch(render({ ...base, status: "failed", failed: 0 }), /All updates complete/);
  assert.doesNotMatch(render({ ...base, status: "completed" }), /Stop run/);
  assert.doesNotMatch(render({ ...base, canStop: false }), /Stop run/);
});
