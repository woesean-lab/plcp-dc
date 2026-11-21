import { createContext, useContext, useId, useState, type MouseEvent, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, LogOut, RadioTower, ShieldCheck, TriangleAlert } from "lucide-react";
import type { CommunityMemberResult } from "../types";
import { publicMemberDeliveryCopy } from "../lib/member-delivery-copy";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { MemberActivityAvatar } from "./MemberActivityAvatar";
import "./MemberDeliveryRow.css";

const MemberDeliveryAccordionContext = createContext<{
  expandedIndex: number | null;
  toggle: (index: number) => void;
} | null>(null);

export function MemberDeliveryAccordion({ children }: { children: ReactNode }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  return <MemberDeliveryAccordionContext.Provider value={{
    expandedIndex,
    toggle: index => setExpandedIndex(current => current === index ? null : index)
  }}>{children}</MemberDeliveryAccordionContext.Provider>;
}

function StatusField({ label, state, value, icon, details }: {
  label: string; state?: string; value?: string; icon: ReactNode; details?: string;
}) {
  if (!value?.trim()) return null;

  const status = state?.toLowerCase();
  const variant = status === "active" || status === "joined" ? "success"
    : status === "failed" || status === "blocked" || status === "inactive" ? "destructive"
    : status === "joining" || status === "replacing" || status === "processing" ? "default"
    : "secondary";

  return <Badge className="member-delivery-field" variant={variant} data-state={state} title={details ? `${value} · ${details}` : value}>
    <dt>{icon}<span>{label}</span></dt>
    <dd className="member-delivery-value">
      <span>{value}</span>
    </dd>
  </Badge>;
}

export function MemberDeliveryRow({ item, formatTime, audience = "admin" }: {
  item: CommunityMemberResult;
  formatTime: (value: string) => string;
  audience?: "admin" | "public";
}) {
  const copy = audience === "public" ? publicMemberDeliveryCopy(item) : null;
  const accordion = useContext(MemberDeliveryAccordionContext);
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = accordion ? accordion.expandedIndex === item.index : localExpanded;
  const notesId = useId();
  const leaveStatus = item.autoLeaveStatus;
  const leaveState = leaveStatus === "left" || leaveStatus === "already_left" ? "removed"
    : leaveStatus === "processing" ? "joining" : leaveStatus;
  const leaveLabel = leaveStatus === "waiting"
    ? `Leave queued${item.autoLeaveScheduledAt ? ` · ${formatTime(item.autoLeaveScheduledAt)}` : ""}`
    : leaveStatus === "processing" ? "Leaving..."
    : leaveStatus === "left" ? "Auto leave"
    : leaveStatus === "already_left" ? "Already outside"
    : leaveStatus === "failed" ? "Leave failed" : leaveStatus;
  const timestamp = item.autoLeaveCompletedAt || item.autoLeaveScheduledAt || item.completedAt;
  const toggleDetails = () => accordion ? accordion.toggle(item.index) : setLocalExpanded(current => !current);

  function handleRowClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest("a, button, input, select, textarea, summary, [role='button'], [role='link'], [contenteditable='true']")) return;
    if (window.getSelection()?.toString()) return;
    toggleDetails();
  }

  return <article className="community-order-result member-delivery-row" data-state={item.state.toLowerCase()} aria-label={item.username} onClick={handleRowClick}>
    <div className="member-delivery-overview">
      <div className="member-delivery-identity">
        <MemberActivityAvatar className="community-order-avatar" src={item.avatarUrl} state={item.state} fallback={<span>{String(item.index + 1).padStart(2, "0")}</span>} />
        <div className="member-delivery-identity-copy">
          <strong>{item.username}</strong>
          <time dateTime={timestamp}>{timestamp ? formatTime(timestamp) : "—"}</time>
        </div>
      </div>
      <dl className="member-delivery-statuses">
        <StatusField label={copy ? "Access" : "OAuth"} state={item.authorizationStatus} value={copy ? copy.authorizationValue : item.authorizationStatus} details={copy ? copy.authorizationDetails : item.authorizationDetails} icon={<ShieldCheck aria-hidden="true" />} />
        <StatusField label={leaveStatus ? copy ? "Leaving" : "Auto Leave" : "Membership"} state={leaveState || (item.membershipStatus === "removed" ? "removed" : undefined)} value={(copy && leaveStatus ? copy.leaveValue : leaveLabel) || (item.membershipStatus === "removed" ? "Left server" : undefined)} details={copy ? leaveStatus ? copy.leaveDetails : copy.membershipDetails : leaveStatus ? item.autoLeaveDetails : item.membershipDetails} icon={leaveStatus === "failed" ? <TriangleAlert aria-hidden="true" /> : <LogOut aria-hidden="true" />} />
        <StatusField label={copy ? "Status" : "Onliner"} state={typeof item.onlinerLive === "boolean" ? item.onlinerLive ? "active" : "inactive" : undefined} value={typeof item.onlinerLive === "boolean" ? item.onlinerLive ? "Online" : "Offline" : undefined} details={copy ? copy.onlinerDetails : item.onlinerDetails} icon={<RadioTower aria-hidden="true" />} />
        <StatusField label="Delivery" state={item.state.toLowerCase()} value={copy ? copy.deliveryValue : item.state.replace(/_/g, " ")} icon={["failed", "blocked"].includes(item.state.toLowerCase()) ? <TriangleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />} />
      </dl>
      <span className="community-member-row-actions">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${expanded ? "Hide" : "Show"} details for ${item.username}`} aria-expanded={expanded} aria-controls={notesId} title={expanded ? "Hide details" : "Show details"} onClick={toggleDetails}>
          <ChevronDown className="member-delivery-details-chevron h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </span>
    </div>
    <div id={notesId} className="member-delivery-notes" hidden={!expanded}>
      <p><span>Delivery</span>{copy ? copy.deliveryDetails : item.details}</p>
      {item.reactionState && item.reactionState !== "completed" && item.reactionDetails ? <p data-state={item.reactionState}><span>Reaction</span>{item.reactionEmoji} {copy ? copy.reactionDetails : item.reactionDetails}</p> : null}
      {item.autoLeaveDetails ? <p data-state={item.autoLeaveStatus}><span>{copy ? "Leaving" : "Auto Leave"}</span>{copy ? copy.leaveDetails : item.autoLeaveDetails}</p> : null}
    </div>
  </article>;
}
