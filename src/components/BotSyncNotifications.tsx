import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Pause, Square } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { getBotSyncNotifications, type BotSyncJob, type BotSyncNotification } from "../lib/community";
import "./BotSyncNotifications.css";

const CHANGE_EVENT = "community-bot-sync-change";
const toastId = (id: string) => `bot-sync:${id}`;
const active = (job: BotSyncJob) => ["queued", "running", "paused"].includes(job.status);

export function notifyBotSyncChange(job: BotSyncJob, botName: string) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { ...job, botName, updatedAt: new Date().toISOString() } }));
}

export function BotSyncToast({ job, stale = false, preview = false }: { job: BotSyncJob & { botName: string }; stale?: boolean; preview?: boolean }) {
  const label = job.status === "completed" ? "Sync completed" : job.status === "cancelled" ? "Sync stopped" : job.status === "paused" ? "Sync paused" : "Syncing accounts";
  const progress = job.total ? Math.min(100, job.processed / job.total * 100) : job.status === "completed" ? 100 : 0;
  return <div className="bot-sync-toast">
    <strong>{job.botName} · {label}</strong>
    {job.categoryName || job.categoryId ? <span>{job.categoryName || job.categoryId}</span> : null}
    <span>{job.processed.toLocaleString("en-US")} / {job.total.toLocaleString("en-US")} processed · {job.failed.toLocaleString("en-US")} failed</span>
    <div className="monitor-live-progress-track" role="progressbar" aria-label={`${job.botName} account sync`} aria-valuemin={0} aria-valuemax={Math.max(1, job.total)} aria-valuenow={job.processed}><span style={{ width: `${progress}%` }} /></div>
    {stale ? <span>Reconnecting to progress… The server job continues.</span> : job.status === "paused" ? <span>{job.details || "Review this sync before resuming."}</span> : null}
    <div className="bot-sync-toast-actions"><span>{job.succeeded.toLocaleString("en-US")} synced</span>{preview ? <Button variant="secondary" size="xs" disabled>View bots</Button> : <Button asChild variant="secondary" size="xs"><Link to="/manage?tab=settings&settings=bot-pool">View bots</Link></Button>}</div>
  </div>;
}

export function showBotSyncToast(job: BotSyncJob & { botName: string }, stale = false, preview = false) {
  const options = { id: toastId(job.id), duration: active(job) && !preview ? Infinity : 6000 };
  const content = <BotSyncToast job={job} stale={stale} preview={preview} />;
  if (job.status === "queued" || job.status === "running") toast.loading(content, options);
  else if (job.status === "completed") (job.failed ? toast.error : toast.success)(content, options);
  else toast(content, { ...options, icon: job.status === "paused" ? <Pause className="h-4 w-4 text-[var(--app-accent-bright)]" /> : <Square className="h-4 w-4 text-[var(--app-muted)]" /> });
}

// The browser only observes persisted jobs. It never schedules authorization work.
export function BotSyncNotifications() {
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const jobs = new Map<string, BotSyncNotification>();
    const signatures = new Map<string, string>();
    const displayed = new Set<string>();
    const render = (job: BotSyncNotification, stale = false) => {
      const signature = JSON.stringify([job.status, job.processed, job.total, job.succeeded, job.failed, job.details, job.botName, job.categoryId, job.categoryName, stale]);
      if (signatures.get(job.id) === signature) return;
      jobs.set(job.id, job); signatures.set(job.id, signature); displayed.add(job.id);
      showBotSyncToast(job, stale);
    };
    const schedule = (delay: number) => { clearTimeout(timer); timer = setTimeout(() => void poll(), delay); };
    const poll = async () => {
      const request = new AbortController(); controller?.abort(); controller = request;
      try {
        const latest = await getBotSyncNotifications(request.signal);
        if (disposed || request.signal.aborted) return;
        const current = new Set(latest.map(job => job.id));
        for (const [id, previous] of jobs) {
          if (!current.has(id)) { if (active(previous)) toast.dismiss(toastId(id)); jobs.delete(id); signatures.delete(id); displayed.delete(id); }
        }
        latest.forEach(job => render(job));
        schedule(latest.some(active) ? 2000 : 15000);
      } catch {
        if (disposed || request.signal.aborted) return;
        for (const job of jobs.values()) if (active(job)) render(job, true);
        schedule(5000);
      }
    };
    const changed = (event: Event) => {
      controller?.abort();
      render((event as CustomEvent<BotSyncNotification>).detail);
      schedule(250);
    };
    const refresh = () => { if (document.visibilityState !== "hidden") { controller?.abort(); schedule(0); } };
    window.addEventListener(CHANGE_EVENT, changed);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    void poll();
    return () => {
      disposed = true; clearTimeout(timer); controller?.abort();
      window.removeEventListener(CHANGE_EVENT, changed); window.removeEventListener("online", refresh); window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      for (const id of displayed) toast.dismiss(toastId(id));
    };
  }, []);
  return null;
}
