import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowUpRight, Check, ChevronRight, Clock3, Copy, ExternalLink, Gem, Layers3, LoaderCircle, MoreHorizontal, Plus, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, Timer, Trash2, TriangleAlert, Users, X } from "lucide-react";
import { Button } from "./ui/button";
import { FilterDropdown } from "./ui/filter-dropdown";
import { Skeleton } from "./ui/skeleton";
import { ListPagination, paginate } from "./ListPagination";
import { AutoLeaveActionButton, type AutoLeaveActionState } from "./AutoLeaveActionButton";
import { getOrderPeriod } from "../lib/order-period";
import { canStartOrderLeave, EMPTY_ORDERS_FILTERS, filterWorkspaceOrders, hasFailedLeave, orderDelivery, orderIsBoost, orderStatus, type OrdersFilters } from "../lib/orders-workspace";
import { extractBotInvite } from "../lib/bot-invite";
import { getOrderReactionOverviews } from "../lib/integration";
import { OrderReactionSettingsDialog } from "./OrderReactionSettingsDialog";
import type { OrderReactionOverview, OrderStatusResponse, TrackedOrder } from "../types";
import "./OrdersWorkspace.css";

type Props = {
  orders: TrackedOrder[];
  syncing: boolean;
  canSync: boolean;
  loading?: boolean;
  autoLeavingId: string | null;
  resumingId: string | null;
  onSync: () => void;
  onCopyMonitor: (order: TrackedOrder) => void;
  onCopyInvite: (invite: string) => void;
  onAutoLeave: (order: TrackedOrder) => void;
  onDelete: (order: TrackedOrder) => void;
  onResume: (order: TrackedOrder) => void;
  onReactionUpdated: (order: OrderStatusResponse) => void;
};

const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
function date(value?: string | number | null, time = false) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", time ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function relativePeriod(expiresAt: number, now: number) {
  const days = Math.ceil(Math.abs(expiresAt - now) / 86400_000);
  if (expiresAt <= now) {
    const elapsed = Math.floor((now - expiresAt) / 86400_000);
    return elapsed === 0 ? "Expired less than a day ago" : `Expired ${elapsed} day${elapsed === 1 ? "" : "s"} ago`;
  }
  return days <= 1 ? "Less than a day left" : `${days} days remaining`;
}

function closeMenu(event: MouseEvent<HTMLElement>) { event.currentTarget.closest("details")?.removeAttribute("open"); }

function OrderRow({ order, now, onReactionSettings, ...actions }: { order: TrackedOrder; now: number; onReactionSettings: (order: TrackedOrder) => void } & Pick<Props, "autoLeavingId" | "resumingId" | "onCopyMonitor" | "onCopyInvite" | "onAutoLeave" | "onDelete" | "onResume">) {
  const navigate = useNavigate();
  const boost = orderIsBoost(order);
  const status = orderStatus(order.status);
  const delivery = orderDelivery(order);
  const period = getOrderPeriod(order, now);
  const name = order.serverName || order.serverId || "Discord server";
  const orderUrl = `/orders?uniqid=${encodeURIComponent(order.uniqid)}${order.provider ? `&provider=${order.provider}` : ""}`;
  const job = order.autoLeaveJob;
  const runningLeave = job?.status === "running";
  const leaveFailed = hasFailedLeave(order);
  const canLeave = canStartOrderLeave(order, now);
  const leaveState: AutoLeaveActionState = actions.autoLeavingId === order.uniqid ? "starting" : runningLeave ? "running" : leaveFailed ? "failed" : job || order.membersLeftAt ? "completed" : "not-started";
  const leaveDetails = job ? `${job.processed}/${job.total} processed · ${job.failed} failed` : order.membersLeftAt ? "Already used for this order" : canLeave ? "Start removing expired members" : period.state === "active" || period.state === "soon" ? "Available when member support expires" : "No expired members available to remove";
  const botInvite = ["NEW", "WAITING"].includes(String(order.status).toUpperCase()) ? extractBotInvite(order) : null;
  const invitesPaused = String(order.status).toUpperCase().includes("INVITES PAUSED") && !boost;
  const service = boost ? "Server boosts" : order.service === "COMMUNITY-ONLINE" ? "Online members" : "Offline members";
  const joinMethod = order.joinMethod === "directly" ? "Direct join" : order.joinMethod === "experimental_join" ? "Experimental join" : "Create invite";
  const delay = order.statusDelay ?? order.delay;
  const duration = boost ? order.boostStockPool === "rotating" ? "30-day rotating" : order.duration ? `${order.duration}-month boosts` : "Boost delivery" : order.durationMonths ? `${order.durationMonths}-month support` : "Members";
  const reactions = order.customerReactions;

  function openOrder(event: MouseEvent<HTMLTableRowElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest("a, button, input, select, textarea, summary, [role='button'], [role='link'], [contenteditable='true'], .od-actions-cell")) return;
    if (window.getSelection()?.toString()) return;
    navigate(orderUrl);
  }

  return <tbody className="od-order-group">
    <tr className="od-record" data-notice={Boolean(botInvite || invitesPaused)} onClick={openOrder}>
      <td className="od-order-cell">
        <div className="od-order-identity">
          <span className="od-service-icon" data-service={boost ? "boosts" : "members"} aria-hidden="true">{boost ? <Gem /> : <Users />}</span>
          <div>
            <Link className="od-order-name" to={orderUrl} title={name}>{name}</Link>
            <div className="od-order-description"><span>{order.categoryName || service}</span><span aria-hidden="true">·</span><code title={order.uniqid}>#{order.uniqid.length > 16 ? order.uniqid.slice(-12) : order.uniqid}</code></div>
            <span className="od-order-context">{duration}{!boost ? ` · ${joinMethod}` : ""}</span>
          </div>
        </div>
      </td>
      <td className="od-delivery-cell">
        <div className="od-status" data-tone={status.tone}><i aria-hidden="true" />{status.label}</div>
        <div className="od-delivery-numbers"><span><b>{number(delivery.delivered)}</b><span> / {delivery.total === null ? "—" : number(delivery.total)}</span></span><small>{delivery.remaining === null ? "" : delivery.remaining === 0 ? "Delivered" : `${number(delivery.remaining)} left`}</small></div>
        <div className="od-progress" data-tone={status.tone} role="progressbar" aria-label={`Delivery for ${name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={delivery.total ? Math.round(delivery.percent) : undefined}><span style={{ width: `${delivery.percent}%` }} /></div>
        {!boost && typeof delay === "number" && delivery.remaining !== 0 ? <span className="od-delivery-delay">{delay}s between members</span> : null}
      </td>
      <td className="od-reaction-cell">
        <span className="od-mobile-caption">Reactions</span>
        {boost ? <span className="od-order-context">—</span> : reactions?.dailyLimit ? <>
          <div className="od-status" data-tone={reactions.enabled ? "live" : "muted"}><i aria-hidden="true" />{reactions.disabled ? "Disabled" : reactions.enabled ? reactions.firstDay ? "First day" : "Daily allowance" : "Unavailable"}</div>
          <div className="od-reaction-numbers">
            <span><small>Today limit</small><b>{number(reactions.todayLimit)}</b></span>
            <span title="Total usage across all days, including queued reactions"><small>Total used</small><b>{number(reactions.totalUsed)}</b></span>
            <span><small>Left today</small><b>{number(reactions.remaining)}</b></span>
          </div>
          <div className="od-progress" role="progressbar" aria-label={`Today's reaction usage for ${name}`} aria-valuemin={0} aria-valuemax={reactions.todayLimit || 1} aria-valuenow={Math.min(reactions.used, reactions.todayLimit)}><span style={{ width: `${reactions.todayLimit ? Math.min(100, reactions.used / reactions.todayLimit * 100) : 0}%` }} /></div>
          <span className="od-delivery-delay">{number(reactions.dailyLimit)} / day{reactions.firstDay ? " after first day" : ""}</span>
        </> : <div className="od-reaction-disabled"><span className="od-order-context">Not enabled</span>{reactions?.canConfigure ? <Button type="button" variant="secondary" size="xs" onClick={() => onReactionSettings(order)}><Sparkles className="h-3 w-3" />Enable</Button> : null}</div>}
      </td>
      <td className="od-support-cell">
        <span className="od-period-label" data-state={period.state}>{period.state === "expired" ? <><Clock3 /> Expired</> : period.state === "soon" ? <><Clock3 /> Expiring soon</> : period.state === "active" ? <><ShieldCheck /> Active support</> : <><span className="od-no-period">—</span> No expiry</>}</span>
        {period.state !== "none" ? <span className="od-period-relative" title={`${date(period.expiresAt)} at ${date(period.expiresAt, true)}`}>{relativePeriod(period.expiresAt, now)}</span> : null}
        {job ? <div className="od-leave-summary" role="status">
          <span className="od-leave-state" data-state={runningLeave ? "running" : leaveFailed ? "failed" : "done"}>{runningLeave ? <LoaderCircle className="animate-spin" /> : leaveFailed ? <TriangleAlert /> : <Check />}{runningLeave ? `Removing ${job.processed}/${job.total}` : `Removal finished · ${job.processed}/${job.total}`}</span>
          <span className="od-leave-counts">{number(job.left + job.alreadyLeft)} removed <span aria-hidden="true">·</span> <span data-failed={job.failed > 0}>{number(job.failed)} failed</span></span>
          {runningLeave && job.nextRunAt ? <span className="od-leave-next">Next: {date(job.nextRunAt, true)}</span> : null}
        </div>
          : period.state !== "none" ? <time className="od-period-date" dateTime={new Date(period.expiresAt).toISOString()} title={`${date(period.expiresAt)} at ${date(period.expiresAt, true)}`}>{period.state === "expired" ? "Ended" : "Ends"} {date(period.expiresAt)}</time> : null}
      </td>
      <td className="od-created-cell"><span className="od-mobile-caption">Created</span><time dateTime={order.createdAt}>{date(order.createdAt)}</time><span>{date(order.createdAt, true)}</span></td>
      <td className="od-actions-cell">
        <div className="od-row-actions">
          <div className="community-member-row-actions">
          <Button asChild variant="secondary" size="icon-sm"><Link to={orderUrl} title="Open order" aria-label={`Open order ${order.uniqid}`}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></Link></Button>
          <details className="od-action-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute("open"); }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.removeAttribute("open"); event.currentTarget.querySelector("summary")?.focus(); } }}>
            <Button asChild variant="secondary" size="icon-sm"><summary aria-label={`More actions for ${order.uniqid}`} title="More actions"><MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" /></summary></Button>
            <div className="od-action-popover">
              {!boost ? <button type="button" onClick={(event) => { closeMenu(event); actions.onCopyMonitor(order); }}><Copy />Copy monitor link</button> : null}
              <Link to={orderUrl} onClick={closeMenu}><ExternalLink />Order details</Link>
              {!boost ? <button type="button" onClick={(event) => { closeMenu(event); onReactionSettings(order); }}><Sparkles />{reactions?.dailyLimit && !reactions.disabled ? "Manage reactions" : "Enable reactions"}</button> : null}
              <button type="button" className="od-delete-action" disabled={runningLeave} title={runningLeave ? "Wait for member removal to finish" : undefined} onClick={(event) => { closeMenu(event); actions.onDelete(order); }}><Trash2 />Delete order</button>
            </div>
          </details>
          </div>
          {!boost && (order.provider === "community" || job || order.membersLeftAt) ? <AutoLeaveActionButton state={leaveState} details={leaveDetails} disabled={!canLeave || actions.autoLeavingId !== null} onStart={() => actions.onAutoLeave(order)} /> : null}
        </div>
      </td>
    </tr>
    {botInvite || invitesPaused ? <tr className="od-notice-row"><td colSpan={6}><div className="od-order-alert" data-tone={invitesPaused ? "danger" : "waiting"}>
      <TriangleAlert aria-hidden="true" />
      <div className="od-alert-copy"><strong>{botInvite ? "Bot invite required" : "Invites paused"}</strong><span>{botInvite ? "Add the bot to start delivery." : "Check the invite before continuing."}</span></div>
      <div className="od-alert-actions">{botInvite ? <><Button type="button" variant="secondary" size="xs" onClick={() => actions.onCopyInvite(botInvite)}><Copy />Copy invite</Button><Button asChild size="xs"><a href={botInvite} target="_blank" rel="noreferrer">Add bot <ArrowUpRight /></a></Button></> : <Button type="button" variant="destructive" size="xs" disabled={actions.resumingId !== null} onClick={() => actions.onResume(order)}><RotateCcw className={actions.resumingId === order.uniqid ? "animate-spin" : ""} />{actions.resumingId === order.uniqid ? "Continuing…" : "Continue"}</Button>}</div>
    </div></td></tr> : null}
  </tbody>;
}

export default function OrdersWorkspace(props: Props) {
  const { orders, loading = false } = props;
  const [filters, setFilters] = useState<OrdersFilters>(EMPTY_ORDERS_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [reactionSettingsOrder, setReactionSettingsOrder] = useState<string | null>(null);
  const [reactionOverviews, setReactionOverviews] = useState<Record<string, OrderReactionOverview>>({});
  const reactionRevision = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const hasRunningLeave = orders.some((order) => order.autoLeaveJob?.status === "running");
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), hasRunningLeave ? 1000 : 60_000); return () => window.clearInterval(timer); }, [hasRunningLeave]);
  const stats = useMemo(() => ({
    total: orders.length,
    live: orders.filter((order) => ["PROCESS", "RECOVERING"].includes(String(order.status).toUpperCase())).length,
    soon: orders.filter((order) => getOrderPeriod(order, now).state === "soon").length,
    expired: orders.filter((order) => getOrderPeriod(order, now).state === "expired").length,
    failedLeave: orders.filter(hasFailedLeave).length
  }), [orders, now]);
  const filtered = useMemo(() => filterWorkspaceOrders(orders, filters, now), [orders, filters, now]);
  const pagination = paginate(filtered, page, pageSize);
  const visibleReactionIds = pagination.items.filter((order) => order.provider === "community").map((order) => order.uniqid).join("|");
  useEffect(() => {
    if (loading || !visibleReactionIds) return;
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const revision = reactionRevision.current;
      try {
        const rows = await getOrderReactionOverviews(visibleReactionIds.split("|"));
        if (active && revision === reactionRevision.current) setReactionOverviews((current) => ({ ...current, ...Object.fromEntries(rows.map((row) => [row.uniqid, row.customerReactions])) }));
      } catch { /* Keep the last overview and retry on the next cycle. */ }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [loading, visibleReactionIds]);
  const changeFilter = (patch: Partial<OrdersFilters>) => { setFilters((current) => ({ ...current, ...patch })); setPage(1); };
  const reset = () => { setFilters(EMPTY_ORDERS_FILTERS); setPage(1); };
  const filteredView = Boolean(filters.search || filters.status !== "all" || filters.service !== "all" || filters.period !== "all");
  const statusOptions = useMemo(() => {
    const known = ["NEW", "PROCESS", "RECOVERING", "WAITING", "INVITES PAUSED", "PAUSED", "COMPLETED", "PARTIAL", "ERROR", "CANCELLED", "INVALID", "TERMINATED"];
    return [{ value: "all", label: "All delivery statuses" }, { value: "live", label: "In progress" }, { value: "attention", label: "Needs attention" }, ...[...new Set([...known, ...orders.map((order) => String(order.status ?? "NEW").toUpperCase())])].filter((value) => value !== "PROCESS").map((value) => ({ value, label: orderStatus(value).label }))];
  }, [orders]);
  const metrics = [
    { key: "total", title: "All orders", count: stats.total, detail: "Your complete order history", Icon: Layers3, active: !filteredView, onClick: reset },
    { key: "live", title: "In progress", count: stats.live, detail: "Deliveries currently running", Icon: RefreshCw, active: filters.status === "live", onClick: () => { setFilters({ ...EMPTY_ORDERS_FILTERS, status: "live" }); setPage(1); } },
    { key: "soon", title: "Expiring soon", count: stats.soon, detail: "Support ends in the next 7 days", Icon: Timer, active: filters.period === "soon", onClick: () => { setFilters({ ...EMPTY_ORDERS_FILTERS, period: "soon", sort: "expiry_asc" }); setPage(1); } },
    { key: "expired", title: "Expired", count: stats.expired, detail: "Orders with ended support", Icon: Clock3, active: filters.period === "expired", onClick: () => { setFilters({ ...EMPTY_ORDERS_FILTERS, period: "expired", sort: "expiry_desc" }); setPage(1); } }
  ];

  return <section className="orderdesk" aria-label="Order management" aria-busy={loading}>
    <header className="od-heading">
      <div><span className="od-eyebrow">YOUR WORKSPACE</span><h1>Orders<span>{loading ? "—" : number(stats.total)}</span></h1><p>Manage deliveries and keep track of support periods.</p></div>
      <div className="od-heading-actions"><Button type="button" variant="secondary" size="sm" disabled={loading || props.syncing || !props.canSync} onClick={props.onSync}><RefreshCw className={props.syncing ? "animate-spin" : ""} />{props.syncing ? "Syncing…" : "Sync active"}</Button><Button asChild size="sm"><Link to="/manage?tab=create"><Plus />New order</Link></Button></div>
    </header>

    <div className="od-metrics" aria-label="Order overview">{metrics.map(({ key, title, count, detail, Icon, active, onClick }) => <button className="app-panel" type="button" key={key} data-kind={key} aria-pressed={active} onClick={onClick} disabled={loading}>
      <span className="od-metric-title">{title}<Icon /></span><strong>{loading ? <Skeleton className="h-8 w-12" /> : number(count)}</strong><span className="od-metric-detail">{detail}<ArrowUpRight /></span>
    </button>)}</div>

    <div className="od-board app-panel">
      <div className="od-board-heading"><div><h2>Order history</h2><span>{loading ? "Loading your orders…" : `${number(stats.total)} orders in your workspace`}</span></div>
        <div className="stock-duration-filter od-service-tabs" role="group" aria-label="Filter by service">{[{ value: "all", label: "All orders" }, { value: "members", label: "Members" }, { value: "boosts", label: "Boosts" }].map((tab) => <button key={tab.value} type="button" className={filters.service === tab.value ? "is-active" : undefined} aria-pressed={filters.service === tab.value} onClick={() => changeFilter({ service: tab.value })}>{tab.label}</button>)}</div>
      </div>
      <div className="od-toolbar">
        <label className="od-search"><Search aria-hidden="true" /><input type="search" aria-label="Search orders" placeholder="Search server, order ID or service…" value={filters.search} onChange={(event) => changeFilter({ search: event.target.value })} /></label>
        <FilterDropdown className="od-status-filter" label="Delivery status" showLabel={false} portal value={filters.status} onChange={(value) => changeFilter({ status: value })} options={statusOptions} />
        <FilterDropdown className="od-period-filter" label="Support period" showLabel={false} portal value={filters.period} onChange={(value) => changeFilter({ period: value, sort: value === "expired" || value === "leave_failed" ? "expiry_desc" : value === "soon" ? "expiry_asc" : "newest" })} options={[{ value: "all", label: "All support periods" }, { value: "active", label: "Active support" }, { value: "soon", label: "Expiring in 7 days" }, { value: "expired", label: "Expired support" }, { value: "leave_failed", label: "Member removal failed" }]} />
      </div>
      <div className="od-results-bar"><div><span><b>{number(filtered.length)}</b> {filteredView ? "matching orders" : "orders"}</span>{filteredView ? <button type="button" onClick={reset}><X />Clear filters</button> : null}</div>
        <div><ArrowDownWideNarrow aria-hidden="true" /><FilterDropdown label="Order sorting" showLabel={false} portal value={filters.sort} onChange={(value) => changeFilter({ sort: value })} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "expiry_asc", label: "Expiring soonest" }, { value: "expiry_desc", label: filters.period === "expired" ? "Recently expired" : "Latest expiry first" }]} /></div>
      </div>

      <table className="od-table"><colgroup><col className="od-col-order" /><col className="od-col-delivery" /><col className="od-col-reaction" /><col className="od-col-support" /><col className="od-col-created" /><col className="od-col-actions" /></colgroup>
        <thead><tr><th scope="col">Order & service</th><th scope="col">Delivery</th><th scope="col">Reactions</th><th scope="col">Support period</th><th className="od-created-heading" scope="col">Created</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        {loading ? <tbody>{Array.from({ length: 6 }, (_, index) => <tr className="od-skeleton-row" key={index}><td><Skeleton className="h-4 w-40" /><Skeleton className="mt-3 h-3 w-28" /></td><td><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-1 w-32" /></td><td><Skeleton className="h-4 w-28" /></td><td><Skeleton className="h-4 w-20" /></td><td><Skeleton className="h-3 w-20" /></td><td><Skeleton className="h-7 w-16" /></td></tr>)}</tbody> : pagination.items.map((order) => <OrderRow key={order.uniqid} order={{ ...order, customerReactions: reactionOverviews[order.uniqid] ?? order.customerReactions }} now={now} onReactionSettings={(selected) => setReactionSettingsOrder(selected.uniqid)} {...props} />)}
      </table>
      {!loading && !filtered.length ? <div className="od-empty"><span><Search /></span><h3>{orders.length ? "No orders found" : "Your orders start here"}</h3><p>{orders.length ? "No orders match these filters." : "No orders yet."}</p>{orders.length ? <Button type="button" variant="secondary" size="sm" onClick={reset}>Clear filters</Button> : <Button asChild size="sm"><Link to="/manage?tab=create"><Plus />Create an order</Link></Button>}</div> : null}
      {!loading ? <div className="od-board-footer"><ListPagination {...pagination} onChange={setPage} onPageSizeChange={setPageSize} label="Orders pages" showNavigationLabels />{stats.failedLeave > 0 ? <button className="od-failed-shortcut" type="button" onClick={() => { setFilters({ ...EMPTY_ORDERS_FILTERS, period: "leave_failed", sort: "expiry_desc" }); setPage(1); }}><TriangleAlert />{stats.failedLeave} orders need a removal check<ChevronRight /></button> : null}</div> : null}
    </div>
    {reactionSettingsOrder ? <OrderReactionSettingsDialog key={reactionSettingsOrder} uniqid={reactionSettingsOrder} onClose={() => setReactionSettingsOrder(null)} onSaved={(order) => {
      reactionRevision.current += 1;
      if (order.customerReactions) { const { requests, ...overview } = order.customerReactions; setReactionOverviews((current) => ({ ...current, [order.uniqid]: overview })); }
      props.onReactionUpdated(order);
    }} /> : null}
  </section>;
}

export function OrdersWorkspaceLoading() {
  return <OrdersWorkspace orders={[]} loading syncing={false} canSync={false} autoLeavingId={null} resumingId={null} onSync={() => {}} onCopyMonitor={() => {}} onCopyInvite={() => {}} onAutoLeave={() => {}} onDelete={() => {}} onResume={() => {}} onReactionUpdated={() => {}} />;
}
