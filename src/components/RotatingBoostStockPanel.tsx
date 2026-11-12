import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Copy, Download, History, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { moveThreeMonthToRotatingStock } from "../lib/integration";
import type { BoostStock, RotatingBoostAccount } from "../types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import toast from "react-hot-toast";
import { Input } from "./ui/input";

const labels: Record<RotatingBoostAccount["status"], string> = {
  available: "Available", reserved: "Reserved", in_use: "In use", review: "Delivery issue", expired: "Insufficient time / expired"
};
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

export function RotatingBoostStockPanel({ search = "", accounts, availableThreeMonth, loading, error, onRefresh, onChange }: {
  search?: string;
  accounts: RotatingBoostAccount[];
  availableThreeMonth: number;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onChange: (accounts: RotatingBoostAccount[], stock: BoostStock) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const moveLimit = Math.min(availableThreeMonth, 1000);
  const validCount = Number.isInteger(count) && count >= 1 && count <= moveLimit;

  useEffect(() => {
    if (!adding) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [adding]);

  useEffect(() => {
    if (!adding) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setAdding(false);
      if (event.key !== "Tab") return;
      const fields = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
      if (!fields?.length) { event.preventDefault(); return; }
      const first = fields[0];
      const last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [adding, busy]);

  async function move() {
    if (busy || !validCount) return;
    setBusy(true); setActionError("");
    try {
      const result = await moveThreeMonthToRotatingStock(count);
      onChange(result.accounts, result.stock); setCount(1); setAdding(false);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Stock could not be moved."); }
    finally { setBusy(false); }
  }

  const visible = accounts.filter((row) => (filter === "all" || row.status === filter) && [row.token, row.redactedToken, row.orderId, row.serverName, row.serverId].some((value) => value?.toLowerCase().includes(search.toLowerCase().trim())));
  const selectedRows = visible.filter((row) => selected.includes(row.id));
  const exportRows = selectedRows.length ? selectedRows : visible;
  const allSelected = visible.length > 0 && selectedRows.length === visible.length;
  const badgeVariant = (status: RotatingBoostAccount["status"]) => status === "available" ? "success" as const : status === "review" || status === "expired" ? "destructive" as const : "secondary" as const;
  async function copy(rows: RotatingBoostAccount[]) {
    try { await navigator.clipboard.writeText(rows.map((row) => row.token).filter(Boolean).join("\n")); toast.success("Tokens copied."); }
    catch { toast.error("Tokens could not be copied."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([exportRows.map((row) => row.token).filter(Boolean).join("\n") + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "boost-rotating-tokens.txt"; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="rotating-stock-panel" aria-label="Rotating inventory">
    <header className="stock-duration-header flex flex-wrap items-center">
      <div className="stock-duration-identity flex items-center"><span><RefreshCw className="h-4 w-4" /></span><div><p className="app-kicker">Rotating inventory</p><h2>{accounts.length} accounts <em>{accounts.filter((row) => row.status === "available").length * 2} boosts ready</em></h2></div></div>
      <div className="dcord-proxy-actions">
        <Button size="xs" variant="secondary" onClick={onRefresh} disabled={loading}><RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />Refresh</Button>
        <Button size="xs" disabled={!availableThreeMonth || loading} onClick={() => { setAdding(true); setCount(1); setActionError(""); }}><ArrowRightLeft className="h-3.5 w-3.5" />Move from 3 month</Button>
      </div>
    </header>
    <div className="boost-rotation-note"><ShieldCheck className="h-4 w-4" /><p>2 boosts per account · 30-day deliveries · 3-day buffer. The 90-day subscription starts on first assignment. Eligible accounts return automatically after each delivery period.</p></div>
    <div className="boost-rotating-filters stock-duration-filter" role="group" aria-label="Rotating account status">
      <button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All<span>{accounts.length}</span></button>
      {(Object.keys(labels) as RotatingBoostAccount["status"][]).map((status) => <button key={status} type="button" aria-pressed={filter === status} className={filter === status ? "is-active" : ""} onClick={() => setFilter(status)}>{labels[status]}<span>{accounts.filter((row) => row.status === status).length}</span></button>)}
    </div>
    <div className={`stock-selection-bar flex flex-wrap items-center ${selectedRows.length ? "has-selection" : ""}`}>
      <label className="stock-select-all flex items-center"><input type="checkbox" checked={allSelected} disabled={!visible.length} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map((row) => row.id)])] : selected.filter((id) => !visible.some((row) => row.id === id)))} /><span>{selectedRows.length ? selectedRows.length + " selected" : "Select visible"}</span></label>
      <div className="stock-selection-actions flex items-center">
        {selectedRows.length ? <Button size="xs" variant="ghost" onClick={() => setSelected([])}>Clear</Button> : null}
        <Button size="xs" variant="secondary" disabled={!exportRows.length || exportRows.some((row) => !row.token)} onClick={() => void copy(exportRows)}><Copy className="h-3.5 w-3.5" />{selectedRows.length ? "Copy selected" : "Copy visible"}</Button>
        <Button size="xs" variant="secondary" disabled={!exportRows.length || exportRows.some((row) => !row.token)} onClick={download}><Download className="h-3.5 w-3.5" />{selectedRows.length ? "Download selected" : "Download visible"}</Button>
      </div>
    </div>
    {error ? <p role="alert" className="rotating-transfer-error m-4">{error}</p> : null}
    <div className="boost-rotating-list" aria-busy={loading}>
      {!visible.length ? <div className="stock-empty-state"><ShieldCheck className="h-5 w-5" /><strong>{loading ? "Loading rotating stock…" : accounts.length ? "No matching accounts" : "Build your rotating pool"}</strong><span>{accounts.length ? "Try another status or search." : "Move 3 month accounts here to deliver reusable 30-day boosts."}</span></div> : visible.map((row) => <article key={row.id} className={`boost-rotating-row ${selected.includes(row.id) ? "is-selected" : ""}`}>
        <div className="boost-rotating-account">
          <input type="checkbox" aria-label={"Select account " + row.redactedToken} checked={selected.includes(row.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
          <div><code>{row.token || row.redactedToken}</code><span className="boost-token-tools"><Badge variant={badgeVariant(row.status)}>{labels[row.status]}</Badge><Badge variant="outline">2 boosts</Badge><Badge variant="secondary">Rotating · 30 days</Badge></span></div>
          <Button size="icon-sm" variant="ghost" disabled={!row.token} aria-label={"Copy account " + row.redactedToken} onClick={() => void copy([row])}><Copy className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="boost-rotating-details">
          <div><small>Current assignment</small><strong>{row.serverName || row.serverId || "Unassigned"}</strong><span>{row.orderId || (row.status === "available" ? "Ready for a new order" : "Unavailable for new orders")}</span></div>
          <div><small>Customer period ends</small><strong>{formatDate(row.customerEndsAt)}</strong><span>{row.startedAt ? "Started " + formatDate(row.startedAt) : "Waiting for delivery"}</span></div>
          <div><small>Subscription</small><strong>{row.expiresAt ? Math.max(0, Math.floor((Date.parse(row.expiresAt) - Date.now()) / 86400_000)) + " days left" : "90 days · not started"}</strong><span>{row.expiresAt ? formatDate(row.expiresAt) : "Starts on first assignment"}</span></div>
          <Button size="xs" variant="ghost" aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}><History className="h-3.5 w-3.5" />{row.history.length} past assignments</Button>
        </div>
        {expanded === row.id ? <div className="boost-assignment-history">{row.history.length ? row.history.map((entry, index) => <div key={index}><strong>{entry.serverName || entry.orderId || "Previous assignment"}</strong><span>{formatDate(entry.startedAt)} → {formatDate(entry.customerEndsAt)}</span><small>Released {formatDate(entry.releasedAt)}</small></div>) : <p>No previous assignments. Delivery history will appear here.</p>}</div> : null}
      </article>)}
    </div>
    {adding ? createPortal(<div className="confirm-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) setAdding(false);
    }}>
      <div ref={dialogRef} className="confirm-modal add-tokens-modal rotating-stock-modal" role="dialog" aria-modal="true" aria-labelledby="rotating-dialog-title" aria-describedby="rotating-dialog-description" aria-busy={busy}>
        <span className="confirm-modal-icon is-success" aria-hidden="true"><ArrowRightLeft className="h-5 w-5" /></span>
        <p className="app-kicker text-[var(--app-accent)]">Stock</p>
        <h2 id="rotating-dialog-title">Move from 3 month stock</h2>
        <p id="rotating-dialog-description">Move existing accounts into rotating stock for 30-day deliveries. The 90-day period starts with the first order assignment.</p>
        <form className="mt-5 grid gap-5" onSubmit={(event) => { event.preventDefault(); void move(); }}>
          <div className="onliner-bulk-help rotating-transfer-summary">
            <span><strong>3 month stock</strong><code>{availableThreeMonth} accounts</code></span>
            <span><strong>Moving</strong><code>{validCount ? count : 0} accounts · {validCount ? count * 2 : 0} boosts</code></span>
            <span><strong>Stock after move</strong><code>{validCount ? availableThreeMonth - count : availableThreeMonth} accounts</code></span>
          </div>
          <label className="grid gap-2">
            <span className="field-label">Accounts to move</span>
            <Input autoFocus required disabled={busy} type="number" min={1} max={moveLimit} step={1} aria-describedby="rotating-count-help" value={count || ""} onChange={(event) => setCount(Number(event.target.value))} />
            <span id="rotating-count-help" className="text-xs text-[var(--app-muted)]">Choose 1–{moveLimit} accounts from your available 3 month inventory.</span>
          </label>
          {actionError ? <p role="alert" className="rotating-transfer-error">{actionError}</p> : null}
          <div className="confirm-modal-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !validCount}>
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />}
              {busy ? "Moving…" : "Move to rotating stock"}
            </Button>
          </div>
        </form>
      </div>
    </div>, document.body) : null}
  </section>;
}
