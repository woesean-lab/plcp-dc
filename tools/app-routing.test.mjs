import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as router from "react-router-dom";

const source = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const module = { exports: {} };
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(code, { exports: module.exports, require(name) {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "react-router-dom") return router;
  return new Proxy({ default: () => null }, { get: (object, key) => object[key] ?? (() => null) });
} });
const tree = module.exports.default();
const routes = router.createRoutesFromChildren(React.Children.toArray(tree.props.children).find(child => child.type === router.Routes).props.children);
const matched = path => router.matchRoutes(routes, path).at(-1).route.element;

test("unknown addresses return to the public home without entering the authentication gate", () => {
  for (const path of ["/d", "/anything", "/manage/unknown", "/admin/unknown", "/orders/unknown", "/ui-kit/unknown", "/d?tab=settings"]) {
    const element = matched(path);
    assert.equal(element.type, router.Navigate, path);
    assert.equal(element.props.to, "/", path);
    assert.equal(element.props.replace, true, path);
  }
});

test("only explicit management addresses enter the protected gate", () => {
  for (const path of ["/manage", "/manage?tab=settings", "/manage/", "/admin", "/orders", "/humanizer", "/reactions", "/ui-kit"]) assert.equal(matched(path).type.name, "ProtectedGate", path);
});

test("public home and monitor routes remain public, including legacy monitor redirects", () => {
  for (const path of ["/", "/home", "/monitor", "/monitor/order-id", "/monitor/order-id/extra"]) {
    assert.notEqual(matched(path).type.name, "ProtectedGate", path);
    assert.notEqual(matched(path).type, router.Navigate, path);
  }
  assert.equal(matched("/public/order/order-id?test=1").type.name, "LegacyPublicOrderRedirect");
});

const server = ts.createSourceFile("index.mjs", fs.readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const guardCode = server.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "requireSession").getText(server);
test("the server guard rejects missing and expired sessions before any protected handler", async () => {
  let queries = 0, handlerCalls = 0;
  const context = { parseCookies: cookie => cookie ? { session: cookie } : {}, sessionCookie: "session", hashToken: value => `hashed:${value}`, pool: { query: async (sql, args) => { queries++; assert.ok(sql.includes("expires_at > NOW()")); assert.equal(args[0], "hashed:expired"); return { rowCount: 0 }; } } };
  vm.runInNewContext(guardCode + ";this.guard=requireSession", context);
  for (const cookie of [undefined, "expired"]) {
    let status;
    await context.guard({ headers: { cookie } }, { status(value) { status = value; return this; }, json() {} }, () => { handlerCalls++; });
    assert.equal(status, 401);
  }
  assert.equal(queries, 1); assert.equal(handlerCalls, 0);
});
