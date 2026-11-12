import { useState } from "react";
import { ArrowRightLeft, RefreshCw, ShieldCheck } from "lucide-react";
import { moveThreeMonthToRotatingStock } from "../lib/integration";
import type { BoostStock, RotatingBoostAccount } from "../types";
import { Button } from "./ui/button";

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

  async function move() {
    setBusy(true); setActionError("");
    try {
      const result = await moveThreeMonthToRotatingStock(count);
      onChange(result.accounts, result.stock); setCount(1); setAdding(false);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Stock could not be moved."); }
    finally { setBusy(false); }
  }

  return <section className="stock-duration-section rotating-stock-panel">
    <header className="stock-duration-header">
      <div className="stock-duration-identity"><span><RefreshCw className="h-4 w-4" /></span><div><h3>Rotating stock</h3><p>Separate accounts for repeat 30-day deliveries.</p></div></div>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="secondary" onClick={onRefresh} disabled={loading}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        <Button size="xs" disabled={!availableThreeMonth} onClick={() => { setAdding(true); setCount(1); setActionError(""); }}><ArrowRightLeft className="h-3.5 w-3.5" />Move from 3 month stock</Button>
      </div>
    </header>
    <div className="p-4 grid gap-4">
      <p className="text-sm text-[var(--app-muted)]">Each account supplies 2 boosts for one order at a time. New orders require 33 days remaining, including a 3-day buffer. When a 30-day period ends, the account automatically becomes available again if enough subscription time remains.</p>
      <div className="stock-duration-filter flex flex-wrap gap-2" role="group" aria-label="Rotating account status">
        <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All · {accounts.length}</button>
        {(Object.keys(labels) as RotatingBoostAccount["status"][]).map((status) => <button key={status} type="button" className={filter === status ? "is-active" : ""} onClick={() => setFilter(status)}>{labels[status]} · {accounts.filter((row) => row.status === status).length}</button>)}
      </div>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      {!accounts.length ? <div className="stock-empty-state"><ShieldCheck className="h-5 w-5" /><strong>{loading ? "Loading rotating stock…" : "No rotating accounts yet"}</strong><span>Move accounts from 3 month stock. Their 90-day period starts when moved.</span></div> : <div className="overflow-x-auto">
        <table className="rotating-stock-table">
          <thead><tr><th>Account</th><th>Status</th><th>Assignment</th><th>Customer period ends</th><th>Subscription ends</th></tr></thead>
          <tbody>{accounts.filter((row) => filter === "all" || row.status === filter).map((row) => <tr key={row.id}>
            <td><code>{row.redactedToken}</code><small>{Math.max(0, Math.floor((Date.parse(row.expiresAt) - Date.now()) / 86400_000))} days left · {row.history.length} past assignments</small></td>
            <td><span className={`rotating-status rotating-status-${row.status}`}>{labels[row.status]}</span></td>
            <td>{row.serverName || row.serverId || "—"}<small>{row.orderId || "Unassigned"}</small></td>
            <td>{formatDate(row.customerEndsAt)}</td><td>{formatDate(row.expiresAt)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </div>
    {adding ? <div className="confirm-modal-backdrop">
      <div className="confirm-modal w-[min(640px,calc(100vw-2rem))] max-w-none" role="dialog" aria-modal="true" aria-labelledby="rotating-dialog-title">
        <h2 id="rotating-dialog-title">Move from 3 month stock</h2>
        <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); void move(); }}>
          <>
            <p className="text-sm text-[var(--app-muted)]">{availableThreeMonth} accounts available in 3 month stock. Moved accounts leave that inventory and enter rotating stock with 90 days remaining.</p>
            <label className="grid gap-2 text-sm">Accounts to move<input autoFocus required disabled={busy} type="number" min={1} max={Math.min(availableThreeMonth, 1000)} step={1} className="ui-input" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
            <p className="text-sm text-[var(--app-muted)]">{count > 0 ? count * 2 : 0} boosts · 30-day customer periods</p>
          </>
          {actionError ? <p role="alert" className="text-sm text-red-400">{actionError}</p> : null}
          <div className="confirm-modal-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !Number.isInteger(count) || count < 1 || count > Math.min(availableThreeMonth, 1000)}>{busy ? "Moving…" : "Move accounts"}</Button>
          </div>
        </form>
      </div>
    </div> : null}
  </section>;
}
