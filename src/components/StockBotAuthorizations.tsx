import { useEffect, useRef, useState } from "react";
import { Bot, LoaderCircle, Play, RefreshCw, Square, UserPlus } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { FilterDropdown } from "./ui/filter-dropdown";
import { PREVIEW_POOL_BOTS } from "./BotPoolSettings";
import { getCommunityBotPool, getBotAuthorizationJob, startBotAuthorizationJob, controlBotAuthorizationJob, type PoolBot, type BotAuthorizationJob } from "../lib/community";

export default function StockBotAuthorizations({ categoryId, categoryName, selectedIds, value, onChange, onBotsChange, sharedName, revision = 0, preview = false, disabled = false }: {
  categoryId: string; categoryName: string; selectedIds: string[]; value: string; onChange: (value: string) => void;
  onBotsChange: (bots: PoolBot[]) => void; sharedName?: string; revision?: number; preview?: boolean; disabled?: boolean;
}) {
  const [bots, setBots] = useState<PoolBot[]>(preview ? PREVIEW_POOL_BOTS : []);
  const [job, setJob] = useState<BotAuthorizationJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const generation = useRef(0);
  const finishedJob = useRef("");
  const callback = useRef(onBotsChange); callback.current = onBotsChange;
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void getCommunityBotPool(controller.signal).then(result => { if (!controller.signal.aborted) { setBots(result.bots); callback.current(result.bots); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load bot authorizations."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh, revision, preview]);
  useEffect(() => {
    generation.current++;
    setJob(null);
    if (!value || preview) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await getBotAuthorizationJob(value, controller.signal);
        if (controller.signal.aborted) return;
        setJob(result);
        if (result && ["completed", "cancelled"].includes(result.status) && finishedJob.current !== result.id) { finishedJob.current = result.id; setRefresh(current => current+1); }
        if (result && ["queued", "running"].includes(result.status)) timer = setTimeout(poll, 2500);
      } catch(reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load authorization progress."); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [value, refresh, preview]);
  const selectedBot = bots.find(bot => bot.clientId === value);
  const active = Boolean(job && ["queued", "running", "paused"].includes(job.status));
  async function act(action: "selected" | "category" | "resume" | "cancel") {
    if (!value || pending.current || preview) return;
    const requestGeneration = generation.current;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = action === "resume" || action === "cancel" ? await controlBotAuthorizationJob(value,action)
        : await startBotAuthorizationJob(value,categoryId,action === "selected" ? selectedIds : undefined);
      if (generation.current === requestGeneration) { setJob(result); setRefresh(current => current+1); }
    } catch(reason) { if (generation.current === requestGeneration) setError(reason instanceof Error ? reason.message : "Authorization could not start."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="app-panel-soft stock-bot-authorizations" aria-label="Stock bot authorizations">
    <div className="stock-bot-authorization-heading"><div><span className="field-label">Authorization bot</span><p className="settings-field-note">Accounts stay in shared stock. OAuth permissions are stored separately for each bot.</p></div>
      <FilterDropdown label="Authorization bot" showLabel={false} disabled={disabled || loading || busy} value={value} onChange={onChange} portal options={[
        { value: "", label: `Shared bot${sharedName ? ` · ${sharedName}` : ""}` }, ...bots.map(bot => ({ value: bot.clientId, label: `${bot.name}${bot.enabled ? "" : " · Disabled"}` }))
      ]} />
      <Button type="button" size="xs" variant="secondary" disabled={disabled || loading || busy} onClick={() => setRefresh(current=>current+1)}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} />Refresh</Button>
    </div>
    {error ? <p role="alert" className="text-sm text-[var(--app-danger)]">{error}</p> : null}
    {selectedBot ? <>
      <div className="stock-bot-authorization-actions"><Badge variant="secondary"><Bot />{selectedBot.authorizedAccounts || 0} authorized accounts</Badge><span>{selectedBot.activeAccounts || 0} unexpired · {selectedBot.expiredAccounts || 0} expired</span>
        <Button type="button" size="sm" variant="secondary" disabled={disabled || busy || active || !selectedIds.length} onClick={() => void act("selected")}><UserPlus className="h-3.5 w-3.5" />Authorize selected ({selectedIds.length})</Button>
        <Button type="button" size="sm" variant="secondary" disabled={disabled || busy || active || !categoryId} onClick={() => void act("category")}><UserPlus className="h-3.5 w-3.5" />Authorize {categoryName}</Button>
      </div>
      <p className="settings-field-note">Bulk authorization uses saved account tokens. Import stock adds this bot's OAuth grants to existing accounts in the selected category.</p>
    </> : <p className="settings-field-note">Import stock and Export stock currently use the shared bot. Select a pool bot to manage its OAuth grants.</p>}
    {job ? <div className="stock-bot-job" role="status"><span><strong>{job.status === "completed" ? "Authorization completed" : job.status === "paused" ? "Authorization paused" : job.status === "cancelled" ? "Authorization cancelled" : "Authorizing accounts"}</strong><small>{job.processed}/{job.total} processed · {job.succeeded} authorized · {job.failed} failed{job.categoryId !== categoryId ? ` · ${job.categoryId}` : ""}</small>{job.details ? <small>{job.details}</small> : null}</span>
      {job.status === "paused" ? <Button type="button" size="xs" variant="secondary" disabled={busy} onClick={() => void act("resume")}><Play className="h-3.5 w-3.5" />Resume</Button> : null}
      {active ? <Button type="button" size="xs" variant="dangerGhost" disabled={busy} onClick={() => void act("cancel")}><Square className="h-3.5 w-3.5" />Stop</Button> : null}
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
      {job.errors.length ? <details><summary>Authorization errors ({job.failed})</summary>{job.errors.map(item => <p key={item.userId}>{item.userId}: {item.message}</p>)}</details> : null}
    </div> : null}
  </section>;
}
