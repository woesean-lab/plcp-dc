import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/components/BotPoolSettings.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("BotPoolSettings.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let action, pollEffect, proxyOpen, proxySave;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "connectOnliner") action = node.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "openProxies") proxyOpen = node.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "saveProxies") proxySave = node.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("getBotOnlinerProfiles")) pollEffect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const js = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const bot = { clientId: "selected", name: "Selected", hasBotToken: true };
const profile = { clientId: bot.clientId, accountId: "saved-profile", connectionState: "connected", lastError: null };

function fixture(profiles = []) {
  const calls = [], notices = [];
  const scope = {
    Error,
    preview: false, disabled: false, loading: false, onlinerProfiles: profiles,
    pending: { current: false }, mounted: { current: true }, onlinerVersion: { current: 0 },
    setBusy() {}, setConnectingBotId() {}, setError: value => { scope.error = value; },
    setOnlinerProfiles: value => { scope.onlinerProfiles = typeof value === "function" ? value(scope.onlinerProfiles) : value; },
    setOnlinerError: value => { scope.onlinerError = value; }, setOnlinerAvailable: value => { scope.available = value; },
    toast: { success: value => notices.push(value) },
    connectBotToOnliner: async id => { calls.push(["connect", id]); return { accountId: profile.accountId, onlinerEnabled: true }; },
    disconnectBotFromOnliner: async id => { calls.push(["disconnect", id]); },
    proxyDraft: "", proxyLoading: false, proxyLoadFailed: false,
    setProxyEditor: value => { scope.proxyEditor = value; }, setProxyLoading: value => { scope.proxyLoading = value; },
    setProxyError: value => { scope.proxyError = value; }, setProxyLoadFailed: value => { scope.proxyLoadFailed = value; },
    setProxyDraft: value => { scope.proxyDraft = value; },
    getBotOnlinerProxies: async () => ({ proxies: [] }), saveBotOnlinerProxies: async value => { calls.push(["save-proxies", value]); },
    AbortController, window: { setInterval: (callback, interval) => { scope.tick = callback; assert.equal(interval, 3000); return 1; }, clearInterval() {} }
  };
  vm.runInNewContext(js(action), scope);
  vm.runInNewContext(js(proxyOpen + "\n" + proxySave), scope);
  vm.runInNewContext(js("this.startPolling = " + pollEffect), scope);
  return { scope, calls, notices };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("connect requests only the selected bot, stays Starting until polling and rejects duplicate clicks", async () => {
  const f = fixture(), request = deferred();
  f.scope.connectBotToOnliner = async id => { f.calls.push(["connect", id]); return request.promise; };
  const pending = f.scope.connectOnliner(bot);
  await f.scope.connectOnliner(bot);
  assert.equal(f.calls.length, 1);
  request.resolve({ accountId: profile.accountId, onlinerEnabled: true });
  await pending;
  assert.equal(f.scope.onlinerProfiles[0].connectionState, "connecting");
  assert.equal(f.scope.pending.current, false);
});

test("bot proxy load failures cannot overwrite the pool; failed saves preserve editable values", async () => {
  const f = fixture();
  f.scope.getBotOnlinerProxies = async () => { throw Error("Cannot load proxies"); };
  await f.scope.openProxies();
  assert.equal(f.scope.proxyLoadFailed, true);
  await f.scope.saveProxies(); assert.equal(f.calls.length, 0);
  f.scope.getBotOnlinerProxies = async () => ({ proxies: ["http://one:8080/"] });
  await f.scope.openProxies(); assert.equal(f.scope.proxyDraft, "http://one:8080/");
  f.scope.saveBotOnlinerProxies = async () => { throw Error("Invalid proxy on line 1"); };
  await f.scope.saveProxies();
  assert.equal(f.scope.proxyEditor, true); assert.equal(f.scope.proxyDraft, "http://one:8080/");
  f.scope.proxyDraft = "http://corrected:8080/";
  f.scope.saveBotOnlinerProxies = async value => { f.calls.push(["saved", value]); };
  await f.scope.saveProxies(); assert.equal(f.scope.proxyEditor, false);
  assert.deepEqual(f.calls, [["saved", "http://corrected:8080/"]]);
});

test("power action uses the bot-only removal API, preserves other profiles and permits reconnect", async () => {
  const other = { ...profile, clientId: "other", accountId: "other-profile" };
  const f = fixture([profile, other]);
  // Removing an already saved profile does not require current bot credentials.
  await f.scope.connectOnliner({ ...bot, hasBotToken: false });
  assert.deepEqual(f.calls, [["disconnect", bot.clientId]]);
  assert.deepEqual(Array.from(f.scope.onlinerProfiles), [other]);
  await f.scope.connectOnliner(bot);
  assert.deepEqual(f.calls[1], ["connect", bot.clientId]);
});

test("failed disconnect keeps the power action and saved profile available for retry", async () => {
  const f = fixture([profile]);
  f.scope.disconnectBotFromOnliner = async () => { throw Error("Connection unavailable"); };
  await f.scope.connectOnliner(bot);
  assert.equal(f.scope.error, "Connection unavailable");
  assert.equal(f.scope.onlinerProfiles[0], profile);
  assert.equal(f.scope.pending.current, false);
});

test("polling publishes runtime states, suppresses overlapping requests and cannot restore a disconnected profile", async () => {
  const f = fixture([profile]), request = deferred();
  let count = 0;
  f.scope.getBotOnlinerProfiles = async () => { count++; return request.promise; };
  const cleanup = f.scope.startPolling();
  f.scope.tick(); f.scope.tick();
  assert.equal(count, 1);
  await f.scope.connectOnliner(bot);
  request.resolve({ bots: [profile] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.scope.onlinerProfiles.length, 0);
  f.scope.getBotOnlinerProfiles = async () => ({ bots: [{ ...profile, connectionState: "error", lastError: "Rejected token" }] });
  f.scope.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.scope.onlinerProfiles[0].lastError, "Rejected token");
  cleanup();
});

test("poll errors mark stale Live status unavailable, recover automatically and abort on unmount", async () => {
  const f = fixture([profile]);
  let signal;
  f.scope.getBotOnlinerProfiles = async value => { signal = value; throw Error("Offline"); };
  const cleanup = f.scope.startPolling();
  f.scope.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.scope.available, false);
  assert.ok(f.scope.onlinerError);
  f.scope.getBotOnlinerProfiles = async () => ({ bots: [profile] });
  f.scope.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.scope.available, true);
  assert.equal(f.scope.onlinerError, "");
  cleanup();
  assert.equal(signal.aborted, true);
});
