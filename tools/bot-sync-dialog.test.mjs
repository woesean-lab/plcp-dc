import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const state = { exports: {} }; vm.runInNewContext(compile("../src/lib/bot-sync-state.ts"), state);
const code = compile("../src/components/BotSyncDialog.tsx");
const base = patch => ({ id: "job", clientId: "123456789012345678", categoryId: "online", categoryName: "OAuth Online", status: "running", total: 100, processed: 10, succeeded: 8, failed: 2, errors: [], ...patch });
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
function nodes(node, type) { return !node ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, type)) : typeof node === "object" && node.props ? [...(node.type === type ? [node] : []), ...nodes(node.props.children, type)] : []; }
function fixture(initial = base()) {
  const slots = [], effects = [], timers = new Map(), commands = [], notices = [];
  let cursor = 0, dirty = true, mounted = true, tree, serverJob = initial, queuedRead, nextTimer = 0, closes = 0, changes = 0;
  const dependencies = {
    react: {
      useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial; return [slots[id], value => { slots[id] = typeof value === "function" ? value(slots[id]) : value; dirty = true; }]; },
      useRef(value) { const id = cursor++; if (!(id in slots)) slots[id] = { current: value }; return slots[id]; },
      useEffect(fn, deps) { const id = cursor++; const previous = slots[id]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) { effects.push(() => { previous?.cleanup?.(); slots[id] = { deps, cleanup: fn() }; }); } }
    },
    "react/jsx-runtime": jsx, "lucide-react": { LoaderCircle: "svg", Play: "svg", RefreshCw: "svg", Square: "svg" },
    "./BotSettingsDialog": { BotSettingsDialog: "dialog" }, "./BotSyncProgress": { BotSyncProgress: "progress" }, "./ui/button": { Button: "button" }, "./ui/skeleton": { Skeleton: "skeleton" }, "./ui/filter-dropdown": { FilterDropdown: "select" },
    "./BotSyncNotifications": { notifyBotSyncChange: value => notices.push(value), showBotSyncToast() {} },
    "../lib/bot-sync-state": state.exports,
    "../lib/community": {
      getBotSyncCategories: async () => [{ id: "online", name: "OAuth Online" }, { id: "new", name: "New" }],
      getBotSyncJob: async () => { if (queuedRead) { const read = queuedRead; queuedRead = null; return read; } return serverJob; },
      getBotSyncPreview: async () => ({ totalAccounts: 100, upToDate: 8, pending: 92, unavailable: 0 }),
      controlBotSync: async (id, action) => { commands.push({ action }); serverJob = base({ status: action === "cancel" ? "cancelled" : "queued", stopping: action === "cancel" }); return serverJob; },
      startBotSync: async (id, retry, categoryId) => { commands.push({ action: "start", retry, categoryId }); return base({ status: "queued", categoryId, processed: 0, succeeded: 0, failed: 0 }); }
    }
  };
  const scope = { exports: {}, AbortController, Error, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; }, setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(code, scope);
  function render() { cursor = 0; dirty = false; tree = scope.exports.BotSyncDialog({ clientId: "123456789012345678", name: "Bot", onClose: () => closes++, onChanged: () => changes++ }); const pending = effects.splice(0); pending.forEach(fn => fn()); }
  async function flush() { for (let i = 0; i < 8; i++) { if (dirty && mounted) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) break; } }
  return { commands, notices, timers, flush, setServer: value => { serverJob = value; }, queueRead: value => { queuedRead = value; },
    get tree() { return tree; }, get progress() { return nodes(tree, "progress")[0]?.props.job; }, get closes() { return closes; }, get changes() { return changes; },
    button(label) { const result = nodes(tree, "button").find(node => text(node) === label || node.props["aria-label"] === label); assert.ok(result, `Missing ${label}`); return result.props; },
    select(value) { nodes(tree, "select")[0].props.onChange(value); },
    async tick() { assert.ok(timers.size); const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); await flush(); },
    stop() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); }
  };
}

test("Close does not send Stop, and Escape cancels the stop confirmation before closing the modal", async () => {
  const f = fixture(); await f.flush();
  f.button("Stop").onClick(); await f.flush();
  assert.equal(f.commands.length, 0);
  f.tree.props.onCancel(); await f.flush();
  assert.equal(f.closes, 0); assert.ok(f.button("Stop"));
  f.button("Close").onClick(); assert.equal(f.closes, 1); assert.equal(f.commands.length, 0);
  f.stop();
});

test("Stop ignores a late running poll and keeps polling the in-flight result until settled", async () => {
  const f = fixture(); await f.flush();
  let release;
  f.queueRead(new Promise(resolve => { release = resolve; }));
  await f.tick();
  f.button("Stop").onClick(); await f.flush(); f.button("Stop sync").onClick(); await f.flush();
  assert.equal(f.progress.status, "cancelled"); assert.equal(f.progress.stopping, true);
  assert.equal(f.button("Stopping…").disabled, true);
  release(base({ processed: 11, succeeded: 9 })); await f.flush();
  assert.equal(f.progress.status, "cancelled");
  f.setServer(base({ status: "cancelled", stopping: false, processed: 11, succeeded: 9 }));
  await f.tick();
  assert.equal(f.progress.stopping, false); assert.equal(f.progress.processed, 11);
  assert.equal(f.changes, 1); assert.equal(f.closes, 0);
  f.stop();
});

test("completed results follow their category and Sync submits the selected scope once", async () => {
  const f = fixture(base({ status: "completed", categoryId: "new", categoryName: "New" })); await f.flush();
  assert.equal(f.progress, undefined);
  f.select("new"); await f.flush(); assert.equal(f.progress.categoryId, "new");
  f.select("online"); await f.flush(); assert.equal(f.progress, undefined);
  const click = f.button("Sync").onClick; click(); click(); await f.flush();
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].categoryId, "online"); assert.equal(f.commands[0].retry, false);
  assert.equal(f.closes, 1); assert.equal(f.notices.length, 1);
  f.stop();
});

test("stale snapshots cannot undo terminal jobs, lower counters or conflate verification with authentication", () => {
  const stopped = base({ status: "cancelled", stopping: true });
  assert.equal(state.exports.mergeBotSyncJob(stopped, base()), stopped);
  assert.equal(state.exports.mergeBotSyncJob(base(), base({ processed: 9 } )).processed, 10);
  assert.equal(state.exports.describeBotSyncError("You need to verify your account in order to perform this action.").type, "verification");
  assert.equal(state.exports.describeBotSyncError("Gateway session fallback closed before READY (code 4004).").type, "credentials");
  assert.equal(state.exports.describeBotSyncError("Gateway session fallback timed out.").type, "connection");
  assert.equal(state.exports.formatBotSyncEta(5400), "1h 30m");
});

test("Resume and Retry failed send their distinct server commands in the saved category", async () => {
  const paused = fixture(base({ status: "paused" })); await paused.flush();
  paused.button("Resume").onClick(); await paused.flush();
  assert.equal(paused.commands[0].action, "resume"); assert.equal(paused.closes, 1); paused.stop();
  const failed = fixture(base({ status: "completed" })); await failed.flush();
  failed.select("online"); await failed.flush();
  failed.button("Retry failed (2)").onClick(); await failed.flush();
  assert.equal(failed.commands[0].retry, true); assert.equal(failed.commands[0].categoryId, "online"); assert.equal(failed.closes, 1); failed.stop();
});

test("poll failures preserve progress and Refresh status only reads the job", async () => {
  const f = fixture(); await f.flush();
  f.queueRead(Promise.reject(Error("Progress temporarily unavailable")));
  await f.tick();
  assert.equal(f.progress.processed, 10);
  assert.ok(text(f.tree).includes("Progress temporarily unavailable"));
  f.button("Refresh status").onClick(); await f.flush();
  assert.equal(f.progress.processed, 10); assert.equal(f.commands.length, 0);
  f.stop();
});
