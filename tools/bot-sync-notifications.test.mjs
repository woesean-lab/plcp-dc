import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const stateScope = { exports: {} };
vm.runInNewContext(compile("../src/lib/bot-sync-state.ts"), stateScope);
const code = compile("../src/components/BotSyncNotifications.tsx");
const job = patch => ({ id: "karpuz", clientId: "123456789012345678", botName: "Karpuz", status: "running", total: 100, processed: 20, succeeded: 18, failed: 2, errors: [], updatedAt: "2026-11-26T09:00:00Z", ...patch });

function fixture(initial, storage = new Map()) {
  const slots = [], effects = [], timers = new Map(), listeners = new Map(), notices = [], dismissals = [];
  let cursor = 0, dirty = true, tree, latest = initial, failure = false, timerId = 0;
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
  const toast = Object.assign((content, options) => notices.push({ type: "default", content, options }), Object.fromEntries(["loading", "success", "error"].map(type => [type, (content, options) => notices.push({ type, content, options })])), { dismiss: id => dismissals.push(id) });
  const dependencies = {
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; dirty = true; }]; },
      useEffect(fn, deps) { const index = cursor++; const previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; }); }
    },
    "react/jsx-runtime": jsx, "react-dom": { createPortal() { throw Error("Observer must not open a portal"); } },
    "react-router-dom": { Link: "a" }, "react-hot-toast": { default: toast },
    "lucide-react": Object.fromEntries(["Pause", "Square", "ChevronUp", "CheckCircle2", "LoaderCircle"].map(name => [name, "svg"])),
    "./ui/button": { Button: "button" }, "../lib/bot-sync-state": stateScope.exports,
    "../lib/community": { getBotSyncNotifications: async () => { if (failure) throw Error("offline"); return latest; } }
  };
  const events = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const scope = { exports: {}, AbortController, window: { ...events, localStorage }, document: { ...events, visibilityState: "visible" }, setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id), require: name => { if (name.endsWith(".css")) return {}; assert.ok(name in dependencies, name); return dependencies[name]; } };
  vm.runInNewContext(code, scope);
  async function flush() { for (let i = 0; i < 10; i++) { if (dirty) { cursor = 0; dirty = false; tree = scope.exports.BotSyncNotifications(); effects.splice(0).forEach(fn => fn()); } await new Promise(resolve => setImmediate(resolve)); if (!dirty) break; } }
  return { flush, notices, dismissals, storage, get items() { return tree.props.items; },
    setLatest(value) { latest = value; }, setOffline(value) { failure = value; },
    async event(value) { listeners.get("community-bot-sync-change")({ detail: value }); await flush(); },
    async tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.fn(); await flush(); },
    stop() { slots.forEach(slot => slot?.cleanup?.()); }
  };
}

test("multiple active jobs restore into one compact control without persistent toasts", async () => {
  const f = fixture([job(), job({ id: "seftali", botName: "Şeftali" })]); await f.flush();
  assert.equal(f.items.length, 2);
  assert.equal(f.notices.length, 0);
  await f.event(job({ processed: 40, succeeded: 38 }));
  assert.equal(f.items.find(item => item.job.id === "karpuz").job.processed, 40);
  assert.equal(f.notices.length, 0);
  f.stop();
});

test("completion notifies once, remains accessible after reload, and ignores delayed active events", async () => {
  const f = fixture([job()]); await f.flush();
  const completed = job({ status: "completed", processed: 100, succeeded: 98 });
  f.setLatest([completed]); await f.tick();
  assert.equal(f.notices.length, 1);
  assert.equal(typeof f.notices[0].content, "string");
  assert.equal(f.notices[0].options.duration, 6000);
  await f.event(job({ processed: 70 }));
  assert.equal(f.items[0].job.status, "completed");
  await f.tick(); assert.equal(f.notices.length, 1);
  const storage = f.storage; f.stop();
  const reopened = fixture([completed], storage); await reopened.flush();
  assert.equal(reopened.items[0].job.status, "completed");
  assert.equal(reopened.notices.length, 0);
  reopened.stop();
});

test("lost observation retains last progress and marks reconnecting without toast stacks", async () => {
  const f = fixture([job()]); await f.flush();
  f.setOffline(true); await f.tick();
  assert.equal(f.items[0].job.processed, 20);
  assert.equal(f.items[0].stale, true);
  assert.equal(f.notices.length, 0);
  f.setOffline(false); f.setLatest([job({ processed: 30, succeeded: 28 })]); await f.tick();
  assert.equal(f.items[0].job.processed, 30);
  assert.equal(f.items[0].stale, false);
  f.setLatest([]); await f.tick(); assert.equal(f.items.length, 0);
  f.stop();
});
