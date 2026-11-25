import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bot, Check, Globe2, LoaderCircle, Pencil, Plus, Power, RadioTower, RefreshCw } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SecretField } from "./ui/secret-field";
import { PaginatedList } from "./ListPagination";
import { Skeleton } from "./ui/skeleton";
import { BotSettingsDialog } from "./BotSettingsDialog";
import { BotServersDialog } from "./BotServersDialog";
import { connectCommunityBotOnliner, getCommunityBotsOnliner, getCommunityBotPool, saveCommunityPoolBot, setCommunityPoolBotEnabled, type BotOnlinerStatus, type CommunityConfig, type PoolBot } from "../lib/community";

export const PREVIEW_POOL_BOTS: PoolBot[] = [
  { clientId: "1544546102458720276", name: "Members 01", avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png", enabled: true, activeOrders: 2, pendingMembers: 250, totalOrders: 6, authorizedAccounts: 750, activeAccounts: 700, expiredAccounts: 50, hasBotToken: true, hasClientSecret: true },
  { clientId: "1544546102458720277", name: "Members 02", avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png", enabled: true, activeOrders: 1, pendingMembers: 50, totalOrders: 3, authorizedAccounts: 300, activeAccounts: 300, expiredAccounts: 0, hasBotToken: true, hasClientSecret: true },
  { clientId: "1544546102458720278", name: "Members 03", enabled: false, activeOrders: 0, pendingMembers: 0, totalOrders: 1, hasBotToken: true, hasClientSecret: true }
];
const EMPTY = { name: "", botToken: "", clientSecret: "" };

export default function BotPoolSettings({ preview = false, defaultConfig, defaultEditor, disabled = false, onRefreshDefault, openDefaultServers = false }: {
  preview?: boolean;
  defaultConfig?: CommunityConfig | null;
  defaultEditor?: ReactNode;
  disabled?: boolean;
  onRefreshDefault?: () => void;
  openDefaultServers?: boolean;
}) {
  const id = useId();
  const [bots, setBots] = useState<PoolBot[]>(preview ? PREVIEW_POOL_BOTS : []);
  const [loading, setLoading] = useState(!preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<PoolBot | null>(null);
  const [editor, setEditor] = useState<"default" | "pool" | null>(null);
  const [servers, setServers] = useState<{ clientId: string; name: string } | null>(null);
  const [onliner, setOnliner] = useState<BotOnlinerStatus[]>([]);
  const [onlinerRevision, setOnlinerRevision] = useState(0);
  const [draft, setDraft] = useState(EMPTY);
  const pending = useRef(false);
  const mounted = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editor === "pool") nameRef.current?.focus(); }, [editor, editing]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const botIds = [defaultConfig?.clientId, ...bots.map(bot => bot.clientId)].filter(Boolean).join(",");
  useEffect(() => {
    if (!botIds || preview) return;
    const controller = new AbortController();
    const refresh = () => { void getCommunityBotsOnliner(botIds.split(","), controller.signal).then(result => {
      if (!controller.signal.aborted) setOnliner(result.bots);
    }).catch(() => {}); };
    refresh(); const timer = window.setInterval(refresh, 15_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [botIds, preview, onlinerRevision]);
  useEffect(() => {
    if (openDefaultServers && defaultConfig?.clientId) setServers({ clientId: defaultConfig.clientId, name: defaultConfig.botName || "Default bot" });
  }, [openDefaultServers, defaultConfig?.clientId]);
  async function load() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError("");
    try { const result = preview ? { bots } : await getCommunityBotPool(); if (mounted.current) setBots(result.bots); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not load bot pool."); }
    finally { pending.current = false; if (mounted.current) setLoading(false); }
  }
  useEffect(() => { if (!preview) void load(); }, [preview]);
  function reset() { setDraft(EMPTY); setEditing(null); setEditor(null); }
  async function save() {
    if (pending.current || disabled || (!editing && (!draft.botToken.trim() || !draft.clientSecret.trim()))) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = preview ? { bots: editing ? bots.map(bot => bot.clientId === editing.clientId ? { ...bot, name: draft.name || bot.name } : bot)
        : [...bots, { ...PREVIEW_POOL_BOTS[0], clientId: String(Date.now()), name: draft.name || "Preview bot", activeOrders: 0, pendingMembers: 0, totalOrders: 0 }] }
        : await saveCommunityPoolBot(draft, editing?.clientId);
      if (mounted.current) { setBots(result.bots); reset(); setNotice(editing ? "Bot updated." : "Bot added to pool."); }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not save bot."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function toggle(bot: PoolBot) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = preview ? { bots: bots.map(item => item.clientId === bot.clientId ? { ...item, enabled: !item.enabled } : item) }
        : await setCommunityPoolBotEnabled(bot.clientId, !bot.enabled);
      if (mounted.current) setBots(result.bots);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not update bot."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function connectOnliner(bot: PoolBot) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = preview ? { linked: true, enabled: true, clientId: bot.clientId } : await connectCommunityBotOnliner(bot.clientId);
      if (mounted.current) {
        setOnliner(current => [...current.filter(item => item.clientId !== bot.clientId), { clientId: bot.clientId, linked: true, state: result.enabled ? "connecting" : "disabled" }]);
        setOnlinerRevision(current => current + 1);
        setNotice(result.enabled ? `${bot.name} linked to Onliner. Connection status updates here.` : `${bot.name} linked. Start Onliner to connect it.`);
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not connect bot to Onliner."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const config = defaultConfig;
  const rows: Array<PoolBot & { isDefault?: boolean }> = [
    ...(defaultEditor ? [{ clientId: config?.clientId || "default", name: config?.botName || "Default bot", avatarUrl: config?.botAvatarUrl,
      enabled: Boolean(config?.configured), isDefault: true, activeOrders: 0, pendingMembers: 0, totalOrders: 0,
      authorizedAccounts: config?.authorizedAccounts, activeAccounts: config?.activeAccounts,
      hasBotToken: Boolean(config?.hasBotToken), hasClientSecret: Boolean(config?.hasClientSecret) }] : []),
    ...bots.filter(bot => bot.clientId !== config?.clientId)
  ];
  const locked = loading || busy || disabled;
  return <section className="app-panel settings-card" aria-labelledby={`${id}-title`} aria-busy={loading || busy}>
    <header className="settings-card-heading"><span className="monitor-panel-icon" aria-hidden="true"><Bot className="h-4 w-4" /></span>
      <div className="settings-card-title"><span className="app-kicker">Members delivery</span><h3 id={`${id}-title`}>Bots</h3></div>
      <div className="settings-heading-actions"><Button type="button" size="sm" variant="secondary" disabled={locked} onClick={() => { void load(); onRefreshDefault?.(); }}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} />Refresh</Button>
      <Button type="button" size="sm" disabled={locked} onClick={() => { reset(); setEditor("pool"); setNotice(""); }}><Plus className="h-3.5 w-3.5" />Add bot</Button></div>
    </header>
    <div className="settings-card-body bot-pool-body">
      <p className="settings-field-note">Pool orders use the enabled bot with the fewest remaining deliveries. Existing orders keep their assigned bot.</p>
      {error ? <div className="settings-load-error" role="alert"><span>{error}</span><Button type="button" size="xs" variant="secondary" disabled={busy || loading} onClick={() => void load()}>Retry</Button></div> : null}
      {notice ? <p className="settings-field-note" role="status">{notice}</p> : null}
      {loading ? <BotsSkeleton /> : null}
      {!loading && rows.length ? <div className="app-panel-soft bot-settings-list"><PaginatedList items={rows} label="Bot pages">{items => <>{items.map(bot => <div className="bot-pool-row" key={bot.isDefault ? "default" : bot.clientId}>
          <BotAvatar url={bot.avatarUrl} />
          <div className="bot-pool-row-copy">
            <div className="bot-pool-row-title"><strong>{bot.name}</strong>{bot.isDefault ? <Badge variant="secondary">Default</Badge> : null}<Badge variant={bot.enabled ? "success" : "secondary"}>{bot.isDefault ? bot.enabled ? "Configured" : "Not configured" : bot.enabled ? "Enabled" : "Disabled"}</Badge>{onliner.find(item => item.clientId === bot.clientId) ? <Badge variant={onliner.find(item => item.clientId === bot.clientId)?.state === "connected" ? "success" : "secondary"}>Onliner · {onliner.find(item => item.clientId === bot.clientId)?.state}</Badge> : null}</div>
            <small>{bot.clientId === "default" ? "Set up the default Members bot" : bot.clientId}</small>
            <div className="bot-pool-row-stats"><span><strong>{(bot.authorizedAccounts || 0).toLocaleString("en-US")}</strong> authorized accounts</span><span><strong>{(bot.activeAccounts || 0).toLocaleString("en-US")}</strong> unexpired</span>{bot.isDefault ? config?.activeGuildCount != null ? <span><strong>{config.activeGuildCountExact ? "" : "≥ "}{config.activeGuildCount}{config.serverLimit ? ` / ${config.serverLimit}` : ""}</strong> servers</span> : null : <><span><strong>{bot.activeOrders}</strong> active orders</span><span><strong>{bot.pendingMembers.toLocaleString("en-US")}</strong> remaining</span></>}</div>
          </div>
          <span className="community-member-row-actions">
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Manage servers for ${bot.name}`} title="Manage servers" aria-haspopup="dialog" disabled={locked || !bot.hasBotToken} onClick={() => setServers({ clientId: bot.clientId, name: bot.name })}><Globe2 className="h-3.5 w-3.5" /></Button>
            <Button type="button" size="icon-sm" variant="accentGhost" aria-label={`Connect ${bot.name} to Onliner`} title={onliner.find(item => item.clientId === bot.clientId)?.state === "connected" ? "Connected to Onliner" : "Connect to Onliner"} disabled={locked || !bot.hasBotToken || onliner.some(item => item.clientId === bot.clientId && item.state === "connected")} onClick={() => void connectOnliner(bot)}><RadioTower className="h-3.5 w-3.5" /></Button>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Edit ${bot.name}`} title="Edit bot" disabled={locked} onClick={() => { setEditing(bot.isDefault ? null : bot); setEditor(bot.isDefault ? "default" : "pool"); setDraft({ ...EMPTY, name: bot.name }); setNotice(""); }}><Pencil className="h-3.5 w-3.5" /></Button>
            {!bot.isDefault ? <Button type="button" size="icon-sm" variant={bot.enabled ? "dangerGhost" : "ghost"} aria-label={`${bot.enabled ? "Disable" : "Enable"} ${bot.name}`} title={bot.enabled ? "Disable for new orders" : "Enable for new orders"} disabled={locked} onClick={() => void toggle(bot)}><Power className="h-3.5 w-3.5" /></Button> : null}
          </span>
        </div>)}</>}</PaginatedList></div> : !error && !loading ? <div className="stock-empty-state settings-empty"><Bot className="h-6 w-6" /><strong>No bots yet</strong><span>Add a bot to enable automatic assignment.</span></div> : null}
    </div>
    {editor ? <BotSettingsDialog title={editor === "default" ? "Edit default bot" : editing ? `Edit ${editing.name}` : "Add bot"} busy={busy || disabled} onClose={reset}>
      {error ? <div className="settings-load-error" role="alert">{error}</div> : null}
      {editor === "default" ? defaultEditor : <form className="settings-connection-form" aria-label={editing ? "Edit pool bot" : "Add pool bot"} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="settings-card-body settings-field-grid">
        <label className="settings-field"><span className="field-label">Bot label</span><Input ref={nameRef} value={draft.name} maxLength={100} placeholder="Uses the bot name if empty" disabled={locked} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label className="settings-field"><span className="field-label">OAuth redirect URL</span><Input readOnly value={`${window.location.origin}/api/community/oauth/callback`} /></label>
        <SecretField label="Bot token" saved={Boolean(editing)} disabled={locked} value={draft.botToken} autoComplete="new-password" placeholder={editing ? "Keep saved value" : "Discord bot token"} onChange={event => setDraft(current => ({ ...current, botToken: event.target.value }))} />
        <SecretField label="Client secret" saved={Boolean(editing)} disabled={locked} value={draft.clientSecret} autoComplete="new-password" placeholder={editing ? "Keep saved value" : "Discord client secret"} onChange={event => setDraft(current => ({ ...current, clientSecret: event.target.value }))} />
        <p className="settings-field-note bot-pool-full-width">Register this redirect URL in the application's OAuth2 settings. Client ID and bot name are detected from the token.</p>
      </div>
      <footer className="settings-card-footer"><div><Button type="submit" size="sm" disabled={locked || (!editing && (!draft.botToken.trim() || !draft.clientSecret.trim()))}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : editing ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{busy ? "Verifying…" : editing ? "Save bot" : "Verify & add bot"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={reset}>Cancel</Button></div></footer>
    </form>}
    </BotSettingsDialog> : null}
    {servers ? <BotServersDialog {...servers} preview={preview} onClose={() => setServers(null)} onChanged={() => { void load(); onRefreshDefault?.(); }} /> : null}
  </section>;
}

function BotsSkeleton() {
  return <div className="app-panel-soft" role="status" aria-label="Loading bots" aria-busy="true">{[0, 1].map(index => <div className="bot-pool-row" key={index}><Skeleton className="h-9 w-9 rounded-lg" /><div className="bot-pool-row-copy"><Skeleton className="h-4 w-40 max-w-full" /><Skeleton className="h-3 w-32 max-w-full" /><Skeleton className="h-3 w-64 max-w-full" /></div><Skeleton className="h-8 w-16" /></div>)}</div>;
}

function BotAvatar({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className="settings-bot-avatar" aria-hidden="true">{url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : <Bot className="h-5 w-5" />}</span>;
}
