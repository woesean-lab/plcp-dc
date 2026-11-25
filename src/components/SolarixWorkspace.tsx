import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Copy, Gem, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import { BotSettingsDialog } from "./BotSettingsDialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FilterDropdown } from "./ui/filter-dropdown";
import { Skeleton } from "./ui/skeleton";
import { SolarixSetupLink } from "./SolarixSettings";
import { getSolarixConfig, getSolarixDelivery, getSolarixStock, submitSolarixDelivery, SOLARIX_PREVIEW_STOCK, SolarixRequestError, type SolarixConfig, type SolarixInput, type SolarixReceipt, type SolarixStock } from "../lib/solarix-aio";
import "./SettingsWorkspace.css";
import "./SolarixWorkspace.css";

const recoveryKey = "solarix-aio:last-request";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function savedRequest() { try { const value = localStorage.getItem(recoveryKey); return value && uuid.test(value) ? value : null; } catch { return null; } }
function remember(id: string | null) { try { if (id) localStorage.setItem(recoveryKey, id); else localStorage.removeItem(recoveryKey); } catch { /* The mounted workspace still retains the request. */ } }
type Workspace = { openOrder: (input?: Partial<SolarixInput>) => void; openStock: () => void };
const SolarixContext = createContext<Workspace | null>(null);
export const useSolarix = () => useContext(SolarixContext);
export type SolarixPreviewOutcome = "success" | "partial" | "failed" | "uncertain" | "running";

export function SolarixStockSummary({ stock }: { stock: SolarixStock }) {
  return <div className="solarix-stock-grid" aria-label="SolarixAIO stock">{stock.tiers.map(tier => <dl className="app-panel-soft solarix-stock-tier" key={tier.duration}><dt>{tier.label}</dt><dd><strong>{tier.boosts.toLocaleString("en-US")}</strong><span>boosts available</span></dd><div>{tier.tokens.toLocaleString("en-US")} tokens</div></dl>)}</div>;
}

export function SolarixProvider({ children, preview = false, previewOutcome = "partial" }: { children: ReactNode; preview?: boolean; previewOutcome?: SolarixPreviewOutcome }) {
  const [mode, setMode] = useState<"order" | "stock" | null>(null);
  const [input, setInput] = useState<SolarixInput>({ invite: "", amount: 2, duration: "1m" });
  const [config, setConfig] = useState<SolarixConfig | null>(null);
  const [stock, setStock] = useState<SolarixStock | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const [requestId, setRequestId] = useState<string | null>(() => preview ? null : savedRequest());
  const [receipt, setReceipt] = useState<SolarixReceipt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pollRevision, setPollRevision] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>();
  const id = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(previewTimer.current); }; }, []);
  useEffect(() => {
    if (!mode) return;
    const controller = new AbortController(); setLoading(true); setError("");
    void (async () => {
      try {
        const nextConfig = preview ? { configured: true, slug: "preview", secretSuffix: "DEMO" } : await getSolarixConfig(controller.signal);
        if (controller.signal.aborted) return;
        setConfig(nextConfig);
        if (!nextConfig.configured) { setStock(null); return; }
        const nextStock = preview ? SOLARIX_PREVIEW_STOCK : await getSolarixStock(controller.signal);
        if (!controller.signal.aborted) setStock(nextStock);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load SolarixAIO stock."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [mode, preview, revision]);
  useEffect(() => {
    if (preview || !requestId || submitting || (receipt && receipt.status !== "running")) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await getSolarixDelivery(requestId!, controller.signal);
        if (controller.signal.aborted) return;
        setReceipt(next); setReceiptError("");
        if (next.status !== "running") { setRevision(value => value + 1); return; }
      } catch (reason) {
        if (controller.signal.aborted) return;
        setReceiptError(reason instanceof Error ? reason.message : "Could not read the saved result.");
        if (reason instanceof SolarixRequestError && reason.status === 404) return;
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [preview, requestId, receipt?.status, submitting, pollRevision]);
  function openOrder(next?: Partial<SolarixInput>) {
    if (!requestId && next) setInput(current => ({ ...current, ...next, amount: Math.min(1000, Math.max(2, Math.floor((next.amount || 2) / 2) * 2)) }));
    setMode("order");
  }
  const running = submitting || receipt?.status === "running";
  const capacity = stock?.tiers.find(tier => tier.duration === input.duration)?.boosts;
  const canSubmit = !loading && !error && !pending.current && !requestId && Boolean(config?.configured && stock && input.invite.trim()) && Number.isInteger(input.amount) && input.amount >= 2 && input.amount <= Math.min(1000, capacity ?? 0) && input.amount % 2 === 0;
  async function submit() {
    if (pending.current || !canSubmit) return;
    pending.current = true; setSubmitting(true); setReceiptError("");
    const nextId = crypto.randomUUID();
    setRequestId(nextId); if (!preview) remember(nextId);
    try {
      const initial: SolarixReceipt = preview ? { id: nextId, input, status: "running", startedAt: new Date().toISOString(), message: "Waiting for SolarixAIO to return the delivery result." } : await submitSolarixDelivery(input, nextId);
      if (!mounted.current) return;
      setReceipt(initial);
      if (preview && previewOutcome !== "running") previewTimer.current = setTimeout(() => {
        if (!mounted.current) return;
        setReceipt({ ...initial, status: previewOutcome === "uncertain" ? "uncertain" : previewOutcome === "failed" ? "failed" : "completed", finishedAt: new Date().toISOString(), message: previewOutcome === "uncertain" ? "SolarixAIO did not confirm the result. Check its panel before placing another order." : previewOutcome === "failed" ? "SolarixAIO rejected the invite or available stock." : "SolarixAIO returned the delivery result.", ...(previewOutcome === "success" || previewOutcome === "partial" ? { result: { orderId: "solarix-preview-123", guildName: "Sample server", guildId: "123456789012345678", boosted: previewOutcome === "success" ? input.amount : Math.max(0, input.amount - 2), failed: previewOutcome === "success" ? 0 : 2 } } : {}) });
      }, 1400);
    } catch (reason) {
      if (!mounted.current) return;
      setReceiptError(reason instanceof Error ? reason.message : "Could not confirm the submission. Check the saved result.");
      if (reason instanceof SolarixRequestError && [400, 401, 403].includes(reason.status || 0)) { setRequestId(null); remember(null); }
    } finally { pending.current = false; if (mounted.current) setSubmitting(false); }
  }
  function newOrder() { if (running) return; setReceipt(null); setRequestId(null); setReceiptError(""); if (!preview) remember(null); setRevision(value => value + 1); }
  const result = receipt?.result;
  const outcome = result ? result.failed === 0 ? "Completed" : result.boosted > 0 ? "Partially delivered" : "Delivery failed" : receipt?.status === "uncertain" ? "Result not confirmed" : receipt?.status === "failed" ? "Request rejected" : "Delivering boosts";
  async function copyOrderId() { if (!result) return; try { await navigator.clipboard.writeText(result.orderId); toast.success("SolarixAIO order ID copied."); } catch { toast.error("Could not copy. Select the order ID manually."); } }
  return <SolarixContext.Provider value={{ openOrder, openStock: () => setMode("stock") }}>{children}
    {mode ? <BotSettingsDialog title={mode === "stock" ? "SolarixAIO · Boost stock" : "SolarixAIO · Place order"} onClose={() => setMode(null)} headerActions={<Button type="button" variant="secondary" size="icon-sm" aria-label="Refresh SolarixAIO stock" title="Refresh stock" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} /></Button>}>
      <div className="settings-card-body solarix-body">
        <p className="settings-field-note">Boosts are delivered from your SolarixAIO stock.</p>
        {loading && !stock ? <div className="solarix-stock-grid" role="status" aria-label="Loading SolarixAIO stock"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div> : stock ? <><SolarixStockSummary stock={stock} /><p className="settings-field-note">Stock checked at {new Date(stock.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p></> : null}
        {config && !config.configured ? <div className="stock-empty-state"><Gem className="h-5 w-5" /><strong>Connect SolarixAIO</strong><span>Add your integration slug and secret in Settings.</span><SolarixSetupLink onClick={() => setMode(null)} /></div> : null}
        {error ? <div className="settings-load-error app-panel-soft" role="alert"><span>{error}</span><Button type="button" size="xs" variant="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>Retry</Button></div> : null}
        {mode === "order" && !requestId ? <form id={`${id}-form`} className="solarix-body" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <label className="settings-field"><span className="field-label">Server invite</span><Input autoFocus required placeholder="discord.gg/yourcode" value={input.invite} disabled={loading || !config?.configured} onChange={event => setInput(current => ({ ...current, invite: event.target.value }))} /></label>
          <div className="settings-field-grid"><label className="settings-field"><span className="field-label">Number of boosts</span><Input type="number" min={2} max={Math.min(1000, capacity ?? 1000)} step={2} required value={input.amount} disabled={loading || !config?.configured} onChange={event => setInput(current => ({ ...current, amount: Number(event.target.value) }))} /></label><FilterDropdown label="Duration" value={input.duration} onChange={value => setInput(current => ({ ...current, duration: value as SolarixInput["duration"] }))} disabled={loading || !config?.configured} options={[{ value: "1m", label: "1 Month" }, { value: "3m", label: "3 Months" }]} /></div>
          {stock && capacity === undefined ? <p className="settings-field-note" role="status">Stock is unavailable for this duration.</p> : capacity === 0 ? <p className="settings-field-note" role="status">No boosts are available for this duration.</p> : capacity !== undefined && input.amount > capacity ? <p className="settings-field-note" role="status">Only {capacity} boosts are currently available for this duration.</p> : null}
        </form> : null}
        {mode === "order" && requestId ? <section className="app-panel-soft solarix-result" aria-live="polite" aria-label="SolarixAIO delivery result">
          <div className="solarix-result-heading">{running || !receipt ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : result && result.failed === 0 ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <TriangleAlert className="h-5 w-5" aria-hidden="true" />}<strong>{!receipt && !submitting ? "Restoring saved result" : running ? "Delivering boosts" : "Delivery result"}</strong><Badge variant={running || !receipt ? "secondary" : result?.failed === 0 ? "success" : "destructive"}>{running || !receipt ? "Pending" : outcome}</Badge></div>
          <p>{receipt?.message || (submitting ? "Sending your order to SolarixAIO." : "Checking the saved request without submitting another order.")}</p>
          {running ? <p className="settings-field-note">You can close this window and reopen it to view the result.</p> : null}
          {receipt ? <p className="settings-field-note">{receipt.input.amount} boosts · {receipt.input.duration === "3m" ? "3 Months" : "1 Month"} · {receipt.input.invite.includes("/") ? receipt.input.invite : `discord.gg/${receipt.input.invite}`}</p> : null}
          {result ? <><dl className="solarix-result-counts"><div><dt>Requested</dt><dd>{receipt!.input.amount}</dd></div><div><dt>Boosted</dt><dd>{result.boosted}</dd></div><div><dt>Failed</dt><dd>{result.failed}</dd></div></dl><div className="solarix-result-identity"><div><strong>{result.guildName || "Discord server"}</strong><small>{result.guildId}</small></div><code>{result.orderId}</code><span className="community-member-row-actions"><Button type="button" variant="secondary" size="icon-sm" aria-label="Copy SolarixAIO order ID" title="Copy order ID" onClick={() => void copyOrderId()}><Copy className="h-3.5 w-3.5" /></Button></span></div></> : null}
        </section> : null}
        {receiptError && mode === "order" ? <div className="settings-load-error app-panel-soft" role="alert"><span>{receiptError}</span>{requestId ? <Button type="button" variant="secondary" size="xs" disabled={submitting} onClick={() => setPollRevision(value => value + 1)}>Check result</Button> : null}</div> : null}
      </div>
      <footer className="settings-card-footer"><Button type="button" variant="secondary" size="sm" onClick={() => setMode(null)}>Close</Button><div>
        {mode === "stock" ? <Button key="open-order" type="button" variant="secondary" size="sm" onClick={event => { event.preventDefault(); openOrder(); }}>{requestId ? "View latest result" : "Place order"}</Button> : requestId ? <>{(receipt || receiptError) && !running ? <Button key="new-order" type="button" variant="secondary" size="sm" onClick={event => { event.preventDefault(); newOrder(); }}>New order</Button> : null}</> : <Button key="submit-order" type="submit" form={`${id}-form`} size="sm" disabled={!canSubmit}><Gem className="h-3.5 w-3.5" />Place order</Button>}
      </div></footer>
    </BotSettingsDialog> : null}
  </SolarixContext.Provider>;
}

export function SolarixStockButton() {
  const workspace = useSolarix();
  return <button type="button" className="header-dcord-check" aria-haspopup="dialog" onClick={workspace?.openStock} disabled={!workspace}><Gem className="h-3.5 w-3.5" aria-hidden="true" /><span>Boosts stock</span></button>;
}
