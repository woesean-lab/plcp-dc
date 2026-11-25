import toast from "react-hot-toast";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bot, Check, Globe2, LoaderCircle, Pencil, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { Input } from "./ui/input";
import { SecretField } from "./ui/secret-field";
import { BotDirectory, type DirectoryBot } from "./BotDirectory";
import { BotSettingsDialog } from "./BotSettingsDialog";
import { BotServersDialog } from "./BotServersDialog";
import { BotSyncDialog } from "./BotSyncDialog";
import { getCommunityBotPool, getBotOrderSettings, saveBotOrderSetting, saveCommunityPoolBot, type CommunityConfig, type PoolBot } from "../lib/community";

export const PREVIEW_POOL_BOTS: PoolBot[] = [
  { clientId: "1544546102458720276", name: "Members 01", avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png", enabled: true, activeOrders: 2, pendingMembers: 250, totalOrders: 6, deliveredMembers: 1200, authorizedAccounts: 750, activeAccounts: 700, expiredAccounts: 50, hasBotToken: true, hasClientSecret: true },
  { clientId: "1544546102458720277", name: "Members 02", avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png", enabled: true, activeOrders: 1, pendingMembers: 50, totalOrders: 3, deliveredMembers: 900, authorizedAccounts: 300, activeAccounts: 300, expiredAccounts: 0, hasBotToken: true, hasClientSecret: true },
  { clientId: "1544546102458720278", name: "Members 03", enabled: false, activeOrders: 0, pendingMembers: 0, totalOrders: 1, deliveredMembers: 100, hasBotToken: true, hasClientSecret: true }
];
const EMPTY = { name: "", botToken: "", clientSecret: "" };

export default function BotPoolSettings({ preview = false, defaultConfig, defaultEditor, disabled = false, onRefreshDefault, openDefaultServers = false }: {
  preview?: boolean;
  defaultConfig?: CommunityConfig | null;
  defaultEditor?: ReactNode | ((onCancel: () => void) => ReactNode);
  disabled?: boolean;
  onRefreshDefault?: () => void;
  openDefaultServers?: boolean;
}) {
  const id = useId();
  const [bots, setBots] = useState<PoolBot[]>(preview ? PREVIEW_POOL_BOTS : []);
  const [loading, setLoading] = useState(!preview);
  const [defaultUseForNewOrders, setDefaultUseForNewOrders] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<PoolBot | null>(null);
  const [editor, setEditor] = useState<"default" | "pool" | null>(null);
  const [servers, setServers] = useState<{ clientId: string; name: string } | null>(null);
  const [syncing, setSyncing] = useState<DirectoryBot | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState(EMPTY);
  const pending = useRef(false);
  const mounted = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editor === "pool") nameRef.current?.focus(); }, [editor, editing]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (openDefaultServers && defaultConfig?.clientId) setServers({ clientId: defaultConfig.clientId, name: defaultConfig.botName || "Default bot" });
  }, [openDefaultServers, defaultConfig?.clientId]);
  async function load() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError("");
    try {
      const [result, settings] = preview ? [{ bots }, { defaultUseForNewOrders }] : await Promise.all([getCommunityBotPool(), getBotOrderSettings()]);
      if (mounted.current) { setBots(result.bots); setDefaultUseForNewOrders(settings.defaultUseForNewOrders); }
    }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not load bot pool."); }
    finally { pending.current = false; if (mounted.current) setLoading(false); }
  }
  useEffect(() => { if (!preview) { setDefaultUseForNewOrders(false); void load(); } }, [preview, defaultConfig?.clientId]);
  function reset() { setDraft(EMPTY); setEditing(null); setEditor(null); }
  async function save() {
    if (pending.current || disabled || (!editing && (!draft.botToken.trim() || !draft.clientSecret.trim()))) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const result = preview ? { bots: editing ? bots.map(bot => bot.clientId === editing.clientId ? { ...bot, name: draft.name || bot.name } : bot)
        : [...bots, { ...PREVIEW_POOL_BOTS[0], clientId: String(Date.now()), name: draft.name || "Preview bot", activeOrders: 0, pendingMembers: 0, totalOrders: 0 }] }
        : await saveCommunityPoolBot(draft, editing?.clientId);
      if (mounted.current) { setBots(result.bots); reset(); toast.success(editing ? "Bot updated." : "Bot added to pool."); }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not save bot."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function toggle(bot: DirectoryBot, useForNewOrders: boolean) {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (!preview) await saveBotOrderSetting(bot.clientId, useForNewOrders);
      if (mounted.current) {
        if (bot.isDefault) setDefaultUseForNewOrders(useForNewOrders);
        else setBots(current => current.map(item => item.clientId === bot.clientId ? { ...item, enabled: useForNewOrders } : item));
        toast.success(`${bot.name} · New orders ${useForNewOrders ? "enabled" : "disabled"}.`);
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not update bot."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const config = defaultConfig;
  const rows: DirectoryBot[] = [
    ...(defaultEditor ? [{ clientId: config?.clientId || "default", name: config?.botName || "Default bot", avatarUrl: config?.botAvatarUrl,
      enabled: Boolean(config?.configured), isDefault: true, activeOrders: config?.activeOrders || 0, pendingMembers: config?.pendingMembers || 0, totalOrders: config?.totalOrders || 0, deliveredMembers: config?.deliveredMembers || 0,
      authorizedAccounts: config?.authorizedAccounts, activeAccounts: config?.activeAccounts,
      serverCount: config?.activeGuildCount == null ? undefined : `${config.activeGuildCountExact ? "" : "≥ "}${config.activeGuildCount}${config.serverLimit ? ` / ${config.serverLimit}` : ""}`,
      hasBotToken: Boolean(config?.hasBotToken), hasClientSecret: Boolean(config?.hasClientSecret) }] : []),
    ...bots.filter(bot => bot.clientId !== config?.clientId)
  ];
  const filtered = rows.filter(bot => `${bot.name} ${bot.clientId}`.toLowerCase().includes(search.trim().toLowerCase()));
  const locked = loading || busy || disabled;
  return <section className="app-panel settings-card" aria-labelledby={`${id}-title`} aria-busy={loading || busy}>
    <header className="settings-card-heading"><span className="monitor-panel-icon" aria-hidden="true"><Bot className="h-4 w-4" /></span>
      <div className="settings-card-title"><span className="app-kicker">Members delivery</span><h3 id={`${id}-title`}>Bots</h3></div>
      <div className="settings-heading-actions"><Button type="button" size="sm" variant="secondary" disabled={locked} onClick={() => { void load(); onRefreshDefault?.(); }}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} />Refresh</Button>
      <Button type="button" size="sm" disabled={locked} onClick={() => { reset(); setEditor("pool"); }}><Plus className="h-3.5 w-3.5" />Add bot</Button></div>
    </header>
    <div className="settings-card-body bot-pool-body">
      <div className="bot-directory-toolbar"><label className="community-member-search"><Search className="h-3.5 w-3.5" aria-hidden="true" /><Input type="search" aria-label="Search bots" placeholder="Search bots or application IDs" value={search} onChange={event => setSearch(event.target.value)} /></label><span>{rows.length} bots · {rows.filter(bot => bot.enabled && (!bot.isDefault || defaultUseForNewOrders)).length} for new orders</span></div>
      <p className="settings-field-note">Use for new orders controls participation. Among eligible bots, the fewest remaining members and then active orders determine assignment. Existing orders keep their assigned bot.</p>
      {error ? <div className="settings-load-error" role="alert"><span>{error}</span><Button type="button" size="xs" variant="secondary" disabled={busy || loading} onClick={() => void load()}>Retry</Button></div> : null}
      {loading || filtered.length ? <BotDirectory bots={filtered} loading={loading} accountActions={bot => bot.isDefault ? null : <Button type="button" size="xs" variant="secondary" aria-label={`Sync accounts for ${bot.name}`} aria-haspopup="dialog" disabled={locked || !bot.hasBotToken || !bot.hasClientSecret || (!preview && !config?.configured)} onClick={() => setSyncing(bot)}><RefreshCw className="h-3.5 w-3.5" />Sync</Button>} actions={bot => <>
        <Switch checked={bot.isDefault ? defaultUseForNewOrders : bot.enabled} aria-label={`Use ${bot.name} for new orders`} title={`New orders · ${(bot.isDefault ? defaultUseForNewOrders : bot.enabled) ? "On" : "Off"}`} disabled={locked || !bot.hasBotToken || !bot.hasClientSecret} onCheckedChange={checked => void toggle(bot, checked)} />
        <Button type="button" size="icon-sm" variant="secondary" aria-label={`Manage servers for ${bot.name}`} title="Manage servers" aria-haspopup="dialog" disabled={locked || !bot.hasBotToken} onClick={() => setServers({ clientId: bot.clientId, name: bot.name })}><Globe2 className="h-3.5 w-3.5" /></Button>
        <Button type="button" size="icon-sm" variant="secondary" aria-label={`Edit ${bot.name}`} title="Edit bot" aria-haspopup="dialog" disabled={locked} onClick={() => { setEditing(bot.isDefault ? null : bot); setEditor(bot.isDefault ? "default" : "pool"); setDraft({ ...EMPTY, name: bot.name }); }}><Pencil className="h-3.5 w-3.5" /></Button>
      </>} /> : !error ? <div className="stock-empty-state settings-empty"><Bot className="h-6 w-6" /><strong>{search ? "No matching bots" : "No bots yet"}</strong><span>{search ? "Try another name or application ID." : "Add a bot to enable automatic assignment."}</span></div> : null}
    </div>
    {editor ? <BotSettingsDialog title={editor === "default" ? "Edit default bot" : editing ? `Edit ${editing.name}` : "Add bot"} busy={busy || disabled} onClose={reset}>
      {error ? <div className="settings-load-error" role="alert">{error}</div> : null}
      {editor === "default" ? typeof defaultEditor === "function" ? defaultEditor(reset) : defaultEditor : <form className="settings-connection-form" aria-label={editing ? "Edit pool bot" : "Add pool bot"} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="settings-card-body settings-field-grid">
        <label className="settings-field"><span className="field-label">Bot label</span><Input ref={nameRef} value={draft.name} maxLength={100} placeholder="Uses the bot name if empty" disabled={locked} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label className="settings-field"><span className="field-label">OAuth redirect URL</span><Input readOnly value={`${window.location.origin}/api/community/oauth/callback`} /></label>
        <SecretField label="Bot token" saved={Boolean(editing)} disabled={locked} value={draft.botToken} autoComplete="new-password" placeholder={editing ? "Keep saved value" : "Discord bot token"} onChange={event => setDraft(current => ({ ...current, botToken: event.target.value }))} />
        <SecretField label="Client secret" saved={Boolean(editing)} disabled={locked} value={draft.clientSecret} autoComplete="new-password" placeholder={editing ? "Keep saved value" : "Discord client secret"} onChange={event => setDraft(current => ({ ...current, clientSecret: event.target.value }))} />
        <p className="settings-field-note bot-pool-full-width">Register this redirect URL in the application's OAuth2 settings. Client ID and bot name are detected from the token.</p>
      </div>
      <footer className="settings-card-footer"><div><Button type="button" size="sm" variant="secondary" disabled={locked} onClick={reset}>Cancel</Button><Button type="submit" size="sm" disabled={locked || (!editing && (!draft.botToken.trim() || !draft.clientSecret.trim()))}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : editing ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{busy ? "Verifying…" : editing ? "Save bot" : "Verify & add bot"}</Button></div></footer>
    </form>}
    </BotSettingsDialog> : null}
    {servers ? <BotServersDialog {...servers} preview={preview} onClose={() => setServers(null)} onChanged={() => { void load(); onRefreshDefault?.(); }} /> : null}
    {syncing ? <BotSyncDialog clientId={syncing.clientId} name={syncing.name} preview={preview} onClose={() => setSyncing(null)} onChanged={() => void load()} /> : null}

  </section>;
}
