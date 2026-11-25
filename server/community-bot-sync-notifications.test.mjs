import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";

const source = fs.readFileSync(new URL("../src/components/BotSyncNotifications.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const job = (patch = {}) => ({ id: "persisted-job", clientId: "222222222222222222", botName: "Members 01", status: "running", total: 750, processed: 250, succeeded: 248, failed: 2, errors: [], updatedAt: "2026-11-25T12:00:00Z", ...patch });
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  let effect, cleanup, response = [job()], pending, serial = 0;
  const calls = [], dismissed = [], requests = [], timers = new Map();
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  class CustomEvent extends Event { constructor(name, init) { super(name); this.detail = init.detail; } }
  const toast = (content, options) => calls.push({ type: "blank", job: content.props.job, stale: content.props.stale, options });
  for (const type of ["success", "error", "loading"]) toast[type] = (content, options) => calls.push({ type, job: content.props.job, stale: content.props.stale, options });
  toast.dismiss = id => dismissed.push(id);
  const modules = {
    react: { useEffect: value => { effect = value; } },
    "react/jsx-runtime": jsxRuntime,
    "react-router-dom": { Link: "a" },
    "lucide-react": { Pause: "svg", Square: "svg" },
    "react-hot-toast": { __esModule: true, default: toast },
    "./ui/button": { Button: "button" },
    "../lib/community": { getBotSyncNotifications: async signal => { requests.push(signal); if (pending) return pending; if (response instanceof Error) throw response; return response; } },
    "./BotSyncNotifications.css": {}
  };
  const context = vm.createContext({ exports: {}, require: name => { assert.ok(name in modules, name); return modules[name]; }, window, document, CustomEvent, AbortController,
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(compiled, context);
  context.exports.BotSyncNotifications();
  cleanup = effect();
  return { calls, dismissed, requests, timers, api: context.exports,
    setResponse: next => { response = next; pending = undefined; }, setPending: next => { pending = next; },
    async tick() { assert.equal(timers.size, 1); const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); await flush(); },
    async event(name) { window.dispatchEvent(new Event(name)); await flush(); },
    stop: () => cleanup() };
}

test("reload restores server counts; unchanged polls remain quiet and progress/completion update one toast", async () => {
  const f = fixture(); await flush();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].job.processed, 250); assert.equal(f.calls[0].options.duration, Infinity);
  const id = f.calls[0].options.id;
  await f.tick(); assert.equal(f.calls.length, 1);
  f.setResponse([job({ processed: 300, succeeded: 298 })]); await f.tick();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].options.id, id); assert.equal(f.calls[1].job.processed, 300);
  f.setResponse([job({ status: "completed", processed: 750, succeeded: 748 })]); await f.tick();
  assert.equal(f.calls.at(-1).type, "error"); assert.equal(f.calls.at(-1).options.id, id); assert.equal(f.calls.at(-1).options.duration, 6000);
  const count = f.calls.length; await f.tick(); assert.equal(f.calls.length, count);
  f.stop(); assert.deepEqual(f.dismissed, [id]); assert.equal(f.timers.size, 0);
});

test("paused work and a success missed while closed restore correctly without restarting any job", async () => {
  const f = fixture(); f.setResponse([job({ status: "paused", details: "Wait before resuming." }), job({ id: "completed-job", clientId: "111111111111111111", status: "completed", failed: 0, processed: 750, succeeded: 750 })]);
  await flush(); await f.tick();
  const paused = f.calls.findLast(call => call.job.status === "paused");
  assert.equal(paused.type, "blank"); assert.equal(paused.options.duration, Infinity);
  const completed = f.calls.find(call => call.job.id === "completed-job"); assert.equal(completed.type, "success");
  f.stop();
});

test("failed observation preserves counts, shows one reconnecting state and recovers the same notification", async () => {
  const f = fixture(); await flush();
  f.setResponse(Error("Offline")); await f.tick();
  assert.equal(f.calls.at(-1).stale, true); assert.equal(f.calls.at(-1).job.processed, 250);
  const count = f.calls.length; await f.tick(); assert.equal(f.calls.length, count);
  f.setResponse([job({ processed: 280, succeeded: 278 })]); await f.tick();
  assert.equal(f.calls.at(-1).stale, false); assert.equal(f.calls.at(-1).job.processed, 280);
  assert.ok(f.calls.every(call => call.options.id === "bot-sync:persisted-job")); f.stop();
});

test("start/resume events update immediately and abort an older in-flight observation", async () => {
  const f = fixture(); await flush();
  let release;
  f.setPending(new Promise(resolve => { release = resolve; })); await f.tick();
  const request = f.requests.at(-1);
  f.api.notifyBotSyncChange(job({ status: "queued", processed: 275 }), "Renamed bot"); await flush();
  assert.equal(request.aborted, true); assert.equal(f.calls.at(-1).job.processed, 275); assert.equal(f.calls.at(-1).job.botName, "Renamed bot");
  const count = f.calls.length;
  release([job({ processed: 200 })]); await flush(); assert.equal(f.calls.length, count);
  f.setResponse([job({ processed: 290, succeeded: 288 })]); await f.tick(); assert.equal(f.calls.at(-1).job.processed, 290);
  f.stop();
});

test("sign-out cleanup aborts polling and prevents a late response from reopening private notifications", async () => {
  const f = fixture(); await flush();
  let release;
  f.setPending(new Promise(resolve => { release = resolve; })); await f.tick();
  const count = f.calls.length; f.stop();
  assert.equal(f.requests.at(-1).aborted, true); assert.equal(f.timers.size, 0);
  release([job({ status: "completed", processed: 750 })]); await flush(); assert.equal(f.calls.length, count);
  assert.deepEqual(f.dismissed, ["bot-sync:persisted-job"]);
});

test("obsolete jobs are dismissed when replaced and focus immediately refreshes current server state", async () => {
  const f = fixture(); await flush();
  f.setResponse([job({ id: "next-job", processed: 0, succeeded: 0, failed: 0 })]);
  await f.event("focus"); await f.tick();
  assert.ok(f.dismissed.includes("bot-sync:persisted-job")); assert.equal(f.calls.at(-1).options.id, "bot-sync:next-job");
  f.stop();
});
