import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleHelp, Copy, ExternalLink, FileJson, Gem, Layers3, LoaderCircle, Plus, Power, RadioTower, RefreshCw, Search, Server, ShieldCheck, Star, Timer, Trash2, TriangleAlert, Users } from "lucide-react";
import toast from "react-hot-toast";
import { Button, type ButtonProps } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { StatusField } from "../components/ui/status-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { FilterDropdown } from "../components/ui/filter-dropdown";
import { Skeleton } from "../components/ui/skeleton";
import { ListPagination, paginate } from "../components/ListPagination";
import { AutoLeaveActionButton } from "../components/AutoLeaveActionButton";
import { ReactionPanel, REACTION_MIXED_VALUE, type ReactionPanelRequest } from "../components/ReactionPanel";
import { OrderReactionOption } from "../components/OrderReactionOption";
import { OrderReactionAccessCard } from "../components/OrderReactionAccessCard";
import { MemberDeliveryAccordion, MemberDeliveryRow } from "../components/MemberDeliveryRow";
import { MemberDeliveryPanel } from "../components/MemberDeliveryPanel";
import { OrderDetailDisclosure } from "../components/OrderDetailDisclosure";
import { OrderDetailsLayout } from "../components/OrderDetailsLayout";
import { HumanizerRunHeader } from "../components/HumanizerRunHeader";
import { MemberActivityAvatar } from "../components/MemberActivityAvatar";
import SettingsWorkspace from "../components/SettingsWorkspace";
import { StockWorkspace } from "../components/StockWorkspace";
import { MembersStockBadges, MembersStockBulkActions, MembersStockMetadata, MembersStockCategory, MembersStockImportDialog, MembersStockRow, MembersStockSecret, MembersStockSummary } from "../components/MembersStockWorkspace";
import type { CommunityJoinRecord, CommunityStockCategory } from "../lib/community";
import { ProfileAvatarButton, ProfileDialog } from "../components/ProfileDialog";
import { useMemberLogOrder } from "../lib/use-member-log-order";
import type { HumanizerJob } from "../lib/humanizer";
import type { CommunityMemberResult } from "../types";
import "../components/OrdersWorkspace.css";
import "./UiKitPage.css";

const SECTIONS = [
  { id: "buttons", title: "Buttons & actions", tags: "members stock icon loading disabled hover auto leave leave all started completed" },
  { id: "tabs", title: "Tabs & navigation", tags: "stock duration categories selected" },
  { id: "fields", title: "Fields & filters", tags: "input search dropdown checkbox toggle" },
  { id: "badges", title: "Status badges", tags: "active inactive onliner presence servers" },
  { id: "panels", title: "Cards & surfaces", tags: "panel card background" },
  { id: "lists", title: "Lists & pagination", tags: "members stock select rows per page back next" },
  { id: "feedback", title: "Alerts & feedback", tags: "warning danger progress loading skeleton empty reaction daily monitor humanizer stop run stopping stopped" },
  { id: "overlays", title: "Dialogs & tooltips", tags: "modal confirmation help popup" },
  { id: "tokens", title: "Colors & typography", tags: "theme text accent border variables" }
] as const;

const BUTTONS: { variant: ButtonProps["variant"]; label: string }[] = [
  { variant: "default", label: "Primary" }, { variant: "secondary", label: "Secondary" },
  { variant: "outline", label: "Outline" }, { variant: "ghost", label: "Ghost" },
  { variant: "accentGhost", label: "Accent ghost" },
  { variant: "destructive", label: "Destructive" }, { variant: "dangerGhost", label: "Danger ghost" },
  { variant: "link", label: "Link" }
];

const COLORS = [
  "--app-bg", "--app-bg-deep", "--app-surface", "--app-surface-raised", "--app-surface-soft",
  "--app-input-bg", "--app-control-bg", "--app-hover", "--app-hover-strong", "--app-border",
  "--app-border-strong", "--app-text", "--app-text-secondary", "--app-muted", "--app-subtle",
  "--app-accent", "--app-accent-bright", "--app-accent-soft", "--app-success", "--app-success-soft",
  "--app-danger", "--app-danger-soft"
];

function Example({ title, source, code, children }: { title: string; source: string; code: string; children: ReactNode }) {
  async function copyCode() {
    try { await navigator.clipboard.writeText(code); toast.success("Code copied"); }
    catch { toast.error("Copy unavailable. You can select the code below."); }
  }
  return <div className="ui-ref-example">
    <div className="ui-ref-example-heading"><h3>{title}</h3><code>{source}</code></div>
    <div className="ui-ref-preview">{children}</div>
    <details className="ui-ref-code">
      <summary>View usage</summary>
      <div className="payload-panel"><Button type="button" variant="secondary" size="xs" onClick={() => void copyCode()}><Copy className="h-3.5 w-3.5" />Copy code</Button><pre><code>{code}</code></pre></div>
    </details>
  </div>;
}

function Section({ id, children }: { id: typeof SECTIONS[number]["id"]; children: ReactNode }) {
  const section = SECTIONS.find((item) => item.id === id)!;
  return <section id={id} className="ui-ref-section app-panel" aria-labelledby={`ui-ref-${id}`}>
    <header className="ui-ref-section-heading"><span className="app-kicker">{String(SECTIONS.indexOf(section) + 1).padStart(2, "0")}</span><h2 id={`ui-ref-${id}`}>{section.title}</h2></header>
    {children}
  </section>;
}

function StockActions() {
  const [presence, setPresence] = useState(true);
  const [connected, setConnected] = useState(true);
  return <span className="community-member-row-actions">
    <Button type="button" size="icon-sm" variant={presence ? "secondary" : "ghost"} className="community-rich-presence-action" title={`Turn Rich Presence ${presence ? "off" : "on"}`} aria-label={`Turn Rich Presence ${presence ? "off" : "on"}`} aria-pressed={presence} onClick={() => setPresence(!presence)}><Star className={`h-3.5 w-3.5 ${presence ? "fill-current" : ""}`} aria-hidden="true" /></Button>
    <Button type="button" size="icon-sm" variant={connected ? "dangerGhost" : "secondary"} title={connected ? "Disconnect sample account" : "Connect sample account"} aria-label={connected ? "Disconnect sample account" : "Connect sample account"} aria-pressed={connected} onClick={() => setConnected(!connected)}>{connected ? <Power className="h-3.5 w-3.5" /> : <RadioTower className="h-3.5 w-3.5" />}</Button>
    <Button type="button" size="icon-sm" variant="dangerGhost" title="Remove sample account" aria-label="Remove sample account" onClick={() => toast.success("Sample action previewed")}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
  </span>;
}

const MEMBERS = Array.from({ length: 125 }, (_, index) => ({ id: index + 1, name: `Sample member ${String(index + 1).padStart(3, "0")}` }));

const MEMBER_DELIVERY_SAMPLES: CommunityMemberResult[] = [
  { index: 0, username: "Sample member with leave error", avatarUrl: null, state: "joined", authorizationStatus: "active", onlinerLive: true, autoLeaveStatus: "failed", details: "Member joined the server and is pending Discord’s server-rules screening.", autoLeaveDetails: "Discord requires account verification before the member can leave.", completedAt: "2026-11-20T12:00:00Z" },
  { index: 1, username: "Sample member already outside", avatarUrl: null, state: "joined", authorizationStatus: "active", onlinerLive: true, autoLeaveStatus: "already_left", membershipStatus: "removed", membershipLeaveSource: "automatic", details: "Member joined the server.", autoLeaveDetails: "The account was already outside the server.", completedAt: "2026-11-20T12:00:00Z" },
  { index: 2, username: "Sample member needing verification", avatarUrl: null, state: "failed", authorizationStatus: "inactive", details: "Discord Add Guild Member failed (HTTP 403, Discord code 50178): The user account must first be verified.", reactionState: "failed", reactionEmoji: "👍", reactionDetails: "Missing permission to add reactions." },
  { index: 3, username: "Sample member with delivery status only", avatarUrl: null, state: "failed", details: "Delivery failed before account checks were available." },
  { index: 4, username: "Sample offline member", avatarUrl: null, state: "joined", membershipStatus: "removed", membershipLeaveSource: "customer", onlinerLive: false, details: "Member joined the server; its Onliner connection is offline." },
  { index: 5, username: "Sample member with queued leave", avatarUrl: null, state: "joined", autoLeaveStatus: "waiting", autoLeaveScheduledAt: "2026-11-21T12:00:00Z", details: "Member joined the server and is waiting for its scheduled leave." },
  { index: 6, username: "Sample member joining", avatarUrl: null, state: "joining", authorizationStatus: "active", details: "Delivery is in progress." }
];

function MemberDeliveryExample() {
  const [publicView, setPublicView] = useState(false);
  const [leaveProcessed, setLeaveProcessed] = useState<number | null>(null);
  return <div className="grid gap-3">
    <div className="ui-ref-row">
      <Button type="button" size="sm" variant={publicView ? "secondary" : "default"} aria-pressed={!publicView} onClick={() => setPublicView(false)}>Admin</Button>
      <Button type="button" size="sm" variant={publicView ? "default" : "secondary"} aria-pressed={publicView} onClick={() => setPublicView(true)}>Monitor</Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setLeaveProcessed(0)}>Preview Leave all</Button>
      <Button type="button" size="sm" variant="secondary" disabled={leaveProcessed === null || leaveProcessed >= 7} onClick={() => setLeaveProcessed((value) => Math.min(7, (value ?? 0) + 1))}>Process member</Button>
      <Button type="button" size="sm" variant="ghost" disabled={leaveProcessed === null} onClick={() => setLeaveProcessed(null)}>Reset</Button>
    </div>
    <MemberDeliveryPanel audience={publicView ? "public" : "admin"} completed={6} total={7} status="PROCESS" attention
      operation={leaveProcessed !== null ? "leaving" : undefined} leavingProgress={leaveProcessed !== null ? { processed: leaveProcessed, total: 7 } : null} actions={<>
      <span className="member-check-control">
        <Button type="button" size="sm" variant="accentGhost" disabled onClick={() => toast.success("Sample check previewed")}><ShieldCheck className="h-3.5 w-3.5" />Check members</Button>
        <button type="button" className="member-check-help" aria-label="What does Check members do?" aria-describedby="ui-kit-member-check"><CircleHelp className="h-3.5 w-3.5" /></button>
        <span id="ui-kit-member-check" className="member-check-tooltip" role="tooltip">Checks whether members are still in the server and online.</span>
      </span>
      <Button type="button" size="sm" variant="dangerGhost" disabled onClick={() => toast.success("Sample leave previewed")}>Leave all</Button>
    </>}>
      <div className="community-order-result-list humanizer-results member-delivery-list"><MemberDeliveryAccordion>{MEMBER_DELIVERY_SAMPLES.map(item => <MemberDeliveryRow key={item.index} item={item} audience={publicView ? "public" : "admin"} formatTime={() => "Nov 20, 2026, 3:00 PM"} />)}</MemberDeliveryAccordion></div>
    </MemberDeliveryPanel>
  </div>;
}

function MemberAvatarExample() {
  const [joined, setJoined] = useState(false);
  const source = useMemo<CommunityMemberResult[]>(() => {
    const active = { index: 0, username: "Sample member", avatarUrl: "/favicon.svg", state: joined ? "joined" : "joining", details: joined ? "Member joined." : "Joining the server." };
    const queued = { index: 1, username: "Queued member", avatarUrl: null, state: "queued", details: "Waiting for delivery." };
    return joined ? [queued, active] : [active, queued];
  }, [joined]);
  const members = useMemberLogOrder(source, "ui-kit-member-avatar");
  return <div className="grid gap-3">
    <div className="ui-ref-row">
      {["pending", "running", "success", "partial", "failed"].map(state => <div key={state} className="flex items-center gap-2">
        <MemberActivityAvatar className="humanizer-avatar" src="/favicon.svg" state={state} fallback={<Users className="h-4 w-4" />} />
        <span className="text-xs text-[var(--app-muted)]">{state}</span>
      </div>)}
    </div>
    <div className="community-order-result-list humanizer-results member-delivery-list"><MemberDeliveryAccordion>{members.map(item => <MemberDeliveryRow key={item.index} item={item} formatTime={() => "Now"} />)}</MemberDeliveryAccordion></div>
    <div className="ui-ref-row">
      <Button type="button" size="sm" disabled={joined} onClick={() => setJoined(true)}>Complete sample</Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => setJoined(false)}>Reset sample</Button>
    </div>
  </div>;
}

function HumanizerRunExample() {
  const [status, setStatus] = useState<HumanizerJob["status"]>("running");
  const sample: HumanizerJob = { id: "sample-run", status, createdAt: "2026-11-22T00:00:00Z", startedAt: "2026-11-22T00:00:00Z", completedAt: null, total: 10, completed: 4, succeeded: 3, failed: 1, cancelled: status === "running" ? 0 : 6, skipped: [], results: [] };
  return <div className="grid gap-3"><div className="app-panel humanizer-run-panel"><HumanizerRunHeader job={sample} onStop={() => setStatus("stopping")} /></div><div className="ui-ref-row"><Button size="sm" variant="secondary" onClick={() => setStatus("stopped")}>Finish active accounts</Button><Button size="sm" variant="secondary" onClick={() => setStatus("failed")}>Preview failed run</Button><Button size="sm" variant="secondary" onClick={() => setStatus("running")}>Reset sample</Button></div></div>;
}

function MembersList() {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [selected, setSelected] = useState<number[]>([]);
  const pagination = paginate(MEMBERS, page, size);
  const allSelected = pagination.items.every((member) => selected.includes(member.id));
  return <div className="ui-ref-member-list">
    <label className="community-member-select-all"><input type="checkbox" checked={allSelected} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, ...pagination.items.map((member) => member.id)])] : current.filter((id) => !pagination.items.some((member) => member.id === id)))} />Select page · {selected.length} selected</label>
    <div className="ui-ref-list-scroll"><div className="community-recent-list">{pagination.items.map((member) => <div key={member.id}>
      <input className="community-member-checkbox" type="checkbox" aria-label={`Select ${member.name}`} checked={selected.includes(member.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} />
      <span className="community-recent-avatar" aria-hidden="true"><Users className="h-3.5 w-3.5" /></span>
      <span className="min-w-0"><strong>{member.name}</strong><small>@sample_{member.id}</small></span>
      <Badge variant="success">Active</Badge><StockActions />
    </div>)}</div></div>
    <ListPagination {...pagination} onChange={setPage} onPageSizeChange={setSize} label="Sample member pages" showNavigationLabels />
  </div>;
}

function MonitorControlsExample() {
  const [paired, setPaired] = useState(false);
  const [delay, setDelay] = useState("700");
  return <div className="ui-ref-stack">
    <div className="stock-duration-filter" role="group" aria-label="Monitor controls layout">
      <button type="button" className={!paired ? "is-active" : ""} aria-pressed={!paired} onClick={() => setPaired(false)}>Without reactions</button>
      <button type="button" className={paired ? "is-active" : ""} aria-pressed={paired} onClick={() => setPaired(true)}>With reactions</button>
    </div>
    <div className={`monitor-order-controls ${paired ? "is-paired" : "is-delay-only"}`}>
      <div className="monitor-control-panel">
        <div className="monitor-panel-heading"><span className="monitor-panel-icon" aria-hidden="true"><Timer className="h-4 w-4" /></span><div><p className="app-kicker">Delivery control</p><h2>Join delay</h2></div></div>
        <div className="monitor-delay-controls"><Input type="number" min={1} max={1200} aria-label="Sample delay in seconds" value={delay} onChange={(event) => setDelay(event.target.value)} /><Button type="button" variant="secondary" onClick={() => toast.success("Sample delay previewed")}><Timer className="h-4 w-4" />Apply custom</Button></div>
      </div>
      {paired ? <ReactionExample /> : null}
    </div>
  </div>;
}

function ReactionAccessExample() {
  const [state, setState] = useState("not-enabled");
  return <div className="ui-ref-stack">
    <div className="stock-duration-filter flex-wrap" role="group" aria-label="Reaction access state">{[{ value: "not-enabled", label: "Not enabled" }, { value: "disabled", label: "Disabled" }, { value: "unsupported", label: "Unsupported category" }].map(({ value, label }) => <button key={value} type="button" className={state === value ? "is-active" : ""} aria-pressed={state === value} onClick={() => setState(value)}>{label}</button>)}</div>
    {state === "unsupported" ? <p className="ui-ref-hint">No reaction card or empty section is rendered when the category has no reaction access or active support.</p> : <OrderReactionAccessCard disabled={state === "disabled"} dailyLimit={state === "disabled" ? 100 : 0} firstDayLimit={500} onManage={() => toast.success("Sample reaction settings previewed")} />}
  </div>;
}

function ReactionOptionExample() {
  const [enabled, setEnabled] = useState(true);
  const [limit, setLimit] = useState(50);
  return <OrderReactionOption enabled={enabled} memberCount={500} dailyLimit={limit} onEnabledChange={setEnabled} onDailyLimitChange={setLimit} />;
}

function OrderOverviewExample() {
  const [selected, setSelected] = useState("total");
  return <div className="orderdesk"><div className="od-metrics" aria-label="Sample order overview">{[
    { key: "total", title: "All orders", count: "3,359", detail: "Your complete order history", Icon: Layers3 },
    { key: "live", title: "In progress", count: "15", detail: "Deliveries currently running", Icon: RefreshCw },
    { key: "soon", title: "Expiring soon", count: "24", detail: "Support ends in the next 7 days", Icon: Timer },
    { key: "expired", title: "Expired", count: "120", detail: "Orders with ended support", Icon: CheckCircle2 }
  ].map(({ key, title, count, detail, Icon }) => <button key={key} type="button" className="app-panel" data-kind={key} aria-pressed={selected === key} onClick={() => setSelected(key)}>
    <span className="od-metric-title">{title}<Icon /></span><strong>{count}</strong><span className="od-metric-detail">{detail}<ArrowUpRight /></span>
  </button>)}</div></div>;
}

const sampleProfile = async () => ({ username: "admin", role: "Administrator", signedInAt: "2026-11-22T09:00:00Z", expiresAt: "2026-11-22T21:00:00Z", passwordUpdatedAt: null });
const samplePasswordChange = async () => ({ changed: true, passwordUpdatedAt: new Date().toISOString() });
function ProfileExample() {
  const [open, setOpen] = useState(false);
  return <><ProfileAvatarButton username="admin" open={open} onClick={() => setOpen(true)} />{open ? <ProfileDialog onClose={() => setOpen(false)} loadProfile={sampleProfile} savePassword={samplePasswordChange} /> : null}</>;
}

const stockPreviewCategory: CommunityStockCategory = { id: "preview", name: "OAuth Online", joinMethods: ["create_invite"], isPeriodic: true, checkReplacementEnabled: true, reactionUseEnabled: true, publicLeaveAllEnabled: false, iconName: "users", colorKey: "violet", createdAt: "2026-11-22T00:00:00Z", updatedAt: "2026-11-22T00:00:00Z", summary: { joined: 0, authorized: 24, ready: 21, alreadyMember: 0, failed: 2 } };
const stockPreviewMembers: CommunityJoinRecord[] = [0, 1, 2].map(index => ({ id: `sample-${index}`, username: `sample_member_${index + 1}`, displayName: ["Alex Morgan", "Riley Quinn", "Taylor Parker"][index], avatarUrl: null, status: index === 1 ? "failed" : "authorized", details: index === 1 ? "Account authorization needs attention." : null, sortPosition: index, authorizedAt: "2026-11-22T09:00:00Z", joinedAt: null, stockType: "preview", onlinerConnected: index === 0, onlinerAccountId: null, onlinerConnectionState: index === 0 ? "connected" : null, onlinerLastError: null, onlinerRichPresenceEnabled: index === 0, joinedServerCount: index, hasStoredAccountToken: true }));
function MembersStockExample() {
  const previewClick = () => toast.success("Sample action previewed");
  const [category, setCategory] = useState("preview");
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  return <div className="members-stock-workspace">
    <header className="members-stock-heading"><div className="members-stock-heading-identity"><span className="monitor-panel-icon"><Users className="h-4 w-4" /></span><div><h2>Members Stock</h2><p>Sample Members bot</p></div><Badge variant="success">Ready</Badge></div><div className="members-stock-heading-actions"><Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>Import stock</Button><Button size="sm" onClick={previewClick}><Plus className="h-4 w-4" />Add account</Button></div></header>
    <section className="members-stock-pools"><div className="members-stock-section-heading"><h3>Member pools<span>2</span></h3><Button size="sm" variant="accentGhost" onClick={previewClick}><Plus className="h-3.5 w-3.5" />New category</Button></div><div className="members-stock-categories">{[stockPreviewCategory, { ...stockPreviewCategory, id: "offline", name: "OAuth Offline", isPeriodic: false }].map(item => <MembersStockCategory key={item.id} category={item} selected={category === item.id} icon={<Users className="h-4 w-4" />} indicators={null} onSelect={() => { setCategory(item.id); setSelected([]); setOpen(null); }} actions={<Button size="icon-sm" variant="ghost" title="Edit sample category" onClick={previewClick}><ShieldCheck className="h-3.5 w-3.5" /></Button>} />)}</div></section>
    <MembersStockSummary total={26} available={21} active={24} inactive={2} />
    <section className="app-panel members-stock-list"><header className="members-stock-list-heading"><h3>Stock members<Badge variant="secondary">3</Badge></h3><Button size="sm" variant="secondary" onClick={previewClick}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button></header><div className="members-stock-selection"><span>{selected.length ? `${selected.length} selected` : "Select members to see bulk actions"}</span></div>{selected.length ? <MembersStockBulkActions connection={<><Button size="sm" variant="secondary" onClick={previewClick}><RadioTower className="h-3.5 w-3.5" />Connect</Button><Button size="sm" variant="secondary" title="Reconnect selected accounts using their assigned proxies" onClick={previewClick}><RefreshCw className="h-3.5 w-3.5" />Re-connect</Button><Button size="sm" variant="dangerGhost" onClick={previewClick}>Disconnect</Button></>} transfer={<div className="community-member-transfer-actions"><FilterDropdown label="Transfer destination" showLabel={false} className="community-member-filter community-member-transfer-picker" value="offline" options={[{ value: "offline", label: "To: OAuth Offline" }]} onChange={previewClick} /><Button size="sm" variant="secondary" onClick={previewClick}>Transfer</Button></div>} remove={<Button size="sm" variant="dangerGhost" onClick={previewClick}>Delete selected</Button>} tokens={<><Button size="sm" variant="secondary" onClick={previewClick}>Access tokens</Button><Button size="sm" variant="secondary" onClick={previewClick}>User tokens</Button></>} order={<>{["Top", "Up", "Down", "Bottom"].map(label => <Button key={label} size="sm" variant="secondary" onClick={previewClick}>{label}</Button>)}</>} /> : null}<div role="list">{stockPreviewMembers.map(record => <MembersStockRow key={record.id} record={record} selected={selected.includes(record.id)} onSelect={checked => setSelected(ids => checked ? [...ids, record.id] : ids.filter(id => id !== record.id))} open={open === record.id} onToggle={() => setOpen(value => value === record.id ? null : record.id)} badges={<MembersStockBadges record={record} />} actions={<Button size="icon-sm" variant="dangerGhost" title="Remove sample member" onClick={previewClick}><Trash2 className="h-3.5 w-3.5" /></Button>}><MembersStockMetadata accountId={record.id} authorizedAt={record.authorizedAt} />{record.details ? <p>{record.details}</p> : null}<div className="members-stock-secrets"><MembersStockSecret label="Access token" username={record.username} value={revealed === record.id ? "sample-preview-token" : undefined} busy={false} disabled={false} onToggle={() => setRevealed(value => value === record.id ? null : record.id)} onCopy={previewClick} /><MembersStockSecret label="User token" username={record.username} value={undefined} busy={false} disabled={false} onToggle={previewClick} onCopy={previewClick} /></div></MembersStockRow>)}</div></section>
    {importOpen ? <MembersStockImportDialog busy={false} category="Sample category" onClose={() => setImportOpen(false)}><p className="ui-ref-hint">Sample import window. No accounts are imported.</p></MembersStockImportDialog> : null}
  </div>;
}

function StockNavigationExample() {
  const [category, setCategory] = useState<"boosts" | "offline">("boosts");
  return <StockWorkspace category={category} onCategoryChange={setCategory} heading={<h3 className="app-title">Inventory</h3>}><div className="app-panel p-5"><strong>{category === "boosts" ? "Boost inventory" : "Members Stock"}</strong><p className="ui-ref-hint">Sample inventory content</p></div></StockWorkspace>;
}

function SettingsExample() {
  const [config, setConfig] = useState({ configured: true, stored: true, clientId: "123456789012345678", guildId: "234567890123456789", hasClientSecret: true, hasBotToken: true, guildName: "Sample Members server", activeGuildCount: 3, activeGuildCountExact: true, botVerified: true, serverLimit: 100 });
  const [draft, setDraft] = useState({ clientId: config.clientId, guildId: config.guildId, clientSecret: "", botToken: "" });
  const [configured, setConfigured] = useState(true);
  const [key, setKey] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const guilds = Array.from({ length: 3 }, (_, index) => ({ id: `23456789012345678${index}`, name: `Sample server ${index + 1}`, iconUrl: null, configured: index === 0, activeOrderCount: 0, activeOrderStatuses: [] }));
  return <SettingsWorkspace loading={false} onRefresh={() => toast.success("Sample connection status refreshed")}
    members={{ config, draft, onDraftChange: setDraft, saving: false, onSave: (event) => { event.preventDefault(); setConfig({ ...config, configured: true, stored: true, clientId: draft.clientId, guildId: draft.guildId, hasClientSecret: true, hasBotToken: true }); setDraft({ ...draft, clientSecret: "", botToken: "" }); toast.success("Sample settings saved"); }, onRemove: () => { setConfig({ ...config, configured: false, stored: false, hasClientSecret: false, hasBotToken: false, clientId: "", guildId: "" }); setDraft({ clientId: "", guildId: "", clientSecret: "", botToken: "" }); } }}
    dcord={{ configured, draft: key, onDraftChange: setKey, saving: false, onSave: (event) => { event.preventDefault(); setConfigured(true); setKey(""); toast.success("Sample key saved"); }, onRemove: () => { setConfigured(false); setKey(""); } }}
    guilds={{ items: guilds, selected, onSelectionChange: setSelected, loading: false, leaving: false, progress: null, onOpen: () => {}, onRefresh: () => toast.success("Sample servers refreshed"), onLeave: () => toast.success("Sample server action previewed") }}
  />;
}

function OrderSectionsExample() {
  return <div className="grid min-w-0 gap-4"><OrderDetailsLayout standaloneSections overview={
    <header className="lookup-workspace-header"><div className="lookup-order-identity"><span className="lookup-provider-mark" aria-hidden="true"><Server className="h-4 w-4" /></span><h2>Order overview</h2></div></header>
  } footer={<>
    <OrderDetailDisclosure title="Order & server details" hint="IDs and timestamps" icon={<Server className="h-4 w-4" />}>
      <div className="lookup-technical-grid"><div><span>Order ID</span><strong>sample-order</strong></div><div><span>Server ID</span><strong>123456789012345678</strong></div></div>
    </OrderDetailDisclosure>
    <OrderDetailDisclosure title="Raw order payload" kind="payload" hint="JSON" icon={<FileJson className="h-4 w-4" />}>
      <div className="payload-panel overflow-auto p-4"><pre>{JSON.stringify({ uniqid: "sample-order", status: "COMPLETED" }, null, 2)}</pre></div>
    </OrderDetailDisclosure>
  </>}><div className="lookup-order-sections">
    <ReactionExample />
    <MemberDeliveryPanel completed={25} total={25} status="COMPLETED" actions={<Button type="button" size="sm" variant="accentGhost" onClick={() => toast.success("Sample check previewed")}><ShieldCheck className="h-4 w-4" />Check members</Button>}>
      <div className="community-order-result-list humanizer-results member-delivery-list"><MemberDeliveryAccordion>
        <MemberDeliveryRow item={MEMBER_DELIVERY_SAMPLES[0]} formatTime={() => "Nov 20, 2026, 3:00 PM"} />
      </MemberDeliveryAccordion></div>
    </MemberDeliveryPanel>
  </div></OrderDetailsLayout></div>;
}

function ReactionExample({ locked = false }: { locked?: boolean }) {
  const [message, setMessage] = useState("");
  const [count, setCount] = useState(1);
  const [emojis, setEmojis] = useState<string[]>([REACTION_MIXED_VALUE]);
  const [requests, setRequests] = useState<ReactionPanelRequest[]>([]);
  const [resetsAt] = useState(() => {
    const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    return new Date(Date.parse(`${day}T00:00:00+03:00`) + 86_400_000).toISOString();
  });
  return <ReactionPanel collapsible resetsAt={resetsAt}
    limit={500} completed={15} used={15} failed={0} remaining={485} eligibleMembers={locked ? 0 : 500}
    requestEnabled={!locked} lockReason={locked ? "No members are currently available to react." : undefined}
    onEditLimit={() => toast.success("Sample reaction settings previewed")} limitActionLabel="Manage reactions"
    messageDraft={message} countDraft={count} selectedEmojis={emojis} saving={false} requests={requests}
    onMessageChange={setMessage} onCountChange={setCount} onEmojiSelectionChange={setEmojis}
    onCancelPending={(id) => setRequests((current) => current.map((request) => !id || request.id === id ? { ...request, cancelledCount: request.assignedCount } : request))}
    onSubmit={() => {
      setRequests((current) => [...current, { id: `sample-${current.length}`, messageLink: message, requestedCount: count, assignedCount: count, completedCount: 0, emojis, createdAt: new Date().toISOString() }]);
      toast.success("Sample reaction request previewed");
    }} />;
}

export default function UiKitPage() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [category, setCategory] = useState("members");
  const [status, setStatus] = useState("all");
  const [checked, setChecked] = useState(true);
  const [promotion, setPromotion] = useState(true);
  const [progress, setProgress] = useState(65);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const search = query.trim().toLowerCase();
  const visibleSections = SECTIONS.filter((section) => `${section.title} ${section.tags}`.toLowerCase().includes(search));
  const visible = (id: typeof SECTIONS[number]["id"]) => visibleSections.some((section) => section.id === id);
  const previewClick = () => toast.success("Sample action previewed");

  return <div className="ui-reference">
    <header className="ui-ref-heading"><div><p className="app-kicker">PULCIP · DESIGN REFERENCE</p><h1>UI Kit</h1><p>The console’s existing components, together in one place.</p></div><Button asChild variant="secondary" size="sm"><Link to="/manage?tab=manage"><ArrowLeft className="h-4 w-4" />Back to Orders</Link></Button></header>
    <div className="ui-ref-layout">
      <aside className="ui-ref-sidebar"><div className="app-panel-soft ui-ref-nav-panel">
        <label className="community-member-search"><Search className="h-3.5 w-3.5" aria-hidden="true" /><Input type="search" aria-label="Find a component" placeholder="Find a component…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <nav aria-label="UI Kit sections">{visibleSections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav>
        <p>Live examples use the same components and CSS as the console. Demo actions only affect these examples.</p>
      </div></aside>
      <div className="ui-ref-content">
        {!visibleSections.length ? <div className="app-panel stock-empty-state"><Search className="h-5 w-5" /><strong>No components found</strong><Button type="button" variant="secondary" size="xs" onClick={() => setQuery("")}>Clear search</Button></div> : null}

        {visible("buttons") ? <Section id="buttons">
          <Example title="Button variants" source="src/components/ui/button.tsx" code={'import { Button } from "@/components/ui/button";\n\n<Button variant="secondary" size="sm">Refresh</Button>\n<Button variant="destructive" size="sm">Remove</Button>\n<Button variant="dangerGhost" size="icon-sm" aria-label="Delete">\n  <Trash2 className="h-3.5 w-3.5" />\n</Button>'}>
            <div className="ui-ref-variant-grid">{BUTTONS.map(({ variant, label }) => <div key={variant}><code>{variant}</code><div className="ui-ref-row"><Button type="button" variant={variant} size="sm" onClick={previewClick}>{label}</Button><Button type="button" variant={variant} size="sm" disabled>Disabled</Button></div></div>)}</div>
          </Example>
          <Example title="Sizes & loading" source="src/components/ui/button.tsx" code={'<Button size="xs">Extra small</Button>\n<Button size="sm">Small</Button>\n<Button>Default</Button>\n<Button size="lg">Large</Button>\n<Button disabled><LoaderCircle className="h-4 w-4 animate-spin" />Saving…</Button>'}>
            <div className="ui-ref-row">{(["xs", "sm", "default", "lg"] as const).map((size) => <Button key={size} type="button" size={size} variant="secondary" onClick={previewClick}>{size}</Button>)}<Button type="button" disabled><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />Saving…</Button></div>
          </Example>
          <Example title="Customer reaction access" source="src/components/OrderReactionSettingsDialog.tsx · ui/button.tsx" code={'// Manage reactions keeps the disable action separate from limit changes.\n<Button variant="secondary" size="sm" onClick={openSettings}>Enable reactions</Button>\n<Button variant="dangerGhost" size="sm" onClick={disableReactions}>\n  <Power className="h-4 w-4" />Disable reactions\n</Button>\n// Keep the original first-day date and usage when re-enabling.'}><div className="ui-ref-row"><Button type="button" variant="secondary" size="sm" onClick={previewClick}>Enable reactions</Button><Button type="button" variant="dangerGhost" size="sm" onClick={previewClick}><Power className="h-4 w-4" />Disable reactions</Button></div></Example>
          <Example title="Members Stock actions" source="src/pages/HomePage.tsx · community-member-row-actions" code={'<span className="community-member-row-actions">\n  <Button size="icon-sm" variant="secondary" className="community-rich-presence-action" aria-label="Rich Presence">\n    <Star className="h-3.5 w-3.5 fill-current" />\n  </Button>\n  <Button size="icon-sm" variant="dangerGhost" aria-label="Disconnect"><Power className="h-3.5 w-3.5" /></Button>\n  <Button size="icon-sm" variant="dangerGhost" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>\n</span>'}>
            <div className="ui-ref-row"><StockActions /><Button asChild variant="secondary" size="icon-sm"><a href="#buttons" aria-label="Open example" title="Open example"><ExternalLink className="h-3.5 w-3.5" /></a></Button><span className="ui-ref-hint">Try hover, keyboard focus and the star / power toggles.</span></div>
          </Example>
          <Example title="Leave all action states" source="src/components/AutoLeaveActionButton.tsx" code={'// Place after the standard row actions, with space between the groups.\n<AutoLeaveActionButton state="not-started" disabled={!canStart || !deliverySettled} onStart={openConfirmation} />\n<AutoLeaveActionButton state="running" details="10/200 processed" />\n<AutoLeaveActionButton state="completed" />\n<AutoLeaveActionButton state="failed" details="3 failed" />'}>
            <div className="ui-ref-row"><div className="ui-ref-row"><AutoLeaveActionButton state="not-started" disabled details="Delivery in progress" /><span className="ui-ref-hint">Delivery in progress</span></div>{([{ state: "not-started", label: "Not started" }, { state: "starting", label: "Starting" }, { state: "running", label: "In progress" }, { state: "completed", label: "Finished" }, { state: "failed", label: "Finished with errors" }] as const).map(({ state, label }) => <div className="ui-ref-row" key={state}><AutoLeaveActionButton state={state} onStart={previewClick} /><span className="ui-ref-hint">{label}</span></div>)}</div>
          </Example>
        </Section> : null}

        {visible("tabs") ? <Section id="tabs">
          <Example title="Inventory navigation" source="src/components/StockWorkspace.tsx · SettingsWorkspace.css" code={'<StockWorkspace category={stockCategory} onCategoryChange={setStockCategory}\n  heading={inventoryHeading}>\n  {stockCategory === "boosts" ? boostInventory : membersStock}\n</StockWorkspace>\n// Reuses the Settings sidebar; two tabs above content on narrow screens.'}><StockNavigationExample /></Example>
          <Example title="Compact tabs" source="src/index.css · stock-duration-filter" code={'<div className="stock-duration-filter" role="group" aria-label="Service">\n  <button type="button" className={value === "all" ? "is-active" : ""}\n    aria-pressed={value === "all"} onClick={() => setValue("all")}>All orders</button>\n  <button type="button" className={value === "members" ? "is-active" : ""}\n    aria-pressed={value === "members"} onClick={() => setValue("members")}>Members</button>\n</div>'}>
            <div className="stock-duration-filter" role="group" aria-label="Sample service filter">{[{ value: "all", label: "All orders" }, { value: "members", label: "Members" }, { value: "boosts", label: "Boosts" }].map((item) => <button key={item.value} type="button" className={tab === item.value ? "is-active" : ""} aria-pressed={tab === item.value} onClick={() => setTab(item.value)}>{item.label}</button>)}</div><p className="ui-ref-hint" role="status">Selected: {tab}</p>
          </Example>
          <Example title="Stock category cards" source="src/index.css · stock-category-tabs" code={'<div className="stock-category-tabs" role="group" aria-label="Stock type">\n  <button type="button" className="is-active" aria-pressed="true">\n    <Users className="h-5 w-5" /><span><strong>Members Stock</strong><small>OAuth accounts</small></span>\n  </button>\n</div>'}>
            <div className="stock-category-tabs" role="group" aria-label="Sample stock category">{[{ value: "members", label: "Members Stock", detail: "OAuth accounts", Icon: Users }, { value: "boosts", label: "Boost Stock", detail: "Server boosts", Icon: Gem }].map(({ value, label, detail, Icon }) => <button key={value} type="button" className={category === value ? "is-active" : ""} aria-pressed={category === value} onClick={() => setCategory(value)}><Icon className="h-5 w-5" /><span><strong>{label}</strong><small>{detail}</small></span></button>)}</div>
          </Example>
        </Section> : null}

        {visible("fields") ? <Section id="fields">
          <Example title="Inputs & compact search" source="src/components/ui/input.tsx · community-member-search" code={'import { Input } from "@/components/ui/input";\n\n<label><span className="field-label">Server invite</span><Input placeholder="discord.gg/yourcode" /></label>\n<label className="community-member-search">\n  <Search className="h-3.5 w-3.5" />\n  <Input type="search" aria-label="Search members" placeholder="Search username, name or ID…" />\n</label>'}>
            <div className="ui-ref-grid"><label className="ui-ref-field"><span className="field-label">Server invite</span><Input placeholder="discord.gg/yourcode" /></label><label className="ui-ref-field"><span className="field-label">Disabled field</span><Input disabled value="Unavailable" readOnly /></label><label className="community-member-search"><Search className="h-3.5 w-3.5" aria-hidden="true" /><Input type="search" aria-label="Sample member search" placeholder="Search username, name or ID…" /></label></div>
          </Example>
          <Example title="Paired account & proxy inputs" source="src/pages/HomePage.tsx · community-account-paired-fields / community-account-bulk-input" code={'<div className="community-account-paired-fields">\n  <label className="grid min-w-0 gap-2"><span className="field-label">Account tokens</span><textarea className="community-account-bulk-input" /></label>\n  <label className="grid min-w-0 gap-2"><span className="field-label">Auth proxies</span><textarea className="community-account-bulk-input" /></label>\n</div>'}>
            <div className="community-account-paired-fields">
              <label className="grid min-w-0 gap-2"><span className="field-label">Account tokens · one per line</span><textarea className="community-account-bulk-input" aria-label="Example account tokens" placeholder={"token_one\ntoken_two"} spellCheck={false} /></label>
              <label className="grid min-w-0 gap-2"><span className="field-label">Auth proxies · one per line</span><textarea className="community-account-bulk-input" aria-label="Example auth proxies" placeholder={"socks5://user:pass@host:1080\nhttp://user:pass@host:8080"} spellCheck={false} /></label>
            </div>
          </Example>
          <Example title="Themed dropdown & selection" source="src/components/ui/filter-dropdown.tsx" code={'<FilterDropdown label="Status" className="community-member-filter" portal\n  value={status} onChange={setStatus}\n  options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }]} />\n<label className="community-member-select-all">\n  <input type="checkbox" checked={selected} onChange={event => setSelected(event.target.checked)} />\n  Select all\n</label>'}>
            <div className="ui-ref-row"><FilterDropdown label="Status" className="community-member-filter" portal value={status} onChange={setStatus} options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} /><label className="community-member-select-all"><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />Select all</label><FilterDropdown label="Disabled dropdown" className="community-member-filter" disabled value="all" onChange={() => {}} options={[{ value: "all", label: "All statuses" }]} /></div>
          </Example>
          <Example title="Option card" source="src/index.css · boost-proxy-toggle" code={'<label className={`boost-proxy-toggle ${enabled ? "is-enabled" : ""}`}>\n  <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />\n  <span><Star className="h-4 w-4" /></span><strong>Eldorado sale?</strong>\n  <small>Show the promotion on the customer monitor.</small>\n</label>'}>
            <label className={`boost-proxy-toggle ${promotion ? "is-enabled" : ""}`}><input type="checkbox" checked={promotion} onChange={(event) => setPromotion(event.target.checked)} /><span><Star className="h-4 w-4" aria-hidden="true" /></span><strong>Eldorado sale?</strong><small>Show the promotion on the customer monitor.</small></label>
          </Example>
          <Example title="Order reaction option" source="src/components/OrderReactionOption.tsx · boost-proxy-toggle · Badge · stock-duration-filter" code={'<OrderReactionOption enabled={enabled} memberCount={500} dailyLimit={limit}\n  onEnabledChange={setEnabled} onDailyLimitChange={setLimit} />'}><ReactionOptionExample /></Example>
        </Section> : null}

        {visible("badges") ? <Section id="badges">
          <Example title="Shared status geometry" source="src/components/ui/badge.tsx · src/components/ui/badge.css" code={'import { Badge } from "@/components/ui/badge";\n\n<Badge variant="success"><CheckCircle2 className="h-3 w-3" />Active</Badge>\n<Badge variant="destructive">Inactive</Badge>\n<Badge variant="default">In progress</Badge>\n<Badge variant="secondary">Waiting</Badge>\n<Badge variant="outline">Available</Badge>'}>
            <div className="ui-ref-row"><Badge variant="success"><CheckCircle2 className="h-3 w-3" />Active</Badge><Badge variant="destructive">Inactive</Badge><Badge>In progress</Badge><Badge variant="secondary">Waiting</Badge><Badge variant="outline">Available</Badge></div>
          </Example>
          <Example title="Members Stock status fields" source="src/components/MembersStockWorkspace.tsx · ui/status-field.tsx" code={'<MembersStockBadges record={member} />\n// Same icon, label, value, geometry and state colors as Member delivery.'}>
            <div className="ui-ref-row"><MembersStockBadges record={stockPreviewMembers[0]} /><MembersStockBadges record={{ ...stockPreviewMembers[1], onlinerConnected: true, onlinerConnectionState: "error" }} /></div>
          </Example>
          <Example title="Boost member status fields" source="src/components/ui/status-field.tsx · OrderPage.tsx · PublicOrderPage.tsx" code={'<StatusField label="Join" state="joined" value="joined" icon={<Users />} />\n<StatusField label="Boost" state="failed" value="failed" icon={<Gem />} />\n// Same component and semantic colors as Members delivery.'}><div className="ui-ref-row"><StatusField label="Join" state="joined" value="joined" icon={<Users aria-hidden="true" />} /><StatusField label="Boost" state="boosted" value="boosted" icon={<Gem aria-hidden="true" />} /><StatusField label="Join" state="joining" value="joining" icon={<Users aria-hidden="true" />} /><StatusField label="Boost" state="failed" value="failed" icon={<Gem aria-hidden="true" />} /><StatusField label="Humanizer" state="success" value="Humanized" icon={<CheckCircle2 aria-hidden="true" />} /><StatusField label="Re-join" state="running" value="Re-joining" icon={<RefreshCw aria-hidden="true" />} /></div></Example>
          <Example title="Member delivery log status" source="src/pages/OrderPage.tsx · ui/badge.tsx" code={'// Keep counts in shared Badges beside the action buttons.\n// Auto Leave: destructive for failures, default while running, success when finished.\n<Badge variant="destructive"><TriangleAlert />Auto Leave 50/50 · 50 failed</Badge>\n<Badge variant="success"><ShieldCheck />50/50 processed</Badge>'}>
            <div className="ui-ref-row"><Badge><RefreshCw className="animate-spin" aria-hidden="true" />Auto Leave 20/50</Badge><Badge variant="destructive"><TriangleAlert aria-hidden="true" />Auto Leave 50/50 · 50 failed</Badge><Badge variant="success"><CheckCircle2 aria-hidden="true" />Auto Leave 50/50</Badge><Badge variant="secondary"><ShieldCheck aria-hidden="true" />20/50 processed</Badge><Badge variant="success"><ShieldCheck aria-hidden="true" />50/50 processed</Badge></div>
          </Example>
        </Section> : null}

        {visible("panels") ? <Section id="panels">
          <Example title="Members Stock workspace" source="src/components/MembersStockWorkspace.tsx · MembersStockWorkspace.css" code={'// Independent pools, summary cards and one member-list surface.\n<MembersStockCategory category={pool} selected={selected} actions={poolActions} />\n<MembersStockSummary total={total} available={ready} active={active} inactive={inactive} />\n<MembersStockRow record={member} open={openId === member.id}\n  actions={rowActions} badges={statuses} onToggle={toggleDetails}>\n  <MembersStockSecret label="Access token" {...tokenControls} />\n</MembersStockRow>\n// Bulk actions appear only with a selection. Tokens load only on reveal.\n// Mobile pools scroll horizontally; all shared action geometry stays unchanged.'}><MembersStockExample /></Example>
          <Example title="Settings workspace" source="src/components/SettingsWorkspace.tsx · SettingsWorkspace.css" code={'<SettingsWorkspace loading={loading} error={error} onRefresh={refresh}\n  members={membersSettings} dcord={dcordSettings}\n  guilds={botServerSettings} />\n// Shared tab, field, button, badge and pagination styles.\n// Drafts stay in the parent; status refresh does not discard edits.\n// Server removal retains its confirmation flow.'}><SettingsExample /></Example>
          <Example title="Orders overview cards" source="src/components/OrdersWorkspace.tsx · OrdersWorkspace.css" code={'<div className="orderdesk"><div className="od-metrics">\n  <button className="app-panel" aria-pressed={selected}>\n    <span className="od-metric-title">All orders<Layers3 /></span>\n    <strong>3,359</strong>\n    <span className="od-metric-detail">Your complete order history<ArrowUpRight /></span>\n  </button>\n</div></div>\n// Metric cards isolate their rounded surfaces and do not blur the scrolling backdrop.'}><OrderOverviewExample /></Example>
          <Example title="Existing surface styles" source="src/index.css · app-panel / app-panel-soft / payload-panel" code={'<section className="app-panel">Main panel</section>\n<div className="app-panel-soft">Nested group</div>\n<pre className="payload-panel">Code or payload</pre>'}>
            <div className="ui-ref-grid">{["app-panel", "app-panel-soft", "payload-panel"].map((className) => <div className={`${className} ui-ref-surface`} key={className}><strong>{className}</strong><span className="ui-ref-hint">Existing console surface</span></div>)}</div>
          </Example>
          <Example title="Order detail sections" source="src/components/OrderDetailsLayout.tsx · OrderDetailDisclosure.tsx · lookup-order-sections" code={'<OrderDetailsLayout standaloneSections overview={orderOverview}\n  footer={<>\n    <OrderDetailDisclosure title="Order & server details" hint="IDs and timestamps" icon={<Server />}>{details}</OrderDetailDisclosure>\n    <OrderDetailDisclosure title="Raw order payload" kind="payload" hint="JSON" icon={<FileJson />}>{payload}</OrderDetailDisclosure>\n  </>}>\n  <div className="lookup-order-sections">\n    {reactionPanel}\n    {memberDeliveryPanel}\n  </div>\n</OrderDetailsLayout>'}><OrderSectionsExample /></Example>
          <Example title="Shared Card component" source="src/components/ui/card.tsx" code={'<Card>\n  <CardHeader><CardTitle>Members Stock</CardTitle><CardDescription>Available accounts</CardDescription></CardHeader>\n  <CardContent><Badge variant="success">Ready</Badge></CardContent>\n</Card>'}>
            <Card><CardHeader><CardTitle>Members Stock</CardTitle><CardDescription>Available accounts</CardDescription></CardHeader><CardContent><Badge variant="success"><ShieldCheck className="h-3 w-3" />Ready</Badge></CardContent></Card>
          </Example>
        </Section> : null}

        {visible("lists") ? <Section id="lists"><Example title="Members Stock rows & shared pagination" source="src/pages/HomePage.tsx · src/components/ListPagination.tsx" code={'const [page, setPage] = useState(1);\nconst [pageSize, setPageSize] = useState(50);\nconst pagination = paginate(items, page, pageSize);\n\n// Render pagination.items, then use the shared controls:\n<ListPagination {...pagination} onChange={setPage}\n  onPageSizeChange={setPageSize} label="Members pages" showNavigationLabels />'}><MembersList /></Example><Example title="Member delivery rows" source="src/components/MemberDeliveryRow.tsx" code={'<MemberDeliveryPanel completed={processed} total={total} status={status} actions={tools}>\n  <div className="community-order-result-list humanizer-results member-delivery-list">\n    <MemberDeliveryAccordion><MemberDeliveryRow item={member} formatTime={formatTime} /></MemberDeliveryAccordion>\n  </div>\n</MemberDeliveryPanel>\n// Monitor uses audience=\"public\" for plain labels and safe notes; usernames stay masked.\n// Wrap rows in community-order-result-list humanizer-results member-delivery-list.\n// checkingProgress={memberCheckProgress} keeps the status counter and progress bar in sync with Check members.\n// operation="leaving" leavingProgress={leaveProgress} uses the current Leave all processed/total snapshot.\n// The panel starts open; its header toggles the body while toolbar buttons stay independent.\n// The list uses one Humanizer surface with dividers; status badges stay on the right.\n// Joined rows have a green leading accent; failed/blocked rows use red.\n// Missing status fields are omitted; explicit Offline/Inactive values remain visible.\n// MemberDeliveryAccordion keeps only one row open; rows start collapsed.'}><MemberDeliveryExample /></Example></Section> : null}

        {visible("feedback") ? <Section id="feedback">
          <Example title="Inactive reaction access" source="src/components/OrderReactionAccessCard.tsx" code={'// Render the whole section only when summary.canConfigure is true.\n// The server checks current category permissions and active support.\n<OrderReactionAccessCard disabled={summary.disabled}\n  dailyLimit={summary.dailyLimit} firstDayLimit={summary.firstDayLimit}\n  onManage={openSettings} />'}><ReactionAccessExample /></Example>
          <Example title="Monitor control widths" source="src/index.css · monitor-order-controls" code={'// Join delay alone uses two thirds of the row on desktop.\n<div className="monitor-order-controls is-delay-only">{delayPanel}</div>\n// With reactions, both cards share the row equally.\n<div className="monitor-order-controls is-paired">\n  {delayPanel}{reactionPanel}\n</div>\n// Both layouts use full-width cards below 900px.'}><MonitorControlsExample /></Example>
          <Example title="Order reactions & reset countdown" source="src/components/ReactionPanel.tsx · CustomerOrderReactionPanel.tsx · ReactionResetCountdown.tsx" code={'// Same daily allowance on the monitor and authenticated order details.\n<CustomerOrderReactionPanel uniqid={order.uniqid}\n  summary={order.customerReactions} onUpdate={setOrder} />\n// In Orders details, add access="admin".\n// ReactionPanel renders <ReactionResetCountdown resetsAt={summary.resetsAt} />.\n// Open the emoji picker and scroll: only visible rows mount; search covers all emojis.'}><ReactionExample /></Example>
          <Example title="Locked reaction form" source="src/components/ReactionPanel.tsx · monitor-reaction-form-lock" code={'<ReactionPanel {...props} requestEnabled={false}\n  lockReason="No members are currently available to react." />\n// The lock overlay inherits the form radius; its blur stays inside the form.'}><ReactionExample locked /></Example>
          <Example title="Order warning card" source="src/components/OrdersWorkspace.css · od-order-alert" code={'<div className="orderdesk">\n  <div className="od-order-alert" data-tone="danger">\n    <TriangleAlert aria-hidden="true" />\n    <div className="od-alert-copy"><strong>Invites paused</strong><span>Check the invite before continuing.</span></div>\n    <div className="od-alert-actions"><Button variant="destructive" size="xs">Continue</Button></div>\n  </div>\n</div>'}>
            <div className="orderdesk ui-ref-order-preview"><div className="od-order-alert" data-tone="danger"><TriangleAlert aria-hidden="true" /><div className="od-alert-copy"><strong>Invites paused</strong><span>Check the invite before continuing.</span></div><div className="od-alert-actions"><Button type="button" variant="destructive" size="xs" onClick={previewClick}><RefreshCw className="h-3 w-3" />Continue</Button></div></div></div>
          </Example>
          <Example title="Expired support notice" source="src/index.css · monitor-expired-support-note" code={'<div className="monitor-expired-support-note">\n  <Timer className="h-4 w-4" aria-hidden="true" />\n  <strong>Support period expired</strong>\n  <p>Member checks are no longer available for this order.</p>\n</div>'}><div className="monitor-expired-support-note"><Timer className="h-4 w-4" aria-hidden="true" /><strong>Support period expired</strong><p>Member checks are no longer available for this order.</p></div></Example>
          <Example title="Member avatar activity" source="src/components/MemberActivityAvatar.tsx · src/lib/use-member-log-order.ts" code={'<MemberActivityAvatar className="humanizer-avatar" src={avatarUrl}\n  state={state} fallback={<Users />} />\n// Processing spinner; subtle green confirmation on success.\n// Orders details and Monitor preserve a newly joined row for 200ms before reordering.'}><MemberAvatarExample /></Example>
          <Example title="Humanizer run controls" source="src/components/HumanizerRunHeader.tsx" code={'<HumanizerRunHeader job={job} stopping={requestPending} onStop={stopRun} />\n// Stop prevents queued accounts from starting; running accounts finish.\n// Stopping is disabled; stopped and failed are distinct terminal states.'}><HumanizerRunExample /></Example>
          <Example title="Live delivery motion" source="src/components/OrdersWorkspace.css · od-delivery-cell" code={'// Only delivery cells marked live animate; respects reduced motion.\n<div className="od-delivery-cell">\n  <div className="od-status" data-tone="live"><i aria-hidden="true" />In progress</div>\n  <div className="od-progress" data-tone="live"><span style={{ width: "65%" }} /></div>\n</div>'}>
            <div className="orderdesk"><div className="ui-ref-grid">{[{ tone: "live", label: "In progress", percent: 65 }, { tone: "success", label: "Completed", percent: 100 }, { tone: "warning", label: "Paused", percent: 45 }].map(({ tone, label, percent }) => <div key={tone} className="od-delivery-cell"><div className="od-status" data-tone={tone}><i aria-hidden="true" />{label}</div><div className="od-delivery-numbers"><span><b>{percent}</b><span> / 100</span></span><small>{100 - percent} left</small></div><div className="od-progress" data-tone={tone} role="progressbar" aria-label={label + " delivery example"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: percent + "%" }} /></div></div>)}</div></div>
          </Example>
          <Example title="Progress & skeletons" source="src/index.css · monitor-live-progress-track · ui/skeleton.tsx" code={'<div className="monitor-live-progress-track" role="progressbar" aria-valuenow={65} aria-valuemin={0} aria-valuemax={100} aria-label="Delivery">\n  <span style={{ width: "65%" }} />\n</div>\n<Skeleton className="h-4 w-40" />\n<Skeleton className="mt-2 h-3 w-24" />'}>
            <div className="ui-ref-stack"><div className="ui-ref-row"><span className="ui-ref-hint">Delivered {progress}%</span><Button type="button" size="xs" variant="secondary" onClick={() => setProgress((current) => current >= 100 ? 0 : Math.min(100, current + 10))}><Plus className="h-3 w-3" />Advance</Button></div><div className="monitor-live-progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Sample delivery"><span style={{ width: `${progress}%` }} /></div><div className="ui-ref-row"><Skeleton className="h-9 w-9 rounded-lg" /><div><Skeleton className="h-4 w-40" /><Skeleton className="mt-2 h-3 w-24" /></div></div></div>
          </Example>
          <Example title="Empty state" source="src/index.css · stock-empty-state" code={'<div className="stock-empty-state">\n  <Users className="h-5 w-5" /><strong>No members found</strong>\n  <span>Try another search or clear your filters.</span>\n</div>'}><div className="stock-empty-state"><Users className="h-5 w-5" /><strong>No members found</strong><span>Try another search or clear your filters.</span></div></Example>
        </Section> : null}

        {visible("overlays") ? <Section id="overlays">
          <Example title="Account profile" source="src/components/ProfileDialog.tsx · ProfileDialog.css" code={'<ProfileDialog onClose={closeProfile} />\n// Native modal; password changes require the current password.\n// Header uses ProfileAvatarButton plus a separate dangerGhost icon-sm Sign out action; modal has no header X.'}><ProfileExample /></Example>
          <Example title="Confirmation dialog & help tooltip" source="src/index.css · confirm-modal / member-check-control" code={'<div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title">\n  <span className="confirm-modal-icon"><TriangleAlert /></span>\n  <h2 id="confirmation-title">Remove sample?</h2>\n  <p>Preview the existing confirmation style.</p>\n  <div className="confirm-modal-actions">\n    <Button variant="secondary">Cancel</Button><Button variant="destructive">Remove</Button>\n  </div>\n</div>'}>
            <div className="ui-ref-row"><Button type="button" variant="secondary" size="sm" onClick={() => dialogRef.current?.showModal()}>Open sample dialog</Button><span className="member-check-control ui-ref-help"><button type="button" className="member-check-help" aria-label="About this example" aria-describedby="ui-ref-help"><CircleHelp className="h-3.5 w-3.5" /></button><span className="member-check-tooltip" role="tooltip" id="ui-ref-help">This is the existing monitor help tooltip. Hover or focus the help button.</span></span></div>
          </Example>
        </Section> : null}

        {visible("tokens") ? <Section id="tokens">
          <Example title="Live theme colors" source="src/index.css · :root --app-* variables" code={'/* Use the current theme instead of adding literal colors. */\ncolor: var(--app-text);\nbackground: var(--app-control-bg);\nborder-color: var(--app-border);\n/* Prefer Button, Badge and existing surface classes where available. */'}>
            <div className="ui-ref-colors">{COLORS.map((token) => <div key={token}><span aria-hidden="true" style={{ background: `var(${token})` } as CSSProperties} /><code>{token}</code></div>)}</div>
          </Example>
          <Example title="Text hierarchy" source="src/index.css · app-kicker / field-label / --app-text-*" code={'<p className="app-kicker">Section label</p>\n<span className="field-label">Field label</span>\n<p className="text-[var(--app-text)]">Primary text</p>\n<p className="text-[var(--app-text-secondary)]">Keeps Discord accounts online.</p>\n<p className="text-[var(--app-muted)]">Muted text</p>'}>
            <div className="ui-ref-stack"><p className="app-kicker">Section label</p><span className="field-label">Field label</span><p className="text-[var(--app-text)]">Primary text</p><p className="text-[var(--app-text-secondary)]">Keeps Discord accounts online.</p><p className="text-[var(--app-muted)]">Muted text</p><p className="text-[var(--app-subtle)]">Subtle metadata</p></div>
          </Example>
        </Section> : null}
      </div>
    </div>
    <dialog ref={dialogRef} className="confirm-modal ui-ref-dialog" aria-labelledby="ui-ref-dialog-title" aria-describedby="ui-ref-dialog-description">
      <span className="confirm-modal-icon" aria-hidden="true"><TriangleAlert className="h-5 w-5" /></span><p className="app-kicker text-[var(--app-danger)]">Component preview</p><h2 id="ui-ref-dialog-title">Remove sample?</h2><p id="ui-ref-dialog-description">This example uses the console’s existing confirmation style. It only previews the action.</p>
      <div className="confirm-modal-actions"><Button type="button" variant="secondary" autoFocus onClick={() => dialogRef.current?.close()}>Cancel</Button><Button type="button" variant="destructive" onClick={() => { dialogRef.current?.close(); previewClick(); }}><Trash2 className="h-4 w-4" />Remove sample</Button></div>
    </dialog>
  </div>;
}
