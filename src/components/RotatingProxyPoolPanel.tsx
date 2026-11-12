import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Globe2, LoaderCircle, RefreshCw, Users } from "lucide-react";
import toast from "react-hot-toast";
import { addRotatingBoostProxies, getRotatingBoostProxies } from "../lib/integration";
import type { RotatingBoostAccount, RotatingProxyPool } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

const PROXY_PAGE_SIZE = 50;

export function RotatingProxyPoolPanel({ accounts, onChange }: { accounts: RotatingBoostAccount[]; onChange: () => void }) {
  const [pool, setPool] = useState<RotatingProxyPool | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const draftCount = useMemo(() => new Set(draft.split(/[\r\n,]+/).map((line) => line.trim()).filter(Boolean)).size, [draft]);
  const bindingSignature = accounts.map((account) => `${account.id}:${account.hasFixedProxy}:${account.proxyLabel ?? ""}`).join("|");
  const pageCount = Math.max(1, Math.ceil((pool?.proxies.length ?? 0) / PROXY_PAGE_SIZE));
  const visibleProxies = useMemo(() => pool?.proxies.slice(page * PROXY_PAGE_SIZE, (page + 1) * PROXY_PAGE_SIZE) ?? [], [pool, page]);
  function changePage(next: number) {
    setPage(Math.max(0, Math.min(next, pageCount - 1)));
    listRef.current?.scrollTo({ top: 0 });
  }
  function showPool(result: RotatingProxyPool) {
    setPool(result);
    setPage((current) => Math.min(current, Math.max(0, Math.ceil(result.proxies.length / PROXY_PAGE_SIZE) - 1)));
    if (!dirty.current) {
      const savedDraft = result.proxies.map((proxy) => proxy.proxy).join("\n");
      setDraft((current) => current === savedDraft ? current : savedDraft);
    }
    setError("");
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    void getRotatingBoostProxies().then((result) => { if (active) showPool(result); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Fixed proxies could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [bindingSignature]);
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
  return <section className="dcord-proxy-panel onliner-proxy-pool boost-fixed-proxies" aria-label="Rotating proxy pool" aria-busy={loading || saving}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header className="dcord-proxy-header">
        <div><p className="app-kicker">Rotating routing</p><h2>Fixed proxy pool</h2></div>
        <div className="dcord-proxy-actions">
          <span>{draftCount} typed / {pool?.total ?? 0} saved · {pool?.available ?? 0} available · {pool?.assigned ?? 0} bound</span>
          <Button type="submit" size="xs" disabled={saving || loading || !draft.trim()}>{saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{saving ? "Saving…" : "Save proxies"}</Button>
          <Button type="button" variant="secondary" size="icon-sm" title="Refresh fixed proxies" aria-label="Refresh fixed proxies" disabled={loading || saving} onClick={() => void refresh()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </header>
      {loading && !pool ? <div className="boost-proxy-preloader" role="status" aria-label="Loading fixed proxies"><Skeleton className="h-28 w-full" />{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex items-center gap-4"><Skeleton className="h-4 flex-1" /><Skeleton className="h-6 w-20" /><Skeleton className="h-8 w-8" /></div>)}</div> : <textarea id="rotating-proxy-draft" aria-label="Saved fixed proxies" className="dcord-proxy-textarea" spellCheck={false} autoComplete="off" value={draft} disabled={saving} onChange={(event) => { dirty.current = true; setDraft(event.target.value); }} placeholder={"user:pass@host:port\nhost:port:user:pass"} aria-describedby="rotating-proxy-help" />}
    </form>
    {error ? <p className="rotating-transfer-error m-4" role="alert">{error}</p> : null}
    {pool?.proxies.length ? <div className="onliner-proxy-usage">
      <div className="onliner-proxy-usage-heading"><span>Saved proxy</span><span>Accounts</span><span>Status</span><span aria-hidden="true" /></div>
      <div ref={listRef} className="onliner-proxy-usage-list">
        {visibleProxies.map((proxy) => <div className="onliner-proxy-usage-row" key={proxy.proxy}>
          <span className="onliner-proxy-address"><Globe2 className="h-3.5 w-3.5" /><code>{proxy.proxy}</code></span>
          <span className="onliner-proxy-assigned"><Users className="h-3.5 w-3.5" /><strong>{proxy.accounts}</strong><small>{proxy.accounts === 1 ? "account" : "accounts"}</small></span>
          <Badge variant={proxy.assigned ? "default" : "success"}>{proxy.assigned ? "Bound" : "Available"}</Badge>
          <Button type="button" size="icon-sm" variant="ghost" className="stock-row-action" title="Copy full proxy" aria-label={`Copy proxy ${proxy.label}`} onClick={() => void copy(proxy.proxy)}><Copy className="h-3.5 w-3.5" /></Button>
        </div>)}
      </div>
      <div className="boost-proxy-pagination"><span aria-live="polite">{page * PROXY_PAGE_SIZE + 1}–{Math.min((page + 1) * PROXY_PAGE_SIZE, pool.proxies.length)} of {pool.proxies.length} proxies</span>{pageCount > 1 ? <div className="flex items-center gap-2"><Button type="button" variant="secondary" size="icon-sm" disabled={page === 0} aria-label="Previous proxy page" onClick={() => changePage(page - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button><span>{page + 1} / {pageCount}</span><Button type="button" variant="secondary" size="icon-sm" disabled={page + 1 >= pageCount} aria-label="Next proxy page" onClick={() => changePage(page + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button></div> : null}</div>
    </div> : !loading && !error ? <div className="stock-empty-state"><Globe2 className="h-5 w-5" /><strong>No fixed proxies yet</strong><span>Paste proxies above and save to start assigning Rotating accounts.</span></div> : null}
    <p id="rotating-proxy-help" className="app-copy text-xs">Each account keeps the same proxy across orders. Saving adds new proxies and skips duplicates; existing proxies and bindings are preserved.</p>
  </section>;
}
