import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Copy, Gem, History, LoaderCircle, RefreshCw, Server, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import { BotSettingsDialog } from "./BotSettingsDialog";
import { OrderConfirmationDialog } from "./OrderConfirmationDialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { SolarixSetupLink } from "./SolarixSettings";
import { getSolarixConfig, getSolarixDelivery, getSolarixStock, submitSolarixDelivery, SOLARIX_PREVIEW_STOCK, SolarixRequestError, type SolarixConfig, type SolarixInput, type SolarixReceipt, type SolarixStock } from "../lib/solarix-aio";
import "./SettingsWorkspace.css";
import "./SolarixWorkspace.css";

const recoveryKey = "solarix-aio:last-request";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function savedRequest() { try { const value = localStorage.getItem(recoveryKey); return value && uuid.test(value) ? value : null; } catch { return null; } }
function remember(id: string | null) { try { if (id) localStorage.setItem(recoveryKey, id); else localStorage.removeItem(recoveryKey); } catch { /* The mounted workspace still retains the request. */ } }
type Workspace = {
  openOrder: () => void; openStock: () => void; startOrder: (input: SolarixInput) => void;
  config: SolarixConfig | null; stock: SolarixStock | null; loading: boolean; error: string; refreshStock: () => void;
};
const SolarixContext = createContext<Workspace | null>(null);
export const useSolarix = () => useContext(SolarixContext);
export type SolarixPreviewOutcome = "success" | "success_with_failures" | "partial" | "failed" | "uncertain" | "running";

export function SolarixStockSummary({ stock }: { stock: SolarixStock }) {
  return <div className="solarix-stock-grid" aria-label="SolarixAIO stock">{stock.tiers.map(tier => <dl className="app-panel-soft solarix-stock-tier" key={tier.duration}><dt>{tier.label}</dt><dd><strong>{tier.boosts.toLocaleString("en-US")}</strong><span>boosts available</span></dd><div>{tier.tokens.toLocaleString("en-US")} tokens</div></dl>)}</div>;
}

export function SolarixProvider({ children, preview = false, previewOutcome = "partial" }: { children: ReactNode; preview?: boolean; previewOutcome?: SolarixPreviewOutcome }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"order" | "stock" | null>(null);
  const [confirmation, setConfirmation] = useState<SolarixInput | null>(null);
  const [config, setConfig] = useState<SolarixConfig | null>(null);
  const [stock, setStock] = useState<SolarixStock | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const [requestId, setRequestId] = useState<string | null>(() => preview ? null : savedRequest());
  const [receipt, setReceipt] = useState<SolarixReceipt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [stockRequested, setStockRequested] = useState(false);
  const [pollRevision, setPollRevision] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout>>();
  const refreshStock = useCallback(() => { setLoading(true); setError(""); setStockRequested(true); setRevision(value => value + 1); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(previewTimer.current); }; }, []);
  useEffect(() => {
    if (!mode && !stockRequested) return;
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
  }, [mode, stockRequested, preview, revision]);
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
  function goToCreate() { setMode(null); if (!preview) navigate("/manage?tab=create&boostService=solarix"); }
  function openOrder() { if (requestId) setMode("order"); else goToCreate(); }
  const running = submitting || receipt?.status === "running";
  function startOrder(next: SolarixInput) {
    if (pending.current || running || (requestId && !receipt)) { setMode("order"); return; }
    setMode(null); setConfirmation({ ...next });
  }
  async function submit(nextInput: SolarixInput) {
    if (pending.current || running || (requestId && !receipt)) return;
    const capacity = stock?.tiers.find(tier => tier.duration === nextInput.duration)?.boosts;
    if (loading || error || !config?.configured || !nextInput.invite.trim() || !Number.isInteger(nextInput.amount) || nextInput.amount < 2 || nextInput.amount % 2 || nextInput.amount > Math.min(1000, capacity ?? 0)) { setReceiptError("Check the invite, amount and SolarixAIO stock in the order form."); return; }
    pending.current = true; setSubmitting(true); setReceiptError("");
    setReceipt(null);
    const nextId = crypto.randomUUID();
    setRequestId(nextId); if (!preview) remember(nextId);
    try {
      const initial: SolarixReceipt = preview ? { id: nextId, input: nextInput, status: "running", startedAt: new Date().toISOString(), message: "Waiting for SolarixAIO to return the delivery result." } : await submitSolarixDelivery(nextInput, nextId);
      if (!mounted.current) return;
      setReceipt(initial);
      if (preview && previewOutcome !== "running") previewTimer.current = setTimeout(() => {
        if (!mounted.current) return;
        setReceipt({ ...initial, status: previewOutcome === "uncertain" ? "uncertain" : previewOutcome === "failed" ? "failed" : "completed", finishedAt: new Date().toISOString(), message: previewOutcome === "uncertain" ? "SolarixAIO did not confirm the result. Check its panel before placing another order." : previewOutcome === "failed" ? "SolarixAIO rejected the invite or available stock." : "SolarixAIO returned the delivery result.", ...(previewOutcome === "success" || previewOutcome === "success_with_failures" || previewOutcome === "partial" ? { result: { orderId: "solarix-preview-123", guildName: "Sample server", guildId: "123456789012345678", boosted: previewOutcome !== "partial" ? nextInput.amount : Math.max(0, nextInput.amount - 2), failed: previewOutcome === "success_with_failures" ? 24 : previewOutcome === "success" ? 0 : 2 } } : {}) });
      }, 1400);
    } catch (reason) {
      if (!mounted.current) return;
      setReceiptError(reason instanceof Error ? reason.message : "Could not confirm the submission. Check the saved result.");
      if (reason instanceof SolarixRequestError && [400, 401, 403].includes(reason.status || 0)) { setRequestId(null); remember(null); }
    } finally { pending.current = false; if (mounted.current) setSubmitting(false); }
  }
  function newOrder() { if (running) return; setReceipt(null); setRequestId(null); setReceiptError(""); if (!preview) remember(null); goToCreate(); }
  const result = receipt?.result;
  const fullyDelivered = Boolean(result && receipt?.status === "completed" && result.boosted === receipt.input.amount);
  const undelivered = receipt && result ? Math.max(0, receipt.input.amount - result.boosted) : 0;
  const outcome = result ? fullyDelivered ? "Completed" : result.boosted > 0 ? "Partially delivered" : "Delivery failed" : receipt?.status === "uncertain" ? "Result not confirmed" : receipt?.status === "failed" ? "Request rejected" : "Delivering boosts";
  async function copyOrderId() { if (!result) return; try { await navigator.clipboard.writeText(result.orderId); toast.success("SolarixAIO order ID copied."); } catch { toast.error("Could not copy. Select the order ID manually."); } }
  return <SolarixContext.Provider value={{ openOrder, openStock: () => setMode("stock"), startOrder, config, stock, loading, error, refreshStock }}>{children}
    {confirmation ? <OrderConfirmationDialog service="SolarixAIO · Boosts" amount={confirmation.amount} invite={confirmation.invite} description="Sends this boost order to SolarixAIO using its available stock." onClose={() => setConfirmation(null)} onConfirm={() => { const input = confirmation; setConfirmation(null); setMode("order"); void submit(input); }}><div className="order-confirm-meta"><span><History className="h-3.5 w-3.5" />{confirmation.duration === "3m" ? "3 months" : "1 month"}</span><span><Gem className="h-3.5 w-3.5" />{confirmation.amount} boosts</span></div></OrderConfirmationDialog> : null}
    {mode ? <BotSettingsDialog title={mode === "stock" ? "SolarixAIO · Boost stock" : "SolarixAIO · Delivery"} onClose={() => setMode(null)} headerActions={mode === "stock" ? <Button type="button" variant="secondary" size="icon-sm" aria-label="Refresh SolarixAIO stock" title="Refresh stock" disabled={loading} onClick={refreshStock}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} /></Button> : null}>
      <div className="settings-card-body solarix-body">
        {mode === "stock" ? <p className="settings-field-note">Boosts are delivered from your SolarixAIO stock.</p> : null}
        {mode === "stock" ? loading && !stock ? <div className="solarix-stock-grid" role="status" aria-label="Loading SolarixAIO stock"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div> : stock ? <><SolarixStockSummary stock={stock} /><p className="settings-field-note">Stock checked at {new Date(stock.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</p></> : null : null}
        {config && !config.configured ? <div className="stock-empty-state"><Gem className="h-5 w-5" /><strong>Connect SolarixAIO</strong><span>Add your integration slug and secret in Settings.</span><SolarixSetupLink onClick={() => setMode(null)} /></div> : null}
        {error ? <div className="settings-load-error app-panel-soft" role="alert"><span>{error}</span><Button type="button" size="xs" variant="secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>Retry</Button></div> : null}
        {mode === "order" && requestId ? <section className="solarix-result" data-outcome={running || !receipt ? "pending" : fullyDelivered ? "success" : "warning"} aria-live="polite" aria-label="SolarixAIO delivery result">
          <div className="solarix-result-heading"><span className="solarix-result-icon" aria-hidden="true">{running || !receipt ? <LoaderCircle className="h-6 w-6 animate-spin" /> : fullyDelivered ? <CheckCircle2 className="h-6 w-6" /> : <TriangleAlert className="h-6 w-6" />}</span><div><span className="app-kicker">SolarixAIO delivery</span><h4>{!receipt && !submitting ? "Restoring saved result" : running ? "Delivering your boosts" : fullyDelivered ? "All boosts delivered" : outcome}</h4><p>{result ? `${result.boosted} of ${receipt!.input.amount} requested boosts delivered.` : receipt?.message || (submitting ? "Sending your confirmed order." : "Checking the saved request.")}</p></div><Badge variant={running || !receipt ? "secondary" : fullyDelivered ? "success" : "destructive"}>{running || !receipt ? "Pending" : outcome}</Badge></div>
          {receipt ? <div className="app-panel-soft solarix-result-server"><span className="solarix-server-icon" aria-hidden="true"><Server className="h-5 w-5" /></span><div><strong>{result?.guildName || "Discord server"}</strong><span>{receipt.input.invite.includes("/") ? receipt.input.invite : `discord.gg/${receipt.input.invite}`}</span>{result ? <small>Server ID · {result.guildId}</small> : null}</div><Badge variant="secondary"><History className="h-3 w-3" />{receipt.input.duration === "3m" ? "3 Months" : "1 Month"}</Badge></div> : null}
          {result ? <>
            <dl className="solarix-result-counts"><div className="app-panel-soft"><dt>Requested</dt><dd>{receipt!.input.amount}<small>boosts</small></dd></div><div className="app-panel-soft" data-delivered="true"><dt>Delivered</dt><dd>{result.boosted}<small>boosts</small></dd></div><div className="app-panel-soft"><dt>Remaining</dt><dd>{undelivered}<small>boosts</small></dd></div></dl>
            <div className="solarix-delivery-total"><div><span>Delivery result</span><strong>{Math.round(result.boosted / receipt!.input.amount * 100)}%</strong></div><div className="monitor-live-progress-track" role="progressbar" aria-label="Delivered boosts" aria-valuenow={result.boosted} aria-valuemin={0} aria-valuemax={receipt!.input.amount}><span style={{ width: `${Math.min(100, result.boosted / receipt!.input.amount * 100)}%` }} /></div></div>
            {result.failed > 0 ? <div className="solarix-result-note"><TriangleAlert className="h-4 w-4" aria-hidden="true" /><p>SolarixAIO reported {result.failedAccounts ?? result.failed / 2} unsuccessful accounts.{fullyDelivered ? " All requested boosts were delivered." : " These are separate from remaining boosts."}</p></div> : null}
            <div className="solarix-result-identity"><div><small>Order ID</small><code>{result.orderId}</code></div><span className="community-member-row-actions"><Button type="button" variant="secondary" size="icon-sm" aria-label="Copy SolarixAIO order ID" title="Copy order ID" onClick={() => void copyOrderId()}><Copy className="h-3.5 w-3.5" /></Button></span></div>
          </> : running ? <p className="settings-field-note">You can close this window. Your delivery continues in the background.</p> : null}
        </section> : null}
        {receiptError && mode === "order" ? <div className="settings-load-error app-panel-soft" role="alert"><span>{receiptError}</span>{requestId ? <Button type="button" variant="secondary" size="xs" disabled={submitting} onClick={() => setPollRevision(value => value + 1)}>Check result</Button> : null}</div> : null}
      </div>
      <footer className="settings-card-footer"><Button type="button" variant="secondary" size="sm" onClick={() => setMode(null)}>Close</Button><div>
        {mode === "stock" ? <Button key="open-order" type="button" variant="secondary" size="sm" onClick={event => { event.preventDefault(); openOrder(); }}>{requestId ? "View latest result" : "Create order"}</Button> : !running ? <Button key="new-order" type="button" variant="secondary" size="sm" onClick={event => { event.preventDefault(); newOrder(); }}>Back to order form</Button> : null}
      </div></footer>
    </BotSettingsDialog> : null}
  </SolarixContext.Provider>;
}

export function SolarixStockButton() {
  const workspace = useSolarix();
  return <button type="button" className="header-dcord-check" aria-haspopup="dialog" onClick={workspace?.openStock} disabled={!workspace}><Gem className="h-3.5 w-3.5" aria-hidden="true" /><span>Boosts stock</span></button>;
}
