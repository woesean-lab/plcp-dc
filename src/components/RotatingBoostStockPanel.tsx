import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, ArrowUpRight, Copy, Download, Eye, LoaderCircle, Power, RadioTower, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { connectRotatingBoostOnliner, disconnectRotatingBoostOnliner, moveThreeMonthToRotatingStock, removeRotatingBoostAccount } from "../lib/integration";
import type { BoostStock, RotatingBoostAccount } from "../types";
import { Button } from "./ui/button";
import { BoostStockStatus, boostStockOrderLink } from "./BoostStockStatus";
import toast from "react-hot-toast";
import { Input } from "./ui/input";

const labels: Record<RotatingBoostAccount["status"], string> = {
  available: "Available", reserved: "Reserved", in_use: "In use", review: "Delivery issue", expired: "Expired / low time"
};
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";
const onlinerLabel = (row: RotatingBoostAccount) => !row.onlinerConnected ? "Not connected"
  : row.onlinerConnectionState === "connected" ? "Live"
  : row.onlinerConnectionState === "disabled" ? "Disabled"
  : row.onlinerConnectionState === "error" ? "Connection error"
  : row.onlinerConnectionState === "disconnected" ? "Offline"
  : "Connecting";

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
  const [accountAction, setAccountAction] = useState<string | null>(null);
  const actionLock = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const moveLimit = Math.min(availableThreeMonth, 1000);
  const validCount = Number.isInteger(count) && count >= 1 && count <= moveLimit;
  const hasOnlinerProfiles = accounts.some((row) => row.onlinerConnected);
  useEffect(() => {
    if (!hasOnlinerProfiles || loading) return;
    const timer = window.setInterval(onRefresh, 5000);
    return () => window.clearInterval(timer);
  }, [hasOnlinerProfiles, loading, onRefresh]);

  async function manageAccount(row: RotatingBoostAccount, action: "connect" | "disconnect" | "remove") {
    if (actionLock.current) return;
    if (action === "remove" && !window.confirm(`Remove ${row.redactedToken} from Rotating stock? Its Onliner connection will also be removed. Order history will be kept.`)) return;
    actionLock.current = true;
    setAccountAction(row.id);
    try {
      if (action === "remove") await removeRotatingBoostAccount(row.id);
      else if (action === "disconnect") await disconnectRotatingBoostOnliner(row.id);
      else await connectRotatingBoostOnliner(row.id);
      toast.success(action === "remove" ? "Account removed from Rotating stock." : action === "disconnect" ? "Account removed from Onliner." : "Onliner connection queued using this account's fixed proxy.");
      onRefresh();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Account action failed."); }
    finally { actionLock.current = false; setAccountAction(null); }
  }

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
  const statusTone = (status: RotatingBoostAccount["status"]) => status === "available" ? "success" as const : status === "review" || status === "expired" ? "danger" as const : "accent" as const;
  async function copy(rows: RotatingBoostAccount[]) {
    try { await navigator.clipboard.writeText(rows.map((row) => row.token).filter(Boolean).join("\n")); toast.success("Tokens copied."); }
    catch { toast.error("Tokens could not be copied."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([exportRows.map((row) => row.token).filter(Boolean).join("\n") + "\n"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "boost-rotating-tokens.txt"; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="rotating-stock-panel" aria-label="Rotating inventory">
    <div className="boost-rotating-controls">
      <details className="boost-rotation-help"><summary><ShieldCheck className="h-3.5 w-3.5" />Pool rules</summary><p>Each account supplies 2 boosts for a 30-day delivery, with a 3-day buffer. The 90-day subscription starts on first assignment. Accounts return automatically when eligible.</p></details>
      <div className="boost-pool-actions">
        <span>{availableThreeMonth} accounts available to transfer</span>
        <Button size="xs" variant="secondary" disabled={!availableThreeMonth || loading} onClick={() => { setAdding(true); setCount(1); setActionError(""); }}><ArrowRightLeft className="h-3.5 w-3.5" />Transfer from 3 month</Button>
      </div>
    </div>
    <div className="stock-used-filterbar"><div className="stock-used-filter-group"><span>Status</span>
    <div className="stock-duration-filter boost-rotating-status-tabs" role="group" aria-label="Rotating account status">
      <button type="button" aria-pressed={filter === "all"} className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All<span>{accounts.length}</span></button>
      {(Object.keys(labels) as RotatingBoostAccount["status"][]).map((status) => <button key={status} type="button" aria-pressed={filter === status} className={filter === status ? "is-active" : ""} onClick={() => setFilter(status)}>{labels[status]}<span>{accounts.filter((row) => row.status === status).length}</span></button>)}
    </div></div></div>
    <div className={`stock-selection-bar flex flex-wrap items-center ${selectedRows.length ? "has-selection" : ""}`}>
      <label className="stock-select-all flex items-center"><input type="checkbox" checked={allSelected} disabled={!visible.length} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visible.map((row) => row.id)])] : selected.filter((id) => !visible.some((row) => row.id === id)))} /><span>{selectedRows.length ? selectedRows.length + " selected" : "Select visible"}</span></label>
      <div className="stock-selection-actions flex items-center">
        {selectedRows.length ? <Button size="xs" variant="ghost" onClick={() => setSelected([])}>Clear</Button> : null}
        <Button size="xs" variant="secondary" disabled={!exportRows.length || exportRows.some((row) => !row.token)} onClick={() => void copy(exportRows)}><Copy className="h-3.5 w-3.5" />{selectedRows.length ? "Copy selected" : "Copy visible"}</Button>
        <Button size="xs" variant="secondary" disabled={!exportRows.length || exportRows.some((row) => !row.token)} onClick={download}><Download className="h-3.5 w-3.5" />{selectedRows.length ? "Download selected" : "Download visible"}</Button>
      </div>
    </div>
    {error ? <div role="alert" className="rotating-transfer-error m-4">{error}<Button size="xs" variant="ghost" disabled={loading} onClick={onRefresh}><RefreshCw className="h-3.5 w-3.5" />Retry</Button></div> : null}
    <div className="boost-rotating-columns" aria-hidden="true"><span>Account / token</span><span>Current order</span><span>Status</span><span>Subscription</span><span>Actions</span></div>
    <div className="boost-rotating-list" aria-busy={loading}>
      {!visible.length ? <div className="stock-empty-state"><ShieldCheck className="h-5 w-5" /><strong>{loading ? "Loading rotating stock…" : accounts.length ? "No matching accounts" : "Your rotating pool is empty"}</strong><span>{accounts.length ? "Try another status or search." : "Transfer 3 month accounts to start delivering 30-day boosts."}</span></div> : visible.map((row) => <article key={row.id} className={`boost-rotating-row ${selected.includes(row.id) ? "is-selected" : ""}`}>
        <div className="boost-rotating-line">
          <label className="boost-rotating-account">
            <input type="checkbox" aria-label={"Select account " + row.redactedToken} checked={selected.includes(row.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
            <span><code title={row.token || row.redactedToken}>{row.token || row.redactedToken}</code><small>2 boosts · {row.history.length} previous deliveries</small></span>
          </label>
          <div className="boost-current-order">{row.orderId ? <><Link target="_blank" rel="noopener noreferrer" to={boostStockOrderLink(row.orderId)} title={row.orderId}>{row.orderId}<ArrowUpRight className="h-3.5 w-3.5" /></Link><small>{row.serverName || row.serverId || "Server pending"}</small></> : <><span>Unassigned</span><small>{row.status === "available" ? "Ready for a new order" : "No current order"}</small></>}</div>
          <div className="boost-rotating-status"><BoostStockStatus tone={statusTone(row.status)}>{labels[row.status]}</BoostStockStatus>
            <span title={row.onlinerLastError || "Onliner connection through this account's fixed proxy"}><BoostStockStatus tone={row.onlinerConnectionState === "connected" ? "success" : row.onlinerLastError || row.onlinerConnectionState === "error" ? "danger" : "neutral"}><RadioTower className="h-3 w-3" />{onlinerLabel(row)}</BoostStockStatus></span>
          </div>
          <div className="boost-time-left" title={row.customerEndsAt ? "Delivery ends " + formatDate(row.customerEndsAt) : "Delivery has not started"}>
            <strong>{row.customerEndsAt ? Math.max(0, Math.ceil((Date.parse(row.customerEndsAt) - Date.now()) / 86400_000)) + " days left" : "Delivery not started"}</strong>
            {row.customerEndsAt ? <small>{"Delivery ends " + new Date(row.customerEndsAt).toLocaleDateString()}</small> : null}
            <small title={row.expiresAt ? "Token subscription ends " + formatDate(row.expiresAt) : "Token subscription starts on first assignment"}>{row.expiresAt ? "Token: " + Math.max(0, Math.floor((Date.parse(row.expiresAt) - Date.now()) / 86400_000)) + " days left" : "Token: not started"}</small>
          </div>
          <div className="boost-row-actions community-member-row-actions">
            <Button size="icon-sm" className="stock-row-action" variant="ghost" disabled={!row.token} aria-label={"Copy account " + row.redactedToken} title="Copy token" onClick={() => void copy([row])}><Copy className="h-3.5 w-3.5" /></Button>
            <Button size="icon-sm" className="stock-row-action stock-row-action-details" variant="ghost" aria-label={"Account details and history for " + row.redactedToken} aria-controls={`boost-details-${row.id}`} title="View account details" aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}><Eye className="h-3.5 w-3.5" /></Button>
            <span title={row.onlinerConnected ? "Remove from Onliner" : "Connect to Onliner using assigned proxy"}><Button size="icon-sm" className="stock-row-action" variant={row.onlinerConnected ? "dangerGhost" : "ghost"} disabled={accountAction !== null} aria-label={(row.onlinerConnected ? "Disconnect " : "Connect ") + row.redactedToken + " Onliner"} onClick={() => void manageAccount(row, row.onlinerConnected ? "disconnect" : "connect")}>
              {accountAction === row.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : row.onlinerConnected ? <Power className="h-3.5 w-3.5" /> : <RadioTower className="h-3.5 w-3.5" />}
            </Button></span>
            <span title={["reserved", "in_use"].includes(row.status) ? "Cannot remove an account assigned to an active delivery" : "Remove from Rotating stock"}><Button size="icon-sm" className="stock-row-action" variant="dangerGhost" disabled={accountAction !== null || ["reserved", "in_use"].includes(row.status)} aria-label={"Remove " + row.redactedToken + " from Rotating stock"} onClick={() => void manageAccount(row, "remove")}><Trash2 className="h-3.5 w-3.5" /></Button></span>
          </div>
        </div>
        {expanded === row.id ? <div id={`boost-details-${row.id}`} className="boost-account-drawer">
          <div className="boost-rotating-details">
            <div><small>Onliner connection</small><strong>{onlinerLabel(row)}</strong><span>{row.onlinerLastError || (row.onlinerConnected ? "Uses this account's assigned fixed proxy" : "Connect to check account availability")}</span></div>
            <div><small>Current assignment</small><strong>{row.serverName || row.serverId || "Unassigned"}</strong>{row.orderId ? <Link target="_blank" rel="noopener noreferrer" className="boost-order-link" to={boostStockOrderLink(row.orderId)}>Open order <ArrowUpRight className="h-3.5 w-3.5" /></Link> : <span>No order assigned</span>}</div>
            <div><small>Customer period ends</small><strong>{formatDate(row.customerEndsAt)}</strong><span>{row.startedAt ? "Started " + formatDate(row.startedAt) : "Delivery has not started"}</span></div>
            <div><small>Subscription ends</small><strong>{row.expiresAt ? formatDate(row.expiresAt) : "90 days from first assignment"}</strong><span>2 boosts per delivery</span></div>
            <div><small>Fixed proxy</small><strong className="select-text">{row.proxy || row.proxyLabel || "Assigned on first delivery"}</strong>
              {row.proxy ? <Button size="xs" variant="secondary" className="w-fit" onClick={async () => { try { await navigator.clipboard.writeText(row.proxy!); toast.success("Proxy copied."); } catch { toast.error("Proxy could not be copied."); } }}><Copy className="h-3.5 w-3.5" />Copy proxy</Button> : null}
              <span>{row.hasFixedProxy ? "Reused for every order · never consumed" : "Uses the separate Rotating proxy pool"}</span></div>
          </div>
          <div className="boost-assignment-history"><strong>{row.history.length} previous assignments</strong>{row.history.length ? row.history.map((entry, index) => <div key={index}><strong>{entry.serverName || "Previous assignment"}</strong>{entry.orderId ? <Link target="_blank" rel="noopener noreferrer" className="boost-order-link" to={boostStockOrderLink(entry.orderId)}>{entry.orderId}<ArrowUpRight className="h-3.5 w-3.5" /></Link> : null}<span>{formatDate(entry.startedAt)} → {formatDate(entry.customerEndsAt)}</span><small>Released {formatDate(entry.releasedAt)}</small></div>) : <p>No previous assignments yet.</p>}</div>
        </div> : null}
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
