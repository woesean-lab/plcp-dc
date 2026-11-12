import { useEffect, useState } from "react";
import { ChevronDown, Globe2, LoaderCircle, Plus, RefreshCw } from "lucide-react";
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
  useEffect(() => {
    let active = true;
    setLoading(true);
    void getRotatingBoostProxies().then((result) => { if (active) { setPool(result); setError(""); } })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Fixed proxies could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accounts]);
  async function refresh() {
    setLoading(true);
    try { setPool(await getRotatingBoostProxies()); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Fixed proxies could not be loaded."); }
    finally { setLoading(false); }
  }
  async function add() {
    if (!draft.trim() || saving) return;
    setSaving(true); setError("");
    try {
      setPool(await addRotatingBoostProxies(draft)); setDraft("");
      toast.success("Fixed proxies saved. Account assignments will be reused."); onChange();
    } catch (err) { setError(err instanceof Error ? err.message : "Fixed proxies could not be saved."); }
    finally { setSaving(false); }
  }
  return <details className="boost-fixed-proxies boost-routing-details">
    <summary><span><Globe2 className="h-4 w-4" />Fixed proxies<Badge variant="secondary">{pool ? `${pool.available} unassigned · ${pool.assigned} bound` : loading ? "Loading…" : "Unavailable"}</Badge></span><ChevronDown className="h-4 w-4" /></summary>
    <div className="boost-fixed-proxy-body">
      <p>Dedicated to Rotating stock. Each account keeps its proxy across orders. Proxies stay saved after delivery; previous order assignments are restored automatically.</p>
      <form onSubmit={(event) => { event.preventDefault(); void add(); }}>
        <label htmlFor="rotating-proxy-draft" className="field-label">Add fixed proxies</label>
        <textarea id="rotating-proxy-draft" className="dcord-proxy-textarea" spellCheck={false} autoComplete="off" value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)} placeholder={"user:pass@host:port\nhost:port:user:pass"} aria-describedby="rotating-proxy-help" />
        <div className="boost-fixed-proxy-footer"><span id="rotating-proxy-help">One per line. Duplicates are skipped. Existing bindings are preserved.</span><div className="boost-pool-actions"><Button type="button" variant="ghost" size="xs" disabled={loading || saving} onClick={() => void refresh()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button><Button type="submit" size="xs" disabled={saving || !draft.trim()}>{saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add proxies</Button></div></div>
      </form>
      {error ? <p className="rotating-transfer-error" role="alert">{error}</p> : null}
      {pool?.proxies.length ? <ul className="boost-fixed-proxy-list">{pool.proxies.map((proxy, index) => <li key={index}><code>{proxy.label}</code><Badge variant={proxy.assigned ? "default" : "success"}>{proxy.assigned ? "Bound to account" : "Unassigned"}</Badge></li>)}</ul> : pool ? <p>No fixed proxies yet. Add proxies before assigning new Rotating accounts.</p> : null}
    </div>
  </details>;
}
