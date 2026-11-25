import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play, RefreshCw, Square } from "lucide-react";
import { BotSettingsDialog } from "./BotSettingsDialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { notifyBotSyncChange, showBotSyncToast } from "./BotSyncNotifications";
import { controlBotSync, getBotSyncJob, getBotSyncPreview, startBotSync, type BotSyncJob, type BotSyncSummary } from "../lib/community";

export function BotSyncDialog({ clientId, name, onClose, onChanged, preview = false }: {
  clientId: string; name: string; onClose: () => void; onChanged: () => void; preview?: boolean;
}) {
  const [summary, setSummary] = useState<BotSyncSummary | null>(null);
  const [job, setJob] = useState<BotSyncJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const changed = useRef(onChanged); changed.current = onChanged;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void (preview ? Promise.resolve([{ totalAccounts: 750, pending: 50, upToDate: 700, unavailable: 0 }, null] as const)
      : Promise.all([getBotSyncPreview(clientId, controller.signal), getBotSyncJob(clientId, controller.signal)]))
      .then(([nextSummary, nextJob]) => { if (!controller.signal.aborted) { setSummary(nextSummary); setJob(nextJob); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load sync status."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId, preview, revision]);
  useEffect(() => {
    if (busy || !job || !["queued", "running"].includes(job.status)) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = preview ? { ...job, processed: Math.min(job.total, job.processed + 10), succeeded: Math.min(job.total, job.processed + 10), status: job.processed + 10 >= job.total ? "completed" as const : "running" as const } : await getBotSyncJob(clientId, controller.signal);
        if (controller.signal.aborted) return;
        setError("");
        if (next && !["queued", "running"].includes(next.status)) {
          changed.current();
          if (!preview) {
            try { const summary = await getBotSyncPreview(clientId, controller.signal); if (!controller.signal.aborted) setSummary(summary); }
            catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not refresh account counts."); }
          } else setSummary(current => current ? { ...current, pending: Math.max(0, current.pending - next.succeeded), upToDate: current.upToDate + next.succeeded } : null);
        }
        if (!controller.signal.aborted) { setJob(next); if (!next) setRevision(value => value + 1); }
      } catch (reason) { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Could not refresh sync progress."); timer = setTimeout(poll, 2500); } }
    };
    timer = setTimeout(poll, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [clientId, preview, job, busy]);
  async function act(action: "start" | "retry" | "resume" | "cancel") {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const next = preview ? action === "cancel" || action === "resume" ? { ...job!, status: action === "cancel" ? "cancelled" as const : "queued" as const }
        : { ...summary!, id: "preview", clientId, total: summary?.pending || 0, processed: 0, succeeded: 0, failed: 0, errors: [], status: "queued" as const }
        : action === "cancel" || action === "resume" ? await controlBotSync(clientId, action) : await startBotSync(clientId, action === "retry");
      if (preview) showBotSyncToast({ ...next, id: "preview-bot-sync", botName: name }, false, true);
      else notifyBotSyncChange(next, name);
      if (mounted.current) {
        setJob(next);
        if (["completed", "cancelled"].includes(next.status)) { changed.current(); if (!preview) setRevision(value => value + 1); }
        if (!preview && action !== "cancel") onClose();
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not update sync."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const active = job && ["queued", "running", "paused"].includes(job.status);
  const completed = job?.status === "completed";
  return <BotSettingsDialog title={`${name} · Sync accounts`} busy={busy} onClose={onClose}>
    <div className="settings-card-body bot-sync-body">
      <p className="settings-field-note">Sync missing or expiring OAuth permissions across all stock categories.</p>
      <p className="settings-field-note">Runs on the server. You can close this window or refresh the page; progress appears in a notification.</p>
      {loading ? <div role="status" aria-label="Loading sync status"><Skeleton className="h-12 w-full" /><Skeleton className="mt-3 h-12 w-full" /></div> : summary ? <dl className="bot-sync-summary app-panel-soft">
        <div><dt>Accounts</dt><dd>{summary.totalAccounts.toLocaleString("en-US")}</dd></div><div><dt>Up to date</dt><dd>{summary.upToDate.toLocaleString("en-US")}</dd></div><div><dt>To sync</dt><dd>{summary.pending.toLocaleString("en-US")}</dd></div><div><dt>Unavailable</dt><dd>{summary.unavailable.toLocaleString("en-US")}</dd></div>
      </dl> : null}
      {summary?.unavailable ? <p className="settings-field-note">{summary.unavailable} accounts need a saved account token or renewable OAuth permission.</p> : null}
      {job?.legacy ? <p className="settings-field-note">An earlier category authorization is still active. Resume or stop it here before syncing all categories.</p> : null}
      {!loading && job ? <div className="bot-sync-progress" role="status"><div className="bot-sync-status"><Badge variant={completed ? "success" : "secondary"}>{job.status === "completed" ? "Completed" : job.status === "cancelled" ? "Stopped" : job.status === "paused" ? "Paused" : "Syncing"}</Badge><span>{job.processed} / {job.total} processed</span></div><div className="monitor-live-progress-track" role="progressbar" aria-label="Account sync" aria-valuenow={job.processed} aria-valuemin={0} aria-valuemax={Math.max(1, job.total)}><span style={{ width: `${job.total ? Math.min(100, job.processed / job.total * 100) : completed ? 100 : 0}%` }} /></div><p className="settings-field-note">{job.succeeded} synced · {job.failed} failed</p>{job.details ? <p className="settings-field-note">{job.details}</p> : null}{job.errors.length ? <details><summary>Failed accounts ({job.failed})</summary>{job.errors.map(item => <p className="settings-field-note" key={item.userId}>{item.userId}: {item.message}</p>)}</details> : null}</div> : null}
      {error ? <div className="settings-load-error" role="alert"><span>{error}</span><Button size="xs" variant="secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh</Button></div> : null}
    </div>
    <footer className="settings-card-footer"><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><div>
      {job?.status === "paused" ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act("resume")}><Play className="h-3.5 w-3.5" />Resume</Button> : null}
      {active ? <Button size="sm" variant="dangerGhost" disabled={busy} onClick={() => void act("cancel")}><Square className="h-3.5 w-3.5" />Stop</Button> : <>{job?.failed ? <Button size="sm" variant="secondary" disabled={busy || loading} onClick={() => void act("retry")}>Retry failed</Button> : null}<Button size="sm" variant="secondary" disabled={busy || loading || !summary} onClick={() => void act("start")}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Sync</Button></>}
    </div></footer>
  </BotSettingsDialog>;
}
