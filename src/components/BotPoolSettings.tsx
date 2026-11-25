import { useEffect, useId, useRef, useState } from "react";
import { Bot, Check, LoaderCircle, Pencil, Plus, Power, RefreshCw, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SecretField } from "./ui/secret-field";
import { PaginatedList } from "./ListPagination";
import { getCommunityBotPool, saveCommunityPoolBot, setCommunityPoolBotEnabled, type PoolBot } from "../lib/community";

export const PREVIEW_POOL_BOTS: PoolBot[] = [
  { clientId: "1544546102458720276", name: "Members 01", enabled: true, activeOrders: 2, pendingMembers: 250, totalOrders: 6, authorizedAccounts: 750, activeAccounts: 700, expiredAccounts: 50, hasBotToken: true, hasClientSecret: true },
  { clientId: "1544546102458720277", name: "Members 02", enabled: true, activeOrders: 1, pendingMembers: 50, totalOrders: 3, authorizedAccounts: 300, activeAccounts: 300, expiredAccounts: 0, hasBotToken: true, hasClientSecret: true },
  { clientId: "1544546102458720278", name: "Members 03", enabled: false, activeOrders: 0, pendingMembers: 0, totalOrders: 1, hasBotToken: true, hasClientSecret: true }
];
const EMPTY = { name: "", botToken: "", clientSecret: "" };

export default function BotPoolSettings({ preview = false }: { preview?: boolean }) {
  const id = useId();
  const [bots, setBots] = useState<PoolBot[]>(preview ? PREVIEW_POOL_BOTS : []);
  const [loading, setLoading] = useState(!preview);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<PoolBot | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const pending = useRef(false);
  const mounted = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load() {
    if (pending.current) return;
    pending.current = true; setLoading(true); setError("");
    try { const result = preview ? { bots } : await getCommunityBotPool(); if (mounted.current) setBots(result.bots); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not load bot pool."); }
    finally { pending.current = false; if (mounted.current) setLoading(false); }
  }
  useEffect(() => { if (!preview) void load(); }, [preview]);
  function reset() { setDraft(EMPTY); setEditing(null); }
  async function save() {
    if (pending.current || (!editing && (!draft.botToken.trim() || !draft.clientSecret.trim()))) return;
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
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = preview ? { bots: bots.map(item => item.clientId === bot.clientId ? { ...item, enabled: !item.enabled } : item) }
        : await setCommunityPoolBotEnabled(bot.clientId, !bot.enabled);
      if (mounted.current) setBots(result.bots);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not update bot."); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="app-panel settings-card" aria-labelledby={`${id}-title`} aria-busy={loading || busy}>
    <header className="settings-card-heading"><span className="monitor-panel-icon" aria-hidden="true"><Bot className="h-4 w-4" /></span>
      <div className="settings-card-title"><span className="app-kicker">Members delivery</span><h3 id={`${id}-title`}>Bot pool</h3></div>
      <Badge variant="secondary">{bots.filter(bot => bot.enabled).length} enabled</Badge>
      <Button type="button" size="sm" variant="secondary" disabled={loading || busy} onClick={() => void load()}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} />Refresh</Button>
    </header>
    <div className="settings-card-body bot-pool-body">
      <p className="settings-field-note">New orders use the enabled bot with the fewest remaining deliveries. Existing orders keep their assigned bot.</p>
      {error ? <div className="settings-load-error" role="alert"><span>{error}</span><Button type="button" size="xs" variant="secondary" disabled={busy || loading} onClick={() => void load()}>Retry</Button></div> : null}
      {notice ? <p className="settings-field-note" role="status">{notice}</p> : null}
      {loading ? <p className="settings-refreshing" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />Loading bot pool…</p> : bots.length ?
        <div className="community-recent-list"><PaginatedList items={bots} label="Bot pool pages">{items => <>{items.map(bot => <div className="bot-pool-row" key={bot.clientId}>
          <span className="monitor-panel-icon" aria-hidden="true"><Bot className="h-4 w-4" /></span>
          <span className="bot-pool-row-copy"><strong>{bot.name}</strong><small>{bot.clientId}</small><small>{bot.authorizedAccounts || 0} authorized accounts · {bot.activeAccounts || 0} unexpired · {bot.expiredAccounts || 0} expired</small><small>{bot.activeOrders} active orders · {bot.pendingMembers} members remaining · {bot.totalOrders} total orders</small></span>
          <Badge variant={bot.enabled ? "success" : "secondary"}>{bot.enabled ? "Enabled" : "Disabled"}</Badge>
          <span className="community-member-row-actions">
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Edit ${bot.name}`} disabled={busy || loading} onClick={() => { setEditing(bot); setDraft({ ...EMPTY, name: bot.name }); setNotice(""); nameRef.current?.focus(); }}><Pencil className="h-3.5 w-3.5" /></Button>
            <Button type="button" size="icon-sm" variant={bot.enabled ? "dangerGhost" : "ghost"} aria-label={`${bot.enabled ? "Disable" : "Enable"} ${bot.name}`} title={bot.enabled ? "Disable for new orders" : "Enable for new orders"} disabled={busy || loading} onClick={() => void toggle(bot)}><Power className="h-3.5 w-3.5" /></Button>
          </span>
        </div>)}</>}</PaginatedList></div> : !error ? <div className="stock-empty-state settings-empty"><Bot className="h-6 w-6" /><strong>No pool bots yet</strong><span>Add a bot to enable automatic assignment.</span></div> : null}
    </div>
    <form className="settings-connection-form" aria-label={editing ? "Edit pool bot" : "Add pool bot"} onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="settings-card-body settings-field-grid">
        <label className="settings-field"><span className="field-label">Bot label</span><Input ref={nameRef} value={draft.name} maxLength={100} placeholder="Uses the bot name if empty" disabled={busy || loading} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label className="settings-field"><span className="field-label">OAuth redirect URL</span><Input readOnly value={`${window.location.origin}/api/community/oauth/callback`} /></label>
        <SecretField label="Bot token" saved={Boolean(editing)} disabled={busy || loading} value={draft.botToken} autoComplete="new-password" placeholder={editing ? "Keep saved value" : "Discord bot token"} onChange={event => setDraft(current => ({ ...current, botToken: event.target.value }))} />
        <SecretField label="Client secret" saved={Boolean(editing)} disabled={busy || loading} value={draft.clientSecret} autoComplete="new-password" placeholder={editing ? "Keep saved value" : "Discord client secret"} onChange={event => setDraft(current => ({ ...current, clientSecret: event.target.value }))} />
        <p className="settings-field-note bot-pool-full-width">Register this redirect URL in the application's OAuth2 settings. Client ID and bot name are detected from the token.</p>
      </div>
      <footer className="settings-card-footer"><div><Button type="submit" size="sm" disabled={busy || loading || (!editing && (!draft.botToken.trim() || !draft.clientSecret.trim()))}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : editing ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{busy ? "Verifying…" : editing ? "Save bot" : "Verify & add bot"}</Button>
        {editing || Object.values(draft).some(Boolean) ? <Button type="button" size="sm" variant="ghost" disabled={busy || loading} onClick={reset}><X className="h-3.5 w-3.5" />{editing ? "Cancel edit" : "Reset"}</Button> : null}</div></footer>
    </form>
  </section>;
}
