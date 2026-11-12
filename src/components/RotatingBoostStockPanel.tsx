import { useState } from "react";
import { Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { addRotatingBoostStock } from "../lib/integration";
import type { RotatingBoostAccount } from "../types";
import { Button } from "./ui/button";

const labels: Record<RotatingBoostAccount["status"], string> = {
  available: "Available", reserved: "Reserved", in_use: "In use", review: "Delivery issue", expired: "Insufficient time / expired"
};
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

export function RotatingBoostStockPanel({ accounts, loading, error, onRefresh, onChange }: {
  accounts: RotatingBoostAccount[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onChange: (accounts: RotatingBoostAccount[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [tokens, setTokens] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [filter, setFilter] = useState("all");

  async function add() {
    setBusy(true); setActionError("");
    try {
      const result = await addRotatingBoostStock(tokens, new Date(expiresAt).toISOString());
      onChange(result.accounts); setTokens(""); setExpiresAt(""); setAdding(false);
    } catch (err) { setActionError(err instanceof Error ? err.message : "Stock could not be added."); }
    finally { setBusy(false); }
  }

  return <section className="stock-duration-section rotating-stock-panel">
    <header className="stock-duration-header">
      <div className="stock-duration-identity"><span><RefreshCw className="h-4 w-4" /></span><div><h3>Rotating stock</h3><p>Separate accounts for repeat 30-day deliveries.</p></div></div>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="secondary" onClick={onRefresh} disabled={loading}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
        <Button size="xs" onClick={() => { setAdding(true); setActionError(""); }}><Plus className="h-3.5 w-3.5" />Add rotating accounts</Button>
      </div>
    </header>
    <div className="p-4 grid gap-4">
      <p className="text-sm text-[var(--app-muted)]">Each account supplies 2 boosts for one order at a time. New orders require 33 days remaining, including a 3-day buffer. When a 30-day period ends, the account automatically becomes available again if enough subscription time remains.</p>
      <div className="stock-duration-filter flex flex-wrap gap-2" role="group" aria-label="Rotating account status">
        <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All · {accounts.length}</button>
        {(Object.keys(labels) as RotatingBoostAccount["status"][]).map((status) => <button key={status} type="button" className={filter === status ? "is-active" : ""} onClick={() => setFilter(status)}>{labels[status]} · {accounts.filter((row) => row.status === status).length}</button>)}
      </div>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      {!accounts.length ? <div className="stock-empty-state"><ShieldCheck className="h-5 w-5" /><strong>{loading ? "Loading rotating stock…" : "No rotating accounts yet"}</strong><span>Add separate accounts with their actual subscription expiry.</span></div> : <div className="overflow-x-auto">
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
        <h2 id="rotating-dialog-title">Add rotating accounts</h2>
        <form className="mt-4 grid gap-4" onSubmit={(event) => { event.preventDefault(); void add(); }}>
          <>
            <p className="text-sm text-[var(--app-muted)]">Only this separate pool is affected. Add batches sharing the same actual expiry date.</p>
            <label className="grid gap-2 text-sm">Tokens<textarea autoFocus required disabled={busy} className="ui-input min-h-40 font-mono text-xs" value={tokens} onChange={(event) => setTokens(event.target.value)} placeholder="One token per line" /></label>
            <label className="grid gap-2 text-sm">Actual subscription expiry<input required disabled={busy} type="datetime-local" className="ui-input" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
          </>
          {actionError ? <p role="alert" className="text-sm text-red-400">{actionError}</p> : null}
          <div className="confirm-modal-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add accounts"}</Button>
          </div>
        </form>
      </div>
    </div> : null}
  </section>;
}
