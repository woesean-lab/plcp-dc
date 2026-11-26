import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const source = ts.transpileModule(fs.readFileSync(new URL("../src/pages/LoginPage.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(state = null) {
  const slots = [], calls = [], destinations = [];
  let index = 0, tree, authenticated = 0, request = async () => false;
  const dependencies = {
    react: { useState(initial) { const key = index++; if (!(key in slots)) slots[key] = initial; return [slots[key], value => { slots[key] = value; }]; }, useRef(initial) { const key = index++; return slots[key] ||= { current: initial }; } },
    "react/jsx-runtime": jsx,
    "react-router-dom": { Link: "a", useLocation: () => ({ state }), useNavigate: () => (path, options) => destinations.push({ path, options }) },
    "lucide-react": { ArrowLeft: "svg", LockKeyhole: "svg" }, "react-hot-toast": { default: { success() {} } },
    "../components/ConsoleLoginCard": { ConsoleLoginCard: "card" },
    "../lib/session-auth": { signIn: async (...args) => { calls.push(args); return request(...args); } }
  };
  const scope = { exports: {}, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } };
  vm.runInNewContext(source, scope);
  const find = node => !node ? null : Array.isArray(node) ? node.map(find).find(Boolean) : node.type === "card" ? node.props : find(node.props?.children);
  const render = () => { index = 0; tree = scope.exports.default({ onAuthenticated: () => authenticated++ }); return find(tree); };
  render();
  return { calls, destinations, render, behavior: fn => { request = fn; }, get authenticated() { return authenticated; },
    fill() { const card = render(); card.onUsernameChange("preview"); card.onPasswordChange("preview-only"); },
    submit() { return render().onSubmit({ preventDefault() {} }); }
  };
}

test("pending sign-in deduplicates submissions and invalid credentials stay on the form", async () => {
  const f = fixture(); f.fill(); let finish;
  f.behavior(() => new Promise(resolve => { finish = resolve; }));
  const first = f.submit(), second = f.submit();
  assert.equal(f.calls.length, 1); assert.equal(f.render().loading, true);
  finish(false); await Promise.all([first, second]);
  assert.equal(f.render().loading, false); assert.equal(f.render().error, "Username or password is incorrect.");
  assert.equal(f.authenticated, 0); assert.equal(f.destinations.length, 0);
  f.behavior(async () => true); await f.submit();
  assert.equal(f.authenticated, 1); assert.equal(f.destinations[0].path, "/console?tab=create");
});

test("successful sign-in returns to the protected destination and network failures do not leak details", async () => {
  const f = fixture({ from: { pathname: "/orders", search: "?id=sample" } }); f.fill();
  f.behavior(async () => { throw Error("private network diagnostic"); });
  await f.submit(); assert.equal(f.render().error, "Could not connect. Please try again.");
  assert.equal(f.render().loading, false); assert.equal(f.destinations.length, 0);
  f.behavior(async () => true); await f.submit();
  assert.equal(f.destinations[0].path, "/orders?id=sample"); assert.equal(f.destinations[0].options.replace, true);
  assert.equal(f.render().error, "");
});
