import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play, RefreshCw, Square } from "lucide-react";
import { BotSettingsDialog } from "./BotSettingsDialog";
import { BotSyncProgress } from "./BotSyncProgress";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { FilterDropdown } from "./ui/filter-dropdown";
import { notifyBotSyncChange, showBotSyncToast } from "./BotSyncNotifications";
import { botSyncActive, botSyncPolling, mergeBotSyncJob } from "../lib/bot-sync-state";
import { controlBotSync, getBotSyncCategories, getBotSyncJob, getBotSyncPreview, startBotSync, type BotSyncCategory, type BotSyncJob, type BotSyncSummary } from "../lib/community";

type Action = "start" | "retry" | "resume" | "cancel";
const previewCategories = [{ id: "online", name: "OAuth Online" }, { id: "offline", name: "OAuth Offline" }];
const previewSummary = (scope: string) => ({ totalAccounts: scope ? 375 : 750, pending: scope ? 25 : 50, upToDate: scope ? 350 : 700, unavailable: 0 });

export function BotSyncSkeleton() {
  return <div className="bot-sync-loading" role="status" aria-label="Loading sync status">
    <div aria-hidden="true"><Skeleton className="mb-2 h-3 w-24" /><Skeleton className="h-12 w-full" /></div>
    <div className="bot-sync-summary app-panel-soft" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div key={index}><Skeleton className="h-3 w-16 max-w-full" /><Skeleton className="mt-2 h-5 w-10" /></div>)}</div>
  </div>;
}

export function BotSyncDialog({ clientId, name, onClose, onChanged, preview = false }: {
  clientId: string; name: string; onClose: () => void; onChanged: () => void; preview?: boolean;
}) {
  const [summary, setSummary] = useState<BotSyncSummary | null>(null);
  const [job, setJob] = useState<BotSyncJob | null>(null);
  const [categories, setCategories] = useState<BotSyncCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const pollRequest = useRef<AbortController | null>(null);
  const changed = useRef(onChanged); changed.current = onChanged;
  const cancelStop = useRef<HTMLButtonElement>(null);
  const busy = action !== null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; readRequest.current?.abort(); pollRequest.current?.abort(); }; }, []);
  useEffect(() => { if (confirmingStop) cancelStop.current?.focus(); }, [confirmingStop]);

  useEffect(() => {
    const controller = new AbortController();
    readRequest.current?.abort(); readRequest.current = controller;
    const version = ++generation.current;
    setLoading(true); setError(""); setSummary(null);
    const current = () => !controller.signal.aborted && version === generation.current;
    void (preview ? Promise.resolve([previewCategories, null] as const)
      : Promise.all([getBotSyncCategories(clientId, controller.signal), getBotSyncJob(clientId, controller.signal)]))
      .then(async ([nextCategories, nextJob]) => {
        if (!current()) return;
        const scope = botSyncActive(nextJob) ? nextJob?.categoryId || "" : categoryId;
        if (scope !== categoryId) { generation.current++; setCategoryId(scope); return; }
        const nextSummary = preview ? previewSummary(scope) : await getBotSyncPreview(clientId, controller.signal, scope);
        if (current()) { setCategories(nextCategories); if (!preview) setJob(nextJob); setSummary(nextSummary); }
      })
      .catch(reason => { if (current()) setError(reason instanceof Error ? reason.message : "Could not load sync status."); })
      .finally(() => { if (current()) setLoading(false); });
    return () => controller.abort();
  }, [clientId, preview, revision, categoryId]);

  useEffect(() => {
    if (busy || loading || !botSyncPolling(job)) return;
    const controller = new AbortController(); pollRequest.current = controller;
    const version = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    let latest = job!;
    const current = () => !controller.signal.aborted && version === generation.current;
    const poll = async () => {
      try {
        const next: BotSyncJob | null = preview ? latest.stopping
          ? { ...latest, stopping: false }
          : { ...latest, processed: Math.min(latest.total, latest.processed + 10), succeeded: Math.min(latest.total, latest.succeeded + 10), status: latest.processed + 10 >= latest.total ? "completed" : "running", estimatedRemainingSeconds: Math.max(0, latest.total - latest.processed - 10) * 4 }
          : await getBotSyncJob(clientId, controller.signal);
        if (!current()) return;
        const settled = !botSyncPolling(next);
        if (settled) {
          try {
            const nextSummary = preview ? previewSummary(categoryId) : await getBotSyncPreview(clientId, controller.signal, categoryId);
            if (current()) setSummary(nextSummary);
          } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : "Could not refresh account counts."); }
          if (!current()) return;
          changed.current();
        } else setError("");
        if (next) latest = next;
        setJob(previous => mergeBotSyncJob(previous, next));
        if (botSyncActive(next) && (next?.categoryId || "") !== categoryId) setCategoryId(next?.categoryId || "");
        if (!settled && current()) timer = setTimeout(poll, 2000);
      } catch (reason) {
        if (current()) { setError(reason instanceof Error ? reason.message : "Could not refresh sync progress. The server job continues."); timer = setTimeout(poll, 3000); }
      }
    };
    timer = setTimeout(poll, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [clientId, preview, job?.id, job?.status, job?.stopping, busy, loading, revision, categoryId]);

  async function act(nextAction: Action) {
    if (pending.current) return;
    pending.current = true;
    readRequest.current?.abort(); pollRequest.current?.abort(); generation.current++;
    setAction(nextAction); setLoading(false); setError("");
    try {
      const next: BotSyncJob = preview ? nextAction === "cancel" || nextAction === "resume"
        ? { ...job!, status: nextAction === "cancel" ? "cancelled" : "queued", stopping: nextAction === "cancel" && job?.status === "running" }
        : { id: "preview-bot-sync", clientId, categoryId, categoryName: categories.find(category => category.id === categoryId)?.name, total: summary?.pending || 0, processed: 0, succeeded: 0, failed: 0, errors: [], status: "queued", estimatedRemainingSeconds: null }
        : nextAction === "cancel" || nextAction === "resume" ? await controlBotSync(clientId, nextAction) : await startBotSync(clientId, nextAction === "retry", categoryId);
      if (!mounted.current) return;
      if (preview) showBotSyncToast({ ...next, botName: name }, false, true);
      else notifyBotSyncChange(next, name);
      setJob(next); setConfirmingStop(false);
      if (!botSyncActive(next)) { changed.current(); setRevision(value => value + 1); }
      if (!preview && nextAction !== "cancel") onClose();
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not update sync."); }
    finally { pending.current = false; if (mounted.current) setAction(null); }
  }

  const active = botSyncActive(job);
  const selectedMissing = Boolean(categoryId && !categories.some(category => category.id === categoryId));
  const visibleJob = job && (active || (job.categoryId || "") === categoryId) ? job : null;
  const scopeName = (item: BotSyncJob) => item.categoryName || categories.find(category => category.id === item.categoryId)?.name || (item.categoryId ? "Unavailable category" : "All categories");
  return <BotSettingsDialog title={`${name} · Sync accounts`} busy={busy} onClose={onClose} onCancel={confirmingStop ? () => setConfirmingStop(false) : undefined} headerActions={!confirmingStop ? <Button type="button" size="icon-sm" variant="secondary" aria-label="Refresh sync status" title="Refresh sync status" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} /></Button> : null}>
    <div className="settings-card-body bot-sync-body" aria-busy={loading}>
      <p className="settings-field-note">Sync missing or expiring OAuth permissions. Accounts that are up to date are skipped.</p>
      {loading ? <BotSyncSkeleton /> : <>
      <FilterDropdown label="Stock category" value={categoryId} options={[{ value: "", label: "All categories" }, ...categories.map(category => ({ value: category.id, label: category.name })), ...(selectedMissing ? [{ value: categoryId, label: "Unavailable category" }] : [])]} onChange={value => { setLoading(true); setSummary(null); setConfirmingStop(false); setCategoryId(value); }} disabled={loading || busy || active} />
      {summary ? <dl className="bot-sync-summary app-panel-soft">
        <div><dt>Accounts</dt><dd>{summary.totalAccounts.toLocaleString("en-US")}</dd></div><div><dt>Up to date</dt><dd>{summary.upToDate.toLocaleString("en-US")}</dd></div><div><dt>To sync</dt><dd>{summary.pending.toLocaleString("en-US")}</dd></div><div><dt>Unavailable</dt><dd>{summary.unavailable.toLocaleString("en-US")}</dd></div>
      </dl> : null}
      {summary?.unavailable ? <p className="settings-field-note">{summary.unavailable} accounts need a saved account token or renewable OAuth permission.</p> : null}
      {visibleJob ? <BotSyncProgress key={visibleJob.id} job={visibleJob} categoryName={scopeName(visibleJob)} /> : null}
      {job?.legacy ? <p className="settings-field-note">An earlier category authorization is still active. Resume or stop it here before starting another sync.</p> : null}
      <p className="settings-field-note">{active ? "Close this window to keep syncing in the background. Stop ends the job after the current account." : "Sync runs on the server. Progress is saved across page refreshes and appears in a notification."}</p>
      </>}
      {error ? <div className="settings-load-error app-panel-soft" role="alert"><span>{error}</span><Button type="button" size="xs" variant="secondary" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>Refresh status</Button></div> : null}
      {confirmingStop && active ? <div className="app-panel-soft bot-sync-stop-confirm" role="group" aria-label="Confirm stopping sync"><strong>Stop this sync?</strong><p>Completed OAuth permissions are kept. The current account may finish; remaining accounts will not start.</p></div> : null}
    </div>
    <footer className="settings-card-footer">
      <Button ref={confirmingStop ? cancelStop : undefined} type="button" size="sm" variant="secondary" disabled={busy} onClick={() => confirmingStop ? setConfirmingStop(false) : onClose()}>{confirmingStop || !job ? "Cancel" : "Close"}</Button>
      <div>
        {!loading && job?.status === "paused" && !confirmingStop ? <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void act("resume")}>{action === "resume" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Resume</Button> : null}
        {!loading && active ? <Button type="button" size="sm" variant={confirmingStop ? "destructive" : "dangerGhost"} disabled={busy || job?.stopping} onClick={() => confirmingStop ? void act("cancel") : setConfirmingStop(true)}>{action === "cancel" || job?.stopping ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}{job?.stopping ? "Stopping…" : confirmingStop ? "Stop sync" : "Stop"}</Button> : <>
          {!loading && visibleJob?.failed ? <Button type="button" size="sm" variant="secondary" disabled={busy || loading || !summary} onClick={() => void act("retry")}>{action === "retry" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}Retry failed ({visibleJob.failed})</Button> : null}
          <Button type="button" size="sm" variant="secondary" disabled={busy || loading || !summary || selectedMissing || summary.pending === 0} onClick={() => void act("start")}>{action === "start" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Sync</Button>
        </>}
      </div>
    </footer>
  </BotSettingsDialog>;
}
