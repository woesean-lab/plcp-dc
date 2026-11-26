import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const code = ts.transpileModule(fs.readFileSync(new URL("../src/components/BotSyncNotifications.tsx", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = node => !node ? [] : Array.isArray(node) ? node.flatMap(nodes) : typeof node === "object" && node.props ? [node, ...nodes(node.props.children)] : [];
function fixture() {
  const slots = [], effects = [], timers = new Map();
  let cursor = 0, dirty = true, tree, clock = 0, nextTimer = 0;
  const document = { body: {}, activeElement: null, addEventListener() {}, removeEventListener() {} };
  const dependencies = {
    react: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { const value = typeof next === "function" ? next(slots[index]) : next; if (value !== slots[index]) { slots[index] = value; dirty = true; } }]; },
      useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useId() { cursor++; return "sync-center-test"; },
      useEffect: effect, useLayoutEffect: effect
    },
    "react/jsx-runtime": jsx, "react-dom": { createPortal: node => node }, "react-router-dom": { Link: "a" },
    "react-hot-toast": { default() {} }, "./ui/button": { Button: "button" },
    "lucide-react": Object.fromEntries(["Pause", "Square", "ChevronUp", "CheckCircle2", "LoaderCircle"].map(name => [name, "svg"])),
    "../lib/bot-sync-state": {}, "../lib/community": {}
  };
  function effect(fn, deps) { const index = cursor++; const previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; }); }
  const scope = { exports: {}, document, window: { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} }, setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, due: clock + delay }); return nextTimer; }, clearTimeout: id => timers.delete(id), require: name => name.endsWith(".css") ? {} : dependencies[name] };
  vm.runInNewContext(code, scope);
  function assign(node, parent) {
    if (Array.isArray(node)) { node.forEach(child => assign(child, parent)); return; }
    if (!node?.props) return;
    let owner = parent;
    if (node.ref && typeof node.ref === "object") {
      owner = node.ref.current ||= { owner: parent, getBoundingClientRect: () => ({ left: 900, right: 932, bottom: 40 }), matches: () => true,
        contains(other) { for (let item = other; item; item = item.owner) if (item === this) return true; return false; },
        focus() { document.activeElement = this; this.props.onFocus?.({ currentTarget: this }); }
      };
      owner.props = node.props;
    }
    assign(node.props.children, owner);
  }
  const items = [{ job: { id: "job", botName: "Karpuz", status: "running", total: 100, processed: 40, updatedAt: "2026-11-26T09:00:00Z" } }];
  async function flush() { for (let i = 0; dirty && i < 15; i++) { cursor = 0; dirty = false; tree = scope.exports.BotSyncCenter({ items, preview: true }); assign(tree); effects.splice(0).forEach(fn => fn()); } }
  const find = predicate => nodes(tree).find(predicate);
  return { flush, document,
    get trigger() { return find(node => node.props["aria-haspopup"] === "dialog"); },
    get panel() { return find(node => node.props.role === "dialog"); },
    get collapse() { return find(node => node.props["aria-label"] === "Collapse sync progress"); },
    async advance(ms) { clock += ms; for (let entry; (entry = [...timers].filter(([, value]) => value.due <= clock).sort((a, b) => a[1].due - b[1].due)[0]);) { timers.delete(entry[0]); entry[1].fn(); await flush(); } },
    stop() { slots.forEach(slot => slot?.cleanup?.()); }
  };
}

test("hover opens an icon-only control, tolerates crossing the gap, and animates closed after leaving", async () => {
  const f = fixture(); await f.flush();
  assert.equal(f.trigger.props.size, "icon-sm");
  assert.equal(f.trigger.props.title, undefined);
  f.trigger.props.onPointerEnter({ pointerType: "mouse" }); await f.flush();
  assert.equal(f.panel.props["data-state"], "open");
  assert.equal(f.document.activeElement, null, "hover must not steal keyboard focus");
  f.trigger.props.onPointerLeave({ pointerType: "mouse" }); await f.advance(100);
  f.panel.props.onPointerEnter({ pointerType: "mouse" }); await f.flush(); await f.advance(200);
  assert.equal(f.panel.props["data-state"], "open");
  f.panel.props.onPointerLeave({ pointerType: "mouse" }); await f.advance(160);
  assert.equal(f.panel.props["data-state"], "closed");
  assert.equal(f.trigger.props["aria-expanded"], false);
  await f.advance(140); assert.equal(f.panel, undefined);
  f.stop();
});

test("touch toggles without hover, and keyboard Escape returns focus without reopening", async () => {
  const f = fixture(); await f.flush();
  f.trigger.props.onPointerEnter({ pointerType: "touch" }); await f.flush(); assert.equal(f.panel, undefined);
  f.trigger.props.onPointerDown({ pointerType: "touch" }); f.trigger.props.onClick({ detail: 1 }); await f.flush();
  f.trigger.props.onPointerLeave({ pointerType: "touch" }); await f.advance(400); assert.equal(f.panel.props["data-state"], "open");
  f.trigger.props.onClick({ detail: 1 }); await f.flush(); await f.advance(140); assert.equal(f.panel, undefined);
  f.trigger.props.onKeyDown({ key: "ArrowDown", preventDefault() {} }); await f.flush();
  assert.equal(f.document.activeElement, f.collapse.ref.current);
  f.panel.props.onKeyDown({ key: "Escape", preventDefault() {}, stopPropagation() {} }); await f.flush(); await f.advance(140);
  assert.equal(f.panel, undefined);
  assert.equal(f.document.activeElement, f.trigger.ref.current);
  assert.equal(f.trigger.props["aria-expanded"], false);
  f.stop();
});
