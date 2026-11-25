import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Clock3, Copy, Search, TriangleAlert } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { FilterDropdown } from "./ui/filter-dropdown";
import { PaginatedList } from "./ListPagination";
import { BOT_SYNC_ERROR_TYPES, botSyncPolling, botSyncStatus, describeBotSyncError, formatBotSyncEta } from "../lib/bot-sync-state";
import type { BotSyncJob } from "../lib/community";
import "./BotSyncProgress.css";

const labels = { verification: "Verification required", credentials: "Authentication", connection: "Connection", rate_limit: "Rate limit", other: "Other errors" };
async function copy(value: string, label: string) {
  try { await navigator.clipboard.writeText(value); toast.success(`${label} copied.`); }
  catch { toast.error("Could not copy. Select and copy the text manually."); }
}

export function BotSyncProgress({ job, categoryName }: { job: BotSyncJob; categoryName: string }) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const errors = useMemo(() => job.errors.map(error => ({ ...error, ...describeBotSyncError(error.message) })), [job.errors]);
  const filtered = errors.filter(error => (type === "all" || type === error.type) && `${error.userId} ${error.title} ${error.message}`.toLowerCase().includes(search.trim().toLowerCase()));
  const completed = job.status === "completed";
  const percent = job.total ? Math.min(100, Math.max(0, job.processed / job.total * 100)) : completed ? 100 : 0;
  return <section className="bot-sync-progress" aria-label="Sync progress">
    <div className="bot-sync-progress-heading"><div><span className="app-kicker">{!job.stopping && (job.status === "completed" || job.status === "cancelled") ? "Last sync" : "Current sync"}</span><h4>{categoryName}</h4></div><Badge variant={completed ? job.failed ? "destructive" : "success" : "secondary"}>{botSyncStatus(job)}</Badge></div>
    <div className="bot-sync-progress-meta"><span><strong>{job.processed.toLocaleString("en-US")}</strong> / {job.total.toLocaleString("en-US")} processed</span>{botSyncPolling(job) && !job.stopping ? <span><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />Est. remaining · {formatBotSyncEta(job.estimatedRemainingSeconds)}</span> : null}</div>
    <div className="monitor-live-progress-track" role="progressbar" aria-label="Account sync" aria-valuenow={Math.min(Math.max(0, job.processed), Math.max(1, job.total))} aria-valuemin={0} aria-valuemax={Math.max(1, job.total)}><span style={{ width: `${percent}%` }} /></div>
    <div className="bot-sync-outcomes"><span><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /><strong>{job.succeeded.toLocaleString("en-US")}</strong> synced</span><span data-failed={job.failed > 0}><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /><strong>{job.failed.toLocaleString("en-US")}</strong> failed</span><span>{Math.max(0, job.total - job.processed).toLocaleString("en-US")} remaining</span></div>
    {job.stopping ? <p className="settings-field-note" role="status">Stopping after the current account. No further accounts will start; the final result appears here.</p> : job.details ? <p className="settings-field-note" role={job.status === "paused" ? "status" : undefined}>{job.details}</p> : null}
    {job.failed > 0 ? <details className="lookup-technical-details app-panel-soft bot-sync-errors">
      <summary><span><TriangleAlert className="h-4 w-4" aria-hidden="true" />Failed accounts<Badge variant="destructive">{job.failed.toLocaleString("en-US")}</Badge></span><ChevronDown className="h-4 w-4" aria-hidden="true" /></summary>
      <div className="bot-sync-errors-body">
        <p className="settings-field-note">{errors.length < job.failed ? `Showing ${errors.length} saved details of ${job.failed} failures. ` : ""}Failed accounts are recorded separately; the sync continues with the next account.</p>
        {errors.length ? <>
          <div className="bot-sync-error-tools"><label className="community-member-search"><Search className="h-3.5 w-3.5" aria-hidden="true" /><Input type="search" aria-label="Search failed accounts" placeholder="Account ID or error…" value={search} onChange={event => setSearch(event.target.value)} /></label>
            <FilterDropdown label="Error type" showLabel={false} placement="top" value={type} onChange={setType} options={[{ value: "all", label: `All errors (${errors.length})` }, ...BOT_SYNC_ERROR_TYPES.filter(value => errors.some(error => error.type === value)).map(value => ({ value, label: `${labels[value]} (${errors.filter(error => error.type === value).length})` }))]} />
            <Button type="button" variant="secondary" size="xs" disabled={!filtered.length} onClick={() => void copy(filtered.map(error => error.userId).join("\n"), "Account IDs")}><Copy className="h-3.5 w-3.5" />Copy IDs</Button>
          </div>
          <div className="bot-sync-error-list"><PaginatedList key={`${search}:${type}`} items={filtered} label="Sync error pages">{items => items.map(error => <article className="bot-sync-error-row" key={error.userId}>
            <div className="bot-sync-error-heading"><div><strong>{error.title}</strong><span>{error.userId}</span></div><span className="community-member-row-actions"><Button type="button" variant="secondary" size="icon-sm" aria-label={`Copy account ID ${error.userId}`} title="Copy account ID" onClick={() => void copy(error.userId, "Account ID")}><Copy className="h-3.5 w-3.5" /></Button></span></div>
            <p>{error.detail}</p><details className="bot-sync-error-technical"><summary>Technical details</summary><p>{error.message}</p></details>
          </article>)}</PaginatedList>{!filtered.length ? <div className="stock-empty-state"><Search className="h-5 w-5" /><strong>No matching errors</strong><span>Try another account ID or error type.</span></div> : null}</div>
        </> : null}
      </div>
    </details> : null}
  </section>;
}
