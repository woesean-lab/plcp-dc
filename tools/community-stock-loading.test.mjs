import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/pages/HomePage.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("HomePage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let found;
  function visit(node) { if (predicate(node)) found = node; else ts.forEachChild(node, visit); }
  visit(ast);
  assert.ok(found);
  return found;
}
const refresh = find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refreshCommunityStatus").getText(ast);
const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ rejectOnAbort = false } = {}) {
  const requests = [], timers = new Map(), errors = [];
  let timerId = 0;
  const state = {};
  const scope = {
    AbortController, Error,
    communityStockType: "offline",
    communityStatusRequestRef: { current: 0 }, communityStatusAbortRef: { current: null },
    window: { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } },
    getCommunityAdminStatus(categoryId, signal) {
      return new Promise((resolve, reject) => {
        requests.push({ categoryId, signal, resolve, reject });
        if (rejectOnAbort) signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    setCommunityStatusError: value => { state.error = value; },
    setLoadingCommunityStatus: value => { state.loading = value; },
    setCommunityStatus: value => { state.status = value; },
    setCommunityMembersCategory: value => { state.loaded = value; },
    setCommunityStockType: value => { state.category = value; },
    setCommunityAccessTokens: () => {},
    notifyError: value => errors.push(value)
  };
  vm.runInNewContext(transpile(`${refresh};this.refresh = refreshCommunityStatus;`), scope);
  return { scope, state, requests, timers, errors };
}

test("switching categories cancels the previous fetch and ignores a late old-category response", async () => {
  const f = fixture();
  const first = f.scope.refresh("online");
  const second = f.scope.refresh("offline");
  assert.equal(f.requests[0].signal.aborted, true);
  const status = { activeCategoryId: "offline", recent: [{ id: "offline-member" }] };
  f.requests[1].resolve(status);
  await second;
  f.requests[0].resolve({ activeCategoryId: "online", recent: [] });
  await first;
  assert.equal(f.state.status, status);
  assert.equal(f.state.loaded, "offline");
  assert.equal(f.state.category, "offline");
  assert.equal(f.state.loading, false);
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.errors, []);
});

test("a stalled fetch times out visibly and a retry loads the correct category", async () => {
  const f = fixture({ rejectOnAbort: true });
  const pending = f.scope.refresh();
  [...f.timers.values()][0]();
  await pending;
  assert.equal(f.state.loading, false);
  assert.match(f.state.error, /timed out.*retry/i);
  assert.equal(f.errors.length, 1);
  const retry = f.scope.refresh();
  f.requests[1].resolve({ activeCategoryId: "offline", recent: [{ id: "member" }] });
  await retry;
  assert.equal(f.state.error, "");
  assert.equal(f.state.loaded, "offline");
});

test("navigation aborts stay silent and a background poll cannot leave the loading button stuck", async () => {
  const f = fixture({ rejectOnAbort: true });
  const pending = f.scope.refresh();
  f.scope.communityStatusAbortRef.current.abort();
  f.scope.communityStatusRequestRef.current++;
  await pending;
  assert.deepEqual(f.errors, []);
  assert.equal(f.state.loading, false);
  const next = f.scope.refresh();
  f.scope.communityStatusRequestRef.current++;
  f.requests[1].resolve({ activeCategoryId: "offline", recent: [] });
  await next;
  assert.equal(f.state.loading, false);
});

test("summary-only counts and old-category members show loading until the selected list arrives", () => {
  const expression = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "communityMembersLoading").initializer.getText(ast);
  const scope = { communityStockType: "offline", communityStatus: { configured: true, authorized: 1051, recent: [] }, communityStatusError: "", communityMembersCategory: null };
  const evaluate = () => vm.runInNewContext(expression, scope);
  assert.equal(evaluate(), true);
  scope.communityMembersCategory = "online";
  assert.equal(evaluate(), true);
  scope.communityMembersCategory = "offline";
  assert.equal(evaluate(), false);
  scope.communityMembersCategory = null;
  scope.communityStatusError = "Request failed";
  assert.equal(evaluate(), false);
});
