import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Globe2, LoaderCircle, LogOut, RefreshCw, Search } from "lucide-react";
import { getCommunityBotGuilds, getCommunityGuildLeaveProgress, leaveCommunityBotGuilds, type CommunityBotGuild } from "../lib/community";
import { BotSettingsDialog } from "./BotSettingsDialog";
import { PaginatedList } from "./ListPagination";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";

export function BotServersDialog({ clientId, name, onClose, preview = false, onChanged }: {
  clientId: string; name: string; onClose: () => void; preview?: boolean; onChanged: () => void;
}) {
  const [guilds, setGuilds] = useState<CommunityBotGuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [exact, setExact] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const pending = useRef(false);
  const request = useRef<AbortController>();
  async function load() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const result = preview ? { exact: true, guilds: Array.from({ length: 3 }, (_, i) => ({ id: `23456789012345678${i}`, name: `Sample server ${i + 1}`, iconUrl: null, configured: i === 0, activeOrderCount: i === 1 ? 1 : 0, activeOrderStatuses: [] })) } : await getCommunityBotGuilds(clientId, controller.signal);
      if (controller.signal.aborted) return;
      setGuilds(result.guilds); setExact(result.exact); setSelected(current => current.filter(id => result.guilds.some(guild => guild.id === id)));
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load servers."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  useEffect(() => { void load(); return () => request.current?.abort(); }, [clientId, preview]);
  useEffect(() => {
    if (!busy || preview) return;
    let active = true, polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try { const next = await getCommunityGuildLeaveProgress(clientId); if (active && next.total) setProgress(next); }
      catch { /* The write response remains authoritative if progress polling fails. */ }
      finally { polling = false; }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, clientId, preview]);
  const visible = useMemo(() => guilds.filter(guild => `${guild.name} ${guild.id}`.toLowerCase().includes(search.trim().toLowerCase())), [guilds, search]);
  const selectedGuilds = guilds.filter(guild => selected.includes(guild.id));
  async function leave() {
    if (pending.current || !selected.length || !exact) return;
    pending.current = true; setBusy(true); setProgress({ completed: 0, total: selected.length }); setError(""); setNotice("");
    try {
      const result = preview ? { left: selected.length, alreadyLeftGuildIds: [], leftGuildIds: selected, failed: 0 }
        : await leaveCommunityBotGuilds(selected, clientId);
      const removed = new Set([...result.leftGuildIds, ...result.alreadyLeftGuildIds]);
      setGuilds(current => current.filter(guild => !removed.has(guild.id)));
      setSelected(current => current.filter(id => !removed.has(id)));
      setConfirming(false); setNotice(`${removed.size} servers removed.${result.failed ? ` ${result.failed} failed; retry the selected servers.` : ""}`); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not leave servers."); }
    finally { pending.current = false; setBusy(false); }
  }
  return <BotSettingsDialog title={`${name} · Servers`} busy={busy} onClose={onClose}>
    <div className="settings-guild-toolbar"><label className="settings-guild-search"><Search className="h-3.5 w-3.5" /><Input autoFocus type="search" aria-label="Search bot servers" placeholder="Search servers or IDs" value={search} disabled={busy || confirming} onChange={event => setSearch(event.target.value)} /></label><Button type="button" size="icon-sm" variant="ghost" aria-label="Refresh servers" disabled={loading || busy || confirming} onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5" /></Button><Button asChild size="sm" variant="secondary" disabled={busy}><a href={`https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot&permissions=0`} onClick={event => { if (preview || busy) event.preventDefault(); }} aria-disabled={busy} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Add to server</a></Button></div>
    {error ? <div className="settings-load-error" role="alert"><span>{error}</span>{!confirming ? <Button size="xs" variant="secondary" disabled={busy || loading} onClick={() => void load()}>Retry</Button> : null}</div> : null}
    {notice ? <p className="settings-form-meta" role="status">{notice}</p> : null}
    {loading ? <BotServersSkeleton /> : confirming ? <div className="settings-card-body"><p className="settings-field-note">Remove this bot from {selected.length} selected servers? Deliveries and access in those servers will be affected.</p><div className="bot-server-confirm-list">{selectedGuilds.map(guild => <div key={guild.id}><strong>{guild.name}</strong>{guild.configured ? <Badge variant="secondary">Stock server</Badge> : null}{guild.activeOrderCount ? <Badge variant="destructive">{guild.activeOrderCount} active orders</Badge> : null}</div>)}</div></div> : <>
      <div className="settings-guild-toolbar"><span>{guilds.length} servers</span><Button size="xs" variant="secondary" disabled={!visible.length || busy} onClick={() => setSelected(Array.from(new Set([...selected, ...visible.map(guild => guild.id)])).slice(0, 200))}>Select all</Button><Button size="xs" variant="ghost" disabled={!selected.length || busy} onClick={() => setSelected([])}>Clear</Button></div>
      {!exact && !error ? <p className="settings-form-meta" role="alert">Server list is incomplete. Refresh before removing servers.</p> : null}
      <div className="settings-guild-list"><PaginatedList key={search} items={visible} label="Bot server pages">{items => <>{items.map(guild => <button key={guild.id} type="button" className="community-guild-row" role="checkbox" aria-checked={selected.includes(guild.id)} data-selected={selected.includes(guild.id)} disabled={busy} onClick={() => setSelected(current => current.includes(guild.id) ? current.filter(id => id !== guild.id) : current.length < 200 ? [...current, guild.id] : current)}><span className="community-guild-check">{selected.includes(guild.id) ? <Check className="h-3.5 w-3.5" /> : null}</span><span className="community-guild-avatar">{guild.iconUrl ? <img src={guild.iconUrl} alt="" /> : <Globe2 className="h-4 w-4" />}</span><span className="community-guild-copy"><strong>{guild.name}</strong><small>{guild.id}{guild.configured ? " · Stock server" : ""}{guild.activeOrderCount ? ` · ${guild.activeOrderCount} active orders` : ""}</small></span></button>)}</>}</PaginatedList>{!visible.length && !error ? <div className="stock-empty-state settings-empty"><Globe2 className="h-6 w-6" /><strong>{search ? "No matching servers" : "No servers found"}</strong></div> : null}</div>
    </>}
    {busy ? <div className="settings-leave-progress" role="status"><LoaderCircle className="h-4 w-4 animate-spin" /><span><strong>Leaving servers</strong><small>{progress.completed} of {progress.total} processed</small></span><div className="monitor-live-progress-track" role="progressbar" aria-label="Server removal" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.completed}><span style={{ width: `${progress.total ? Math.min(100, progress.completed / progress.total * 100) : 0}%` }} /></div></div> : null}
    <footer className="settings-card-footer"><span className="settings-selection-count"><strong>{selected.length}</strong> selected</span><div>{confirming ? <Button autoFocus size="sm" variant="secondary" disabled={busy} onClick={() => { setConfirming(false); setError(""); }}>Cancel</Button> : null}<Button size="sm" variant="dangerGhost" disabled={loading || busy || !exact || !selected.length} onClick={() => confirming ? void leave() : setConfirming(true)}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}{busy ? "Leaving…" : confirming ? "Confirm removal" : "Leave selected"}</Button></div></footer>
  </BotSettingsDialog>;
}

export function BotServersSkeleton() {
  return <div className="settings-card-body" role="status" aria-label="Loading servers" aria-busy="true">{[0, 1, 2, 3].map(index => <div className="bot-server-skeleton-row" key={index}><Skeleton className="h-4 w-4" /><Skeleton className="h-9 w-9 rounded-lg" /><div><Skeleton className="h-3 w-40 max-w-full" /><Skeleton className="mt-2 h-3 w-28 max-w-full" /></div></div>)}</div>;
}
