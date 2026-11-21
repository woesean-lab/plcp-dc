import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CircleHelp, Copy, ExternalLink, Gem, LoaderCircle, Plus, Power, RadioTower, RefreshCw, Search, Server, ShieldCheck, Star, Timer, Trash2, TriangleAlert, Users } from "lucide-react";
import toast from "react-hot-toast";
import { Button, type ButtonProps } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { FilterDropdown } from "../components/ui/filter-dropdown";
import { Skeleton } from "../components/ui/skeleton";
import { ListPagination, paginate } from "../components/ListPagination";
import { AutoLeaveActionButton } from "../components/AutoLeaveActionButton";
import { ReactionPanel, REACTION_MIXED_VALUE } from "../components/ReactionPanel";
import { OrderReactionOption } from "../components/OrderReactionOption";
import { OrderReactionAccessCard } from "../components/OrderReactionAccessCard";
import { MemberDeliveryRow } from "../components/MemberDeliveryRow";
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
  { id: "feedback", title: "Alerts & feedback", tags: "warning danger progress loading skeleton empty reaction daily monitor" },
  { id: "overlays", title: "Dialogs & tooltips", tags: "modal confirmation help popup" },
  { id: "tokens", title: "Colors & typography", tags: "theme text accent border variables" }
] as const;

const BUTTONS: { variant: ButtonProps["variant"]; label: string }[] = [
  { variant: "default", label: "Primary" }, { variant: "secondary", label: "Secondary" },
  { variant: "outline", label: "Outline" }, { variant: "ghost", label: "Ghost" },
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
  { index: 1, username: "Sample member already outside", avatarUrl: null, state: "joined", authorizationStatus: "active", onlinerLive: true, autoLeaveStatus: "already_left", details: "Member joined the server.", autoLeaveDetails: "The account was already outside the server.", completedAt: "2026-11-20T12:00:00Z" },
  { index: 2, username: "Sample member awaiting delivery", avatarUrl: null, state: "queued", authorizationStatus: "inactive", onlinerLive: false, details: "Waiting for delivery.", reactionState: "failed", reactionEmoji: "👍", reactionDetails: "Missing permission to add reactions." }
];

function MemberDeliveryExample() {
  return <div className="grid gap-2">{MEMBER_DELIVERY_SAMPLES.map((item) => <MemberDeliveryRow key={item.index} item={item} formatTime={() => "Nov 20, 2026, 3:00 PM"} />)}</div>;
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

function ReactionExample() {
  const [message, setMessage] = useState("");
  const [count, setCount] = useState(1);
  const [emojis, setEmojis] = useState<string[]>([REACTION_MIXED_VALUE]);
  const [resetsAt] = useState(() => {
    const day = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    return new Date(Date.parse(`${day}T00:00:00+03:00`) + 86_400_000).toISOString();
  });
  return <ReactionPanel collapsible resetsAt={resetsAt}
    limit={500} completed={15} used={15} failed={0} remaining={485} eligibleMembers={500}
    onEditLimit={() => toast.success("Sample reaction settings previewed")} limitActionLabel="Manage reactions"
    messageDraft={message} countDraft={count} selectedEmojis={emojis} saving={false} requests={[]}
    onMessageChange={setMessage} onCountChange={setCount} onEmojiSelectionChange={setEmojis}
    onSubmit={() => toast.success("Sample reaction request previewed")} />;
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
          <Example title="Leave all action states" source="src/components/AutoLeaveActionButton.tsx" code={'// Place after the standard row actions, with space between the groups.\n<AutoLeaveActionButton state="not-started" disabled={!canStart} onStart={openConfirmation} />\n<AutoLeaveActionButton state="running" details="10/200 processed" />\n<AutoLeaveActionButton state="completed" />\n<AutoLeaveActionButton state="failed" details="3 failed" />'}>
            <div className="ui-ref-row">{([{ state: "not-started", label: "Not started" }, { state: "starting", label: "Starting" }, { state: "running", label: "In progress" }, { state: "completed", label: "Finished" }, { state: "failed", label: "Finished with errors" }] as const).map(({ state, label }) => <div className="ui-ref-row" key={state}><AutoLeaveActionButton state={state} onStart={previewClick} /><span className="ui-ref-hint">{label}</span></div>)}</div>
          </Example>
        </Section> : null}

        {visible("tabs") ? <Section id="tabs">
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
          <Example title="Members Stock chips" source="src/index.css · community-*-chip" code={'<span className="community-onliner-chip status-badge"><RadioTower /><span>Onliner</span><b>Live</b></span>\n<span className="community-rich-presence-chip status-badge" data-enabled="true"><Star /><span>Rich Presence</span><b>On</b></span>\n<span className="community-server-count-chip status-badge"><Server /><b>98</b><span>Servers</span></span>'}>
            <div className="ui-ref-row"><span className="community-onliner-chip status-badge"><RadioTower /><span>Onliner</span><b>Live</b></span><span className="community-rich-presence-chip status-badge" data-enabled="true"><Star /><span>Rich Presence</span><b>On</b></span><span className="community-server-count-chip status-badge"><Server /><b>98</b><span>Servers</span></span></div>
          </Example>
          <Example title="Member delivery log status" source="src/pages/OrderPage.tsx · ui/badge.tsx" code={'// Keep counts in shared Badges beside the action buttons.\n// Auto Leave: destructive for failures, default while running, success when finished.\n<Badge variant="destructive"><TriangleAlert />Auto Leave 50/50 · 50 failed</Badge>\n<Badge variant="success"><ShieldCheck />50/50 processed</Badge>'}>
            <div className="ui-ref-row"><Badge><RefreshCw className="animate-spin" aria-hidden="true" />Auto Leave 20/50</Badge><Badge variant="destructive"><TriangleAlert aria-hidden="true" />Auto Leave 50/50 · 50 failed</Badge><Badge variant="success"><CheckCircle2 aria-hidden="true" />Auto Leave 50/50</Badge><Badge variant="secondary"><ShieldCheck aria-hidden="true" />20/50 processed</Badge><Badge variant="success"><ShieldCheck aria-hidden="true" />50/50 processed</Badge></div>
          </Example>
        </Section> : null}

        {visible("panels") ? <Section id="panels">
          <Example title="Existing surface styles" source="src/index.css · app-panel / app-panel-soft / payload-panel" code={'<section className="app-panel">Main panel</section>\n<div className="app-panel-soft">Nested group</div>\n<pre className="payload-panel">Code or payload</pre>'}>
            <div className="ui-ref-grid">{["app-panel", "app-panel-soft", "payload-panel"].map((className) => <div className={`${className} ui-ref-surface`} key={className}><strong>{className}</strong><span className="ui-ref-hint">Existing console surface</span></div>)}</div>
          </Example>
          <Example title="Shared Card component" source="src/components/ui/card.tsx" code={'<Card>\n  <CardHeader><CardTitle>Members Stock</CardTitle><CardDescription>Available accounts</CardDescription></CardHeader>\n  <CardContent><Badge variant="success">Ready</Badge></CardContent>\n</Card>'}>
            <Card><CardHeader><CardTitle>Members Stock</CardTitle><CardDescription>Available accounts</CardDescription></CardHeader><CardContent><Badge variant="success"><ShieldCheck className="h-3 w-3" />Ready</Badge></CardContent></Card>
          </Example>
        </Section> : null}

        {visible("lists") ? <Section id="lists"><Example title="Members Stock rows & shared pagination" source="src/pages/HomePage.tsx · src/components/ListPagination.tsx" code={'const [page, setPage] = useState(1);\nconst [pageSize, setPageSize] = useState(50);\nconst pagination = paginate(items, page, pageSize);\n\n// Render pagination.items, then use the shared controls:\n<ListPagination {...pagination} onChange={setPage}\n  onPageSizeChange={setPageSize} label="Members pages" showNavigationLabels />'}><MembersList /></Example><Example title="Member delivery rows" source="src/components/MemberDeliveryRow.tsx" code={'<MemberDeliveryRow item={member} formatTime={formatTime} />\n// Status fields stay visible. Details opens the full notes per row; closed initially.'}><MemberDeliveryExample /></Example></Section> : null}

        {visible("feedback") ? <Section id="feedback">
          <Example title="Inactive reaction access" source="src/components/OrderReactionAccessCard.tsx" code={'// Render the whole section only when summary.canConfigure is true.\n// The server checks current category permissions and active support.\n<OrderReactionAccessCard disabled={summary.disabled}\n  dailyLimit={summary.dailyLimit} firstDayLimit={summary.firstDayLimit}\n  onManage={openSettings} />'}><ReactionAccessExample /></Example>
          <Example title="Monitor control widths" source="src/index.css · monitor-order-controls" code={'// Join delay alone uses two thirds of the row on desktop.\n<div className="monitor-order-controls is-delay-only">{delayPanel}</div>\n// With reactions, both cards share the row equally.\n<div className="monitor-order-controls is-paired">\n  {delayPanel}{reactionPanel}\n</div>\n// Both layouts use full-width cards below 900px.'}><MonitorControlsExample /></Example>
          <Example title="Order reactions & reset countdown" source="src/components/ReactionPanel.tsx · CustomerOrderReactionPanel.tsx · ReactionResetCountdown.tsx" code={'// Same daily allowance on the monitor and authenticated order details.\n<CustomerOrderReactionPanel uniqid={order.uniqid}\n  summary={order.customerReactions} onUpdate={setOrder} />\n// In Orders details, add access="admin".\n// ReactionPanel renders <ReactionResetCountdown resetsAt={summary.resetsAt} />.'}><ReactionExample /></Example>
          <Example title="Order warning card" source="src/components/OrdersWorkspace.css · od-order-alert" code={'<div className="orderdesk">\n  <div className="od-order-alert" data-tone="danger">\n    <TriangleAlert aria-hidden="true" />\n    <div className="od-alert-copy"><strong>Invites paused</strong><span>Check the invite before continuing.</span></div>\n    <div className="od-alert-actions"><Button variant="destructive" size="xs">Continue</Button></div>\n  </div>\n</div>'}>
            <div className="orderdesk ui-ref-order-preview"><div className="od-order-alert" data-tone="danger"><TriangleAlert aria-hidden="true" /><div className="od-alert-copy"><strong>Invites paused</strong><span>Check the invite before continuing.</span></div><div className="od-alert-actions"><Button type="button" variant="destructive" size="xs" onClick={previewClick}><RefreshCw className="h-3 w-3" />Continue</Button></div></div></div>
          </Example>
          <Example title="Expired support notice" source="src/index.css · monitor-expired-support-note" code={'<div className="monitor-expired-support-note">\n  <Timer className="h-4 w-4" aria-hidden="true" />\n  <strong>Support period expired</strong>\n  <p>Member checks are no longer available for this order.</p>\n</div>'}><div className="monitor-expired-support-note"><Timer className="h-4 w-4" aria-hidden="true" /><strong>Support period expired</strong><p>Member checks are no longer available for this order.</p></div></Example>
          <Example title="Progress & skeletons" source="src/index.css · monitor-live-progress-track · ui/skeleton.tsx" code={'<div className="monitor-live-progress-track" role="progressbar" aria-valuenow={65} aria-valuemin={0} aria-valuemax={100} aria-label="Delivery">\n  <span style={{ width: "65%" }} />\n</div>\n<Skeleton className="h-4 w-40" />\n<Skeleton className="mt-2 h-3 w-24" />'}>
            <div className="ui-ref-stack"><div className="ui-ref-row"><span className="ui-ref-hint">Delivered {progress}%</span><Button type="button" size="xs" variant="secondary" onClick={() => setProgress((current) => current >= 100 ? 0 : Math.min(100, current + 10))}><Plus className="h-3 w-3" />Advance</Button></div><div className="monitor-live-progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Sample delivery"><span style={{ width: `${progress}%` }} /></div><div className="ui-ref-row"><Skeleton className="h-9 w-9 rounded-lg" /><div><Skeleton className="h-4 w-40" /><Skeleton className="mt-2 h-3 w-24" /></div></div></div>
          </Example>
          <Example title="Empty state" source="src/index.css · stock-empty-state" code={'<div className="stock-empty-state">\n  <Users className="h-5 w-5" /><strong>No members found</strong>\n  <span>Try another search or clear your filters.</span>\n</div>'}><div className="stock-empty-state"><Users className="h-5 w-5" /><strong>No members found</strong><span>Try another search or clear your filters.</span></div></Example>
        </Section> : null}

        {visible("overlays") ? <Section id="overlays">
          <Example title="Confirmation dialog & help tooltip" source="src/index.css · confirm-modal / member-check-control" code={'<div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title">\n  <span className="confirm-modal-icon"><TriangleAlert /></span>\n  <h2 id="confirmation-title">Remove sample?</h2>\n  <p>Preview the existing confirmation style.</p>\n  <div className="confirm-modal-actions">\n    <Button variant="secondary">Cancel</Button><Button variant="destructive">Remove</Button>\n  </div>\n</div>'}>
            <div className="ui-ref-row"><Button type="button" variant="secondary" size="sm" onClick={() => dialogRef.current?.showModal()}>Open sample dialog</Button><span className="member-check-control ui-ref-help"><button type="button" className="member-check-help" aria-label="About this example" aria-describedby="ui-ref-help"><CircleHelp className="h-3.5 w-3.5" /></button><span className="member-check-tooltip" role="tooltip" id="ui-ref-help">This is the existing monitor help tooltip. Hover or focus the help button.</span></span></div>
          </Example>
        </Section> : null}

        {visible("tokens") ? <Section id="tokens">
          <Example title="Live theme colors" source="src/index.css · :root --app-* variables" code={'/* Use the current theme instead of adding literal colors. */\ncolor: var(--app-text);\nbackground: var(--app-control-bg);\nborder-color: var(--app-border);\n/* Prefer Button, Badge and existing surface classes where available. */'}>
            <div className="ui-ref-colors">{COLORS.map((token) => <div key={token}><span aria-hidden="true" style={{ background: `var(${token})` } as CSSProperties} /><code>{token}</code></div>)}</div>
          </Example>
          <Example title="Text hierarchy" source="src/index.css · app-kicker / field-label / --app-text-*" code={'<p className="app-kicker">Section label</p>\n<span className="field-label">Field label</span>\n<p className="text-[var(--app-text)]">Primary text</p>\n<p className="text-[var(--app-text-secondary)]">Supporting text</p>\n<p className="text-[var(--app-muted)]">Muted text</p>'}>
            <div className="ui-ref-stack"><p className="app-kicker">Section label</p><span className="field-label">Field label</span><p className="text-[var(--app-text)]">Primary text</p><p className="text-[var(--app-text-secondary)]">Supporting text</p><p className="text-[var(--app-muted)]">Muted text</p><p className="text-[var(--app-subtle)]">Subtle metadata</p></div>
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
