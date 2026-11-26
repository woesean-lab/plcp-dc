import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronUp, LoaderCircle, Pause, Square } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { formatBotSyncEta } from "../lib/bot-sync-state";
import { getBotSyncNotifications, type BotSyncJob, type BotSyncNotification } from "../lib/community";
import "./BotSyncNotifications.css";

const CHANGE_EVENT = "community-bot-sync-change";
const toastId = (id: string) => `bot-sync:${id}`;
const active = (job: BotSyncJob) => job.stopping || ["queued", "running", "paused"].includes(job.status);
const RECEIPTS_KEY = "pulcip:bot-sync-notifications:v1";
type CompletionReceipt = { result: string; seenAt: number };
const completionReceipts = new Map<string, CompletionReceipt>();

function loadCompletionReceipts() {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(RECEIPTS_KEY) || "[]");
    if (Array.isArray(stored)) for (const item of stored) {
      if (typeof item?.id === "string" && typeof item.result === "string" && Number.isFinite(item.seenAt)) {
        const current = completionReceipts.get(item.id);
        if (!current || current.seenAt < item.seenAt) completionReceipts.set(item.id, { result: item.result, seenAt: item.seenAt });
      }
    }
  } catch { /* Keep in-memory receipts when browser storage is unavailable. */ }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, receipt] of completionReceipts) if (receipt.seenAt < cutoff) completionReceipts.delete(id);
  const oldestFirst = [...completionReceipts.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
  oldestFirst.slice(0, Math.max(0, oldestFirst.length - 200)).forEach(([id]) => completionReceipts.delete(id));
  return completionReceipts;
}

function rememberCompletion(id: string, result: string) {
  const receipts = loadCompletionReceipts();
  receipts.set(id, { result, seenAt: Date.now() });
  try { window.localStorage.setItem(RECEIPTS_KEY, JSON.stringify([...receipts].slice(-200).map(([jobId, receipt]) => ({ id: jobId, ...receipt })))); }
  catch { /* The current browser session still deduplicates the notification. */ }
}

export function notifyBotSyncChange(job: BotSyncJob, botName: string) {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { ...job, botName, updatedAt: new Date().toISOString() } }));
}

export function BotSyncToast({ job, stale = false, preview = false, onView }: { job: BotSyncJob & { botName: string }; stale?: boolean; preview?: boolean; onView?: () => void }) {
  const label = job.stopping ? "Stopping sync" : job.status === "completed" ? "Sync completed" : job.status === "cancelled" ? "Sync stopped" : job.status === "paused" ? "Sync paused" : "Syncing accounts";
  const progress = job.total ? Math.min(100, job.processed / job.total * 100) : job.status === "completed" ? 100 : 0;
  return <div className="bot-sync-toast">
    <strong>{job.botName} · {label}</strong>
    {job.categoryName || job.categoryId ? <span>{job.categoryName || job.categoryId}</span> : null}
    <span>{job.processed.toLocaleString("en-US")} / {job.total.toLocaleString("en-US")} processed · {job.failed.toLocaleString("en-US")} failed</span>
    <div className="monitor-live-progress-track" role="progressbar" aria-label={`${job.botName} account sync`} aria-valuemin={0} aria-valuemax={Math.max(1, job.total)} aria-valuenow={job.processed}><span style={{ width: `${progress}%` }} /></div>
    {["queued", "running"].includes(job.status) && !job.stopping ? <span>Est. remaining · {formatBotSyncEta(job.estimatedRemainingSeconds)}</span> : null}
    {job.stopping ? <span>Finishing the current account…</span> : null}
    {stale ? <span>Reconnecting to progress… The server job continues.</span> : job.status === "paused" ? <span>{job.details || "Review this sync before resuming."}</span> : null}
    <div className="bot-sync-toast-actions"><span>{job.succeeded.toLocaleString("en-US")} synced</span>{preview ? <Button variant="secondary" size="xs" disabled>View bots</Button> : <Button asChild variant="secondary" size="xs"><Link to="/manage?tab=settings&settings=bot-pool" onClick={onView}>View bots</Link></Button>}</div>
  </div>;
}

export function showBotSyncToast(job: BotSyncJob & { botName: string }, stale = false, preview = false) {
  const options = { id: toastId(job.id), duration: 6000 };
  const label = job.stopping ? "Stopping sync" : job.status === "completed" ? "Sync completed" : job.status === "cancelled" ? "Sync stopped" : job.status === "paused" ? "Sync paused" : "Syncing accounts";
  const content = `${job.botName} · ${label}${active(job) ? "" : ` · ${job.succeeded.toLocaleString("en-US")} synced · ${job.failed.toLocaleString("en-US")} failed`}${stale ? " · Reconnecting" : ""}${preview ? " · Preview" : ""}`;
  if (job.stopping || job.status === "queued" || job.status === "running") toast.loading(content, options);
  else if (job.status === "completed") (job.failed ? toast.error : toast.success)(content, options);
  else toast(content, { ...options, icon: job.status === "paused" ? <Pause className="h-4 w-4 text-[var(--app-accent-bright)]" /> : <Square className="h-4 w-4 text-[var(--app-muted)]" /> });
}

export type BotSyncCenterItem = { job: BotSyncNotification; stale?: boolean };

export function BotSyncCenter({ items, preview = false }: { items: BotSyncCenterItem[]; preview?: boolean }) {
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ position: "fixed", top: 0, left: 0, visibility: "hidden" });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const collapse = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const exitTimer = useRef<ReturnType<typeof setTimeout>>();
  const openRef = useRef(false);
  const interaction = useRef<"hover" | "keyboard" | "touch">("hover");
  const pointerType = useRef("mouse");
  const focusPanel = useRef(false);
  const suppressFocus = useRef(false);
  const id = useId();
  const activeItems = items.filter(({ job }) => active(job));
  const working = activeItems.some(({ job }) => job.stopping || job.status === "running" || job.status === "queued");
  const show = (mode: typeof interaction.current, focus = false) => {
    clearTimeout(closeTimer.current); clearTimeout(exitTimer.current);
    interaction.current = mode; openRef.current = true;
    setPresent(true); setOpen(true);
    focusPanel.current = focus;
    if (focus && panel.current) { focusPanel.current = false; collapse.current?.focus(); }
  };
  const close = (restoreFocus = false) => {
    clearTimeout(closeTimer.current);
    if (openRef.current) {
      openRef.current = false; setOpen(false);
      exitTimer.current = setTimeout(() => setPresent(false), 140);
    }
    if (restoreFocus && document.activeElement !== trigger.current) {
      suppressFocus.current = true; trigger.current?.focus(); suppressFocus.current = false;
    }
  };
  const leave = () => {
    if (interaction.current === "keyboard" && (panel.current?.contains(document.activeElement) || trigger.current === document.activeElement)) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => close(), 160);
  };
  useEffect(() => () => { clearTimeout(closeTimer.current); clearTimeout(exitTimer.current); }, []);
  useLayoutEffect(() => {
    if (!present || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(380, window.innerWidth - 24);
    const top = Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 180));
    setPosition({ position: "fixed", zIndex: 100, top, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), width, maxHeight: Math.max(160, window.innerHeight - top - 12) });
  }, [present]);
  useEffect(() => { if (open && position.visibility !== "hidden" && focusPanel.current) { focusPanel.current = false; collapse.current?.focus(); } }, [open, position.visibility]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); };
    const resize = () => close();
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", scroll, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", resize); window.removeEventListener("scroll", scroll, true); };
  }, [open]);
  useEffect(() => { if (!items.length) { clearTimeout(closeTimer.current); clearTimeout(exitTimer.current); openRef.current = false; setOpen(false); setPresent(false); } }, [items.length]);
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => Number(active(b.job)) - Number(active(a.job)) || Date.parse(b.job.updatedAt) - Date.parse(a.job.updatedAt));
  return <>
    <span className="community-member-row-actions"><Button ref={trigger} type="button" variant="secondary" size="icon-sm" aria-label={activeItems.length ? `Background syncs · ${activeItems.length} active` : "Recent sync results"} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      onPointerDown={event => { pointerType.current = event.pointerType; }}
      onPointerEnter={event => { if (event.pointerType !== "touch") show("hover"); }}
      onPointerLeave={event => { if (event.pointerType !== "touch") leave(); }}
      onFocus={event => { if (!suppressFocus.current && event.currentTarget.matches(":focus-visible")) show("keyboard"); }}
      onBlur={event => { if (interaction.current === "keyboard" && !panel.current?.contains(event.relatedTarget as Node | null)) close(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(true); } else if (event.key === "ArrowDown") { event.preventDefault(); show("keyboard", true); } }}
      onClick={event => { if (event.detail === 0) show("keyboard", true); else if (pointerType.current === "touch") { if (openRef.current) close(); else show("touch"); } else show("hover"); }}>
      {working ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : activeItems.length ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
    </Button></span>
    {present ? createPortal(<div ref={panel} id={id} role="dialog" aria-label="Background syncs" aria-hidden={!open} data-state={open ? "open" : "closed"} className="app-panel-soft bot-sync-center-panel" style={position}
      onPointerEnter={event => { if (event.pointerType !== "touch") show("hover"); }}
      onPointerLeave={event => { if (event.pointerType !== "touch") leave(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); } }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !trigger.current?.contains(event.relatedTarget as Node | null)) close(); }}>
      <header><div><strong>Background syncs</strong><span>{activeItems.length ? `${activeItems.length} active · Progress updates automatically` : "Recent results"}</span></div><span className="community-member-row-actions"><Button ref={collapse} type="button" variant="secondary" size="icon-sm" aria-label="Collapse sync progress" title="Collapse sync progress" onClick={() => close(true)}><ChevronUp className="h-4 w-4" /></Button></span></header>
      <div className="bot-sync-center-list">{sorted.map(({ job, stale }) => <article className="app-panel-soft" key={job.id}><BotSyncToast job={job} stale={stale} preview={preview} onView={() => close()} /></article>)}</div>
    </div>, document.body) : null}
  </>;
}

// The browser only observes persisted jobs. It never schedules authorization work.
export function BotSyncNotifications() {
  const [items, setItems] = useState<BotSyncCenterItem[]>([]);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const jobs = new Map<string, BotSyncNotification>();
    const signatures = new Map<string, string>();
    const displayed = new Set<string>();
    const staleJobs = new Set<string>();
    const publish = () => { if (!disposed) setItems([...jobs.values()].map(job => ({ job, stale: staleJobs.has(job.id) }))); };
    const render = (job: BotSyncNotification, stale = false) => {
      const previous = jobs.get(job.id);
      const receipts = loadCompletionReceipts();
      // A delayed observation must not reopen a finished job as active.
      if (active(job) && (receipts.has(job.id) || (previous && !active(previous)))) return;
      const signature = JSON.stringify([job.status, job.stopping, job.processed, job.total, job.succeeded, job.failed, job.details, job.botName, job.categoryId, job.categoryName, formatBotSyncEta(job.estimatedRemainingSeconds), stale]);
      if (signatures.get(job.id) === signature) return;
      jobs.set(job.id, job); signatures.set(job.id, signature);
      if (stale) staleJobs.add(job.id); else staleJobs.delete(job.id);
      publish();
      const result = JSON.stringify([job.status, job.processed, job.total, job.succeeded, job.failed]);
      if (!active(job) && receipts.get(job.id)?.result === result) {
        if (previous && active(previous)) toast.dismiss(toastId(job.id));
        return;
      }
      displayed.add(job.id);
      // Active work stays in the compact header control. Only completion uses a
      // short text toast; observing progress never expands or obstructs the page.
      if (!active(job)) { showBotSyncToast(job, stale); rememberCompletion(job.id, result); }
    };
    const schedule = (delay: number) => { clearTimeout(timer); timer = setTimeout(() => void poll(), delay); };
    const poll = async () => {
      const request = new AbortController(); controller?.abort(); controller = request;
      try {
        const latest = await getBotSyncNotifications(request.signal);
        if (disposed || request.signal.aborted) return;
        const current = new Set(latest.map(job => job.id));
        for (const [id, previous] of jobs) {
          if (!current.has(id)) { if (active(previous)) toast.dismiss(toastId(id)); jobs.delete(id); signatures.delete(id); staleJobs.delete(id); displayed.delete(id); }
        }
        latest.forEach(job => render(job));
        publish();
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
  return <BotSyncCenter items={items} />;
}
