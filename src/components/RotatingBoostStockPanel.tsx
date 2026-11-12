import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { moveThreeMonthToRotatingStock } from "../lib/integration";
import type { BoostStock, RotatingBoostAccount } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const labels: Record<RotatingBoostAccount["status"], string> = {
  available: "Available", reserved: "Reserved", in_use: "In use", review: "Delivery issue", expired: "Insufficient time / expired"
};
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

export function RotatingBoostStockPanel({ accounts, availableThreeMonth, loading, error, onRefresh, onChange }: {
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

  return <section className="app-panel stock-workbench rotating-stock-panel">
    <header className="dcord-proxy-header">
      <div><p className="app-kicker">Boost inventory</p><h2>Rotating stock</h2></div>
      <div className="dcord-proxy-actions">
        <Button size="xs" variant="secondary" onClick={onRefresh} disabled={loading}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        <Button size="xs" disabled={!availableThreeMonth} onClick={() => { setAdding(true); setCount(1); setActionError(""); }}><ArrowRightLeft className="h-3.5 w-3.5" />Move from 3 month stock</Button>
      </div>
    </header>
    <div className="p-4 grid gap-4">
      <p className="app-copy text-xs leading-6">Each account supplies 2 boosts for one order at a time. New orders require 33 days remaining, including a 3-day buffer. When a 30-day period ends, the account automatically becomes available again if enough subscription time remains.</p>
      <div className="stock-duration-filter flex flex-wrap gap-2" role="group" aria-label="Rotating account status">
        <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All · {accounts.length}</button>
        {(Object.keys(labels) as RotatingBoostAccount["status"][]).map((status) => <button key={status} type="button" className={filter === status ? "is-active" : ""} onClick={() => setFilter(status)}>{labels[status]} · {accounts.filter((row) => row.status === status).length}</button>)}
      </div>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      {!accounts.length ? <div className="stock-empty-state"><ShieldCheck className="h-5 w-5" /><strong>{loading ? "Loading rotating stock…" : "No rotating accounts yet"}</strong><span>Move accounts from 3 month stock. Their 90-day period starts with the first order assignment.</span></div> : <div className="overflow-x-auto">
        <table className="rotating-stock-table">
          <thead><tr><th>Account</th><th>Status</th><th>Assignment</th><th>Customer period ends</th><th>Subscription ends</th></tr></thead>
          <tbody>{accounts.filter((row) => filter === "all" || row.status === filter).map((row) => <tr key={row.id}>
            <td><code>{row.redactedToken}</code><small>{row.expiresAt ? `${Math.max(0, Math.floor((Date.parse(row.expiresAt) - Date.now()) / 86400_000))} days left` : "90 days · not started"} · {row.history.length} past assignments</small></td>
            <td><span className={`rotating-status rotating-status-${row.status}`}>{labels[row.status]}</span></td>
            <td>{row.serverName || row.serverId || "—"}<small>{row.orderId || "Unassigned"}</small></td>
            <td>{formatDate(row.customerEndsAt)}</td><td>{row.expiresAt ? formatDate(row.expiresAt) : "Starts on first assignment"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
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
