import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

const compile = path => ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const code = compile("../src/components/SolarixWorkspace.tsx");
const stock = { checkedAt: "2026-11-26T09:00:00Z", tiers: [{ duration: "1m", label: "1 Month", tokens: 60, boosts: 120 }, { duration: "3m", label: "3 Months", tokens: 20, boosts: 40 }] };
const input = { invite: "sample", amount: 10, duration: "1m" };
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : "";
function nodes(node, type) { return !node ? [] : Array.isArray(node) ? node.flatMap(item => nodes(item, type)) : typeof node === "object" && node.props ? [...(node.type === type ? [node] : []), ...nodes(node.props.children, type)] : []; }
class SolarixRequestError extends Error { constructor(message, status) { super(message); this.status = status; } }
function fixture({ restore, configured = true, unavailable = false } = {}) {
  const slots = [], effects = [], timers = new Map(), submissions = [], reads = [], saved = new Map(restore ? [["solarix-aio:last-request", restore.id]] : []);
  let cursor = 0, dirty = true, mounted = true, tree, counter = 0, receipt = restore;
  const dependencies = {
    react: {
      createContext: () => ({ Provider: "context" }), useContext() {},
      useId() { cursor++; return "test"; },
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }]; },
      useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index]; },
      useEffect(fn, deps) { const index = cursor++; const previous = slots[index]; if (!previous || deps.some((value, i) => value !== previous.deps[i])) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; }); }
    },
    "react/jsx-runtime": jsx, "react-hot-toast": { default: { success() {}, error() {} } },
    "lucide-react": Object.fromEntries(["CheckCircle2", "Copy", "Gem", "LoaderCircle", "RefreshCw", "TriangleAlert"].map(name => [name, "svg"])),
    "./BotSettingsDialog": { BotSettingsDialog: "dialog" }, "./ui/badge": { Badge: "badge" }, "./ui/button": { Button: "button" }, "./ui/input": { Input: "input" }, "./ui/filter-dropdown": { FilterDropdown: "select" }, "./ui/skeleton": { Skeleton: "skeleton" }, "./SolarixSettings": { SolarixSetupLink: "setup" },
    "../lib/solarix-aio": {
      SolarixRequestError, SOLARIX_PREVIEW_STOCK: stock,
      getSolarixConfig: async () => ({ configured, slug: "test", secretSuffix: "TEST" }),
      getSolarixStock: async () => { if (unavailable) throw Error("Stock is unavailable"); return stock; },
      submitSolarixDelivery: async (value, id) => { submissions.push({ ...value, id }); receipt = { id, input: value, status: "running", startedAt: "2026-11-26T09:00:00Z", message: "Waiting" }; return receipt; },
      getSolarixDelivery: async id => { reads.push(id); if (!receipt) throw new SolarixRequestError("Not found", 404); return receipt; }
    }
  };
  const scope = { exports: {}, crypto, AbortController, localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }, require: name => { if (name.endsWith(".css")) return {}; assert.ok(name in dependencies, name); return dependencies[name]; }, setTimeout: fn => { timers.set(++counter, fn); return counter; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(code, scope);
  function render() { cursor = 0; dirty = false; tree = scope.exports.SolarixProvider({ children: null }); effects.splice(0).forEach(fn => fn()); }
  async function flush() { for (let i = 0; i < 10; i++) { if (dirty && mounted) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty) break; } }
  return { flush, submissions, reads, saved, setReceipt: value => { receipt = value; }, get receipt() { return receipt; }, get tree() { return tree; },
    async open() { tree.props.value.openOrder(input); await flush(); },
    button(label) { const value = nodes(tree, "button").find(node => text(node) === label || node.props["aria-label"] === label); assert.ok(value, `Missing ${label}`); return value.props; },
    submit() { const form = nodes(tree, "form")[0]; assert.ok(form); form.props.onSubmit({ preventDefault() {} }); },
    async close() { nodes(tree, "dialog")[0].props.onClose(); await flush(); },
    async tick() { assert.ok(timers.size); const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); await flush(); },
    stop() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); }
  };
}

test("double submit sends one delivery and closing the dialog preserves result polling", async () => {
  const f = fixture(); await f.flush(); await f.open();
  assert.equal(f.button("Place order").disabled, false);
  f.submit(); f.submit(); await f.flush();
  assert.equal(f.submissions.length, 1); assert.equal(f.saved.get("solarix-aio:last-request"), f.receipt.id);
  await f.close(); assert.equal(nodes(f.tree, "dialog").length, 0);
  f.setReceipt({ ...f.receipt, status: "completed", result: { orderId: "solarix", guildId: "123456789012345678", guildName: "Sample server", boosted: 8, failed: 2 } });
  await f.tick(); await f.open();
  assert.ok(text(f.tree).includes("Partially delivered")); assert.ok(text(f.tree).includes("Sample server"));
  assert.equal(f.submissions.length, 1);
  let prevented = false;
  f.button("New order").onClick({ preventDefault() { prevented = true; } }); await f.flush();
  assert.equal(prevented, true);
  assert.equal(nodes(f.tree, "form").length, 1);
  assert.equal(f.button("Place order").type, "submit");
  assert.equal(f.submissions.length, 1);
  f.stop();
});

test("reloading a saved request reads its receipt without making a new order", async () => {
  const receipt = { id: crypto.randomUUID(), input, status: "uncertain", message: "Check the Solarix panel" };
  const f = fixture({ restore: receipt }); await f.flush(); await f.open();
  assert.ok(text(f.tree).includes("Result not confirmed"));
  assert.ok(text(f.tree).includes(receipt.message));
  assert.equal(f.submissions.length, 0); assert.ok(f.reads.includes(receipt.id)); f.stop();
});

test("an unconfigured integration and unavailable stock disable submission", async () => {
  for (const options of [{ configured: false }, { unavailable: true }]) {
    const f = fixture(options); await f.flush(); await f.open();
    assert.equal(f.button("Place order").disabled, true); f.submit(); await f.flush();
    assert.equal(f.submissions.length, 0); f.stop();
  }
});
