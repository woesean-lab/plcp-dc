import { useEffect, useId, useRef, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, Copy, Eye, EyeOff, FileJson, KeyRound, LoaderCircle, Shield, TriangleAlert, Users } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { MemberActivityAvatar } from "./MemberActivityAvatar";
import type { CommunityJoinRecord, CommunityStockCategory } from "../lib/community";
import "./MembersStockWorkspace.css";

export function MembersStockSkeleton() {
  return <div className="members-stock-workspace" role="status" aria-label="Loading Members Stock" aria-busy="true"><div className="members-stock-heading"><Skeleton className="h-12 w-64" /><Skeleton className="h-10 w-36" /></div><div className="members-stock-categories">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-32 w-full" />)}</div><div className="members-stock-summary">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-24 w-full" />)}</div><div className="app-panel members-stock-list"><Skeleton className="m-5 h-10 w-64 max-w-full" />{[0, 1, 2, 3].map(index => <div className="members-stock-skeleton-row" key={index}><Skeleton className="h-9 w-9" /><Skeleton className="h-8 w-44 max-w-full" /><Skeleton className="ml-auto h-6 w-24" /></div>)}</div></div>;
}

export function MembersStockCategory({ category, selected, icon, indicators, actions, onSelect }: {
  category: CommunityStockCategory; selected: boolean; icon: ReactNode; indicators: ReactNode; actions: ReactNode; onSelect: () => void;
}) {
  return <article className={`app-panel members-stock-category${selected ? " is-active" : ""}`} data-tone={category.colorKey}>
    <button type="button" className="members-stock-category-select" aria-pressed={selected} onClick={onSelect}>
      <span className="community-category-icon" aria-hidden="true">{icon}</span><span className="members-stock-category-name">{category.name}</span>
      <span className="members-stock-category-count"><strong>{category.summary.ready.toLocaleString("en-US")}</strong><span>available</span></span>
      <span className="members-stock-category-total">{(category.summary.authorized + category.summary.failed).toLocaleString("en-US")} total<span className="members-stock-category-indicators">{indicators}</span></span>
    </button>
    <div className="members-stock-category-footer"><Badge variant={category.isPeriodic ? "secondary" : "outline"}>{category.isPeriodic ? "Period based" : "No period"}</Badge><span className="community-member-row-actions">{actions}</span></div>
  </article>;
}

export function MembersStockSummary({ total, available, active, inactive }: { total: number; available: number; active: number; inactive: number }) {
  return <div className="members-stock-summary" aria-label="Selected category summary">{[
    { label: "Total members", value: total, Icon: Users, tone: "neutral" },
    { label: "Available", value: available, Icon: CheckCircle2, tone: "success" },
    { label: "Active", value: active, Icon: Shield, tone: "neutral" },
    { label: "Inactive", value: inactive, Icon: TriangleAlert, tone: inactive ? "danger" : "neutral" }
  ].map(({ label, value, Icon, tone }) => <div className="app-panel members-stock-stat" key={label} data-tone={tone}><span>{label}<Icon className="h-3.5 w-3.5" aria-hidden="true" /></span><strong>{value.toLocaleString("en-US")}</strong></div>)}</div>;
}

export function MembersStockRow({ record, selected, onSelect, badges, actions, open, onToggle, children }: {
  record: CommunityJoinRecord; selected: boolean; onSelect: (selected: boolean) => void; badges: ReactNode; actions: ReactNode;
  open: boolean; onToggle: () => void; children: ReactNode;
}) {
  const id = useId();
  return <article className="members-stock-row" role="listitem" data-state={record.status} data-selected={selected} onClick={event => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, label, a, select, textarea, summary, code, time, .members-stock-metadata dd, [role='button'], [role='checkbox'], [role='combobox'], [contenteditable='true']")) return;
    if (window.getSelection()?.toString().trim()) return;
    onToggle();
  }}>
    <div className="members-stock-row-heading">
      <input className="community-member-checkbox" type="checkbox" checked={selected} onChange={event => onSelect(event.target.checked)} aria-label={`Select ${record.username}`} />
      <MemberActivityAvatar className="community-recent-avatar" src={record.avatarUrl} fallback={<Users className="h-3.5 w-3.5" />} />
      <div className="members-stock-row-identity"><strong title={record.displayName || record.username}>{record.displayName || record.username}</strong><span title={new Date(record.authorizedAt).toLocaleString()}>@{record.username}<span className="members-stock-row-date"> · {new Date(record.authorizedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></span></div>
      <div className="members-stock-row-badges">{badges}</div>
      <span className="community-member-row-actions members-stock-row-actions">{actions}</span>
      <span className="community-member-row-actions members-stock-row-toggle"><Button type="button" size="icon-sm" variant="ghost" title={`${open ? "Hide" : "Show"} member details`} aria-label={`${open ? "Hide" : "Show"} ${record.username} details`} aria-expanded={open} aria-controls={id} onClick={onToggle}><ChevronDown className={`h-3.5 w-3.5${open ? " rotate-180" : ""}`} /></Button></span>
    </div>
    {open ? <div id={id} className="members-stock-row-details">{children}</div> : null}
  </article>;
}

export function MembersStockBulkActions({ connection, transfer, remove, tokens, order }: {
  connection: ReactNode; transfer: ReactNode; remove: ReactNode; tokens: ReactNode; order: ReactNode;
}) {
  return <div className="members-stock-bulk" role="region" aria-label="Selected member actions">
    <div className="members-stock-bulk-main">
      <div className="members-stock-bulk-group"><span>Onliner</span><div>{connection}</div></div>
      <div className="members-stock-bulk-group"><span>Move to category</span><div>{transfer}</div></div>
      <div className="members-stock-bulk-group members-stock-bulk-remove"><span>Stock</span><div>{remove}</div></div>
    </div>
    <details className="members-stock-bulk-more"><Button asChild size="xs" variant="ghost"><summary>More actions<ChevronDown className="h-3.5 w-3.5" /></summary></Button><div className="members-stock-bulk-extra">
      <div className="members-stock-bulk-group members-stock-bulk-tokens"><span>Export tokens</span><div>{tokens}</div></div>
      <div className="members-stock-bulk-group members-stock-bulk-order"><span>Reorder members</span><div>{order}</div></div>
    </div></details>
  </div>;
}

export function MembersStockMetadata({ accountId, authorizedAt }: { accountId: string; authorizedAt: string }) {
  return <dl className="members-stock-metadata"><div><dt>Account ID</dt><dd>{accountId}</dd></div><div><dt>Authorized</dt><dd>{new Date(authorizedAt).toLocaleString()}</dd></div></dl>;
}

export function MembersStockSecret({ label, username, value, busy, disabled, onToggle, onCopy, expiresAt }: {
  label: "Access token" | "User token"; username: string; value?: string; busy: boolean; disabled: boolean; onToggle: () => void; onCopy: () => void; expiresAt?: string | null;
}) {
  const Icon = label === "Access token" ? KeyRound : Shield;
  return <div className="members-stock-secret"><span className="members-stock-secret-label"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}</span><code>{value || "Hidden"}</code><span className="community-member-row-actions"><Button type="button" size="icon-sm" variant="ghost" aria-label={`${value ? "Hide" : "Show"} ${username} ${label.toLowerCase()}`} title={`${value ? "Hide" : "Show"} ${label.toLowerCase()}`} disabled={disabled} onClick={onToggle}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : value ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button>{value ? <Button type="button" size="icon-sm" variant="ghost" aria-label={`Copy ${username} ${label.toLowerCase()}`} title={`Copy ${label.toLowerCase()}`} onClick={onCopy}><Copy className="h-3.5 w-3.5" /></Button> : null}</span>{expiresAt ? <time dateTime={expiresAt}>Expires {new Date(expiresAt).toLocaleString()}</time> : null}</div>;
}

export function MembersStockImportDialog({ busy, category, onClose, children }: { busy: boolean; category: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  const close = () => { if (!busy) dialog.current?.close(); };
  return <dialog ref={dialog} className="confirm-modal members-stock-import-dialog" aria-labelledby={`${id}-title`} onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }} onClick={event => { if (event.target !== event.currentTarget || busy) return; const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); }}><header><span className="monitor-panel-icon" aria-hidden="true"><FileJson className="h-4 w-4" /></span><div><p className="app-kicker">Stock import</p><h2 id={`${id}-title`}>Import OAuth accounts</h2><p>{category} · JSON up to 10 MB / 5,000 records</p></div></header><div className="members-stock-import-body">{children}</div><footer><Button type="button" variant="secondary" size="sm" disabled={busy} onClick={close}>Close</Button></footer></dialog>;
}
