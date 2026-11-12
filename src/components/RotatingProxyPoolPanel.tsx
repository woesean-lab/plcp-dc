import { useEffect, useRef, useState } from "react";
import { Check, Copy, Globe2, LoaderCircle, RefreshCw, Users } from "lucide-react";
import toast from "react-hot-toast";
import { addRotatingBoostProxies, getRotatingBoostProxies } from "../lib/integration";
import type { RotatingBoostAccount, RotatingProxyPool } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function RotatingProxyPoolPanel({ accounts, onChange }: { accounts: RotatingBoostAccount[]; onChange: () => void }) {
  const [pool, setPool] = useState<RotatingProxyPool | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = useRef(false);
  const draftCount = new Set(draft.split(/[\r\n,]+/).map((line) => line.trim()).filter(Boolean)).size;
  function showPool(result: RotatingProxyPool) {
    setPool(result);
    if (!dirty.current) setDraft(result.proxies.map((proxy) => proxy.proxy).join("\n"));
    setError("");
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    void getRotatingBoostProxies().then((result) => { if (active) showPool(result); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Fixed proxies could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accounts]);
  async function refresh() {
    setLoading(true);
    try { showPool(await getRotatingBoostProxies()); }
    catch (err) { setError(err instanceof Error ? err.message : "Fixed proxies could not be loaded."); }
    finally { setLoading(false); }
  }
  async function save() {
    if (!draft.trim() || saving) return;
    setSaving(true); setError("");
    try {
      const result = await addRotatingBoostProxies(draft);
      dirty.current = false; showPool(result);
      toast.success("Fixed proxies saved. Account assignments are preserved."); onChange();
    } catch (err) { setError(err instanceof Error ? err.message : "Fixed proxies could not be saved."); }
    finally { setSaving(false); }
  }
  async function copy(proxy: string) {
    try { await navigator.clipboard.writeText(proxy); toast.success("Proxy copied."); }
    catch { toast.error("Proxy could not be copied."); }
  }
  return <section className="dcord-proxy-panel onliner-proxy-pool boost-fixed-proxies" aria-label="Rotating proxy pool">
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header className="dcord-proxy-header">
        <div><p className="app-kicker">Rotating routing</p><h2>Fixed proxy pool</h2></div>
        <div className="dcord-proxy-actions">
          <span>{draftCount} typed / {pool?.total ?? 0} saved · {pool?.available ?? 0} available · {pool?.assigned ?? 0} bound</span>
          <Button type="submit" size="xs" disabled={saving || loading || !draft.trim()}>{saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{saving ? "Saving…" : "Save proxies"}</Button>
          <Button type="button" variant="secondary" size="icon-sm" title="Refresh fixed proxies" aria-label="Refresh fixed proxies" disabled={loading || saving} onClick={() => void refresh()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </header>
      <textarea id="rotating-proxy-draft" aria-label="Saved fixed proxies" className="dcord-proxy-textarea" spellCheck={false} autoComplete="off" value={draft} disabled={saving} onChange={(event) => { dirty.current = true; setDraft(event.target.value); }} placeholder={"user:pass@host:port\nhost:port:user:pass"} aria-describedby="rotating-proxy-help" />
    </form>
    {error ? <p className="rotating-transfer-error m-4" role="alert">{error}</p> : null}
    {pool?.proxies.length ? <div className="onliner-proxy-usage">
      <div className="onliner-proxy-usage-heading"><span>Saved proxy</span><span>Accounts</span><span>Status</span><span aria-hidden="true" /></div>
      <div className="onliner-proxy-usage-list">
        {pool.proxies.map((proxy) => <div className="onliner-proxy-usage-row" key={proxy.proxy}>
          <span className="onliner-proxy-address"><Globe2 className="h-3.5 w-3.5" /><code>{proxy.proxy}</code></span>
          <span className="onliner-proxy-assigned"><Users className="h-3.5 w-3.5" /><strong>{proxy.accounts}</strong><small>{proxy.accounts === 1 ? "account" : "accounts"}</small></span>
          <Badge variant={proxy.assigned ? "default" : "success"}>{proxy.assigned ? "Bound" : "Available"}</Badge>
          <Button type="button" size="icon-sm" variant="ghost" className="stock-row-action" title="Copy full proxy" aria-label={`Copy proxy ${proxy.label}`} onClick={() => void copy(proxy.proxy)}><Copy className="h-3.5 w-3.5" /></Button>
        </div>)}
      </div>
    </div> : <div className="stock-empty-state"><Globe2 className="h-5 w-5" /><strong>{loading ? "Loading fixed proxies…" : "No fixed proxies yet"}</strong><span>Paste proxies above and save to start assigning Rotating accounts.</span></div>}
    <p id="rotating-proxy-help" className="app-copy text-xs">Each account keeps the same proxy across orders. Saving adds new proxies and skips duplicates; existing proxies and bindings are preserved.</p>
  </section>;
}
