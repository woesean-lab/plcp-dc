import { useId, useState, type MouseEvent, type ReactNode } from "react";
import { CheckCircle2, ChevronDown, LogOut, RadioTower, ShieldCheck, TriangleAlert } from "lucide-react";
import type { CommunityMemberResult } from "../types";
import { Button } from "./ui/button";
import "./MemberDeliveryRow.css";

function StatusField({ label, state, value, icon, details }: {
  label: string; state?: string; value?: string; icon: ReactNode; details?: string;
}) {
  if (!value?.trim()) return null;

  return <div className="member-delivery-field">
    <dt>{icon}<span>{label}</span></dt>
    <dd className="member-delivery-value" data-state={state} title={details}>
      <span>{value}</span>
    </dd>
  </div>;
}

export function MemberDeliveryRow({ item, formatTime }: {
  item: CommunityMemberResult;
  formatTime: (value: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
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
  const toggleDetails = () => setExpanded((current) => !current);

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
        <span className="community-order-avatar" aria-hidden="true">
          {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <span>{String(item.index + 1).padStart(2, "0")}</span>}
        </span>
        <div className="member-delivery-identity-copy">
          <strong>{item.username}</strong>
          <time dateTime={timestamp}>{timestamp ? formatTime(timestamp) : "—"}</time>
        </div>
      </div>
      <dl className="member-delivery-statuses">
        <StatusField label="OAuth" state={item.authorizationStatus} value={item.authorizationStatus} details={item.authorizationDetails} icon={<ShieldCheck aria-hidden="true" />} />
        <StatusField label={leaveStatus ? "Auto Leave" : "Membership"} state={leaveState || (item.membershipStatus === "removed" ? "removed" : undefined)} value={leaveLabel || (item.membershipStatus === "removed" ? "Left server" : undefined)} details={leaveStatus ? item.autoLeaveDetails : item.membershipDetails} icon={leaveStatus === "failed" ? <TriangleAlert aria-hidden="true" /> : <LogOut aria-hidden="true" />} />
        <StatusField label="Onliner" state={typeof item.onlinerLive === "boolean" ? item.onlinerLive ? "active" : "inactive" : undefined} value={typeof item.onlinerLive === "boolean" ? item.onlinerLive ? "Online" : "Offline" : undefined} details={item.onlinerDetails} icon={<RadioTower aria-hidden="true" />} />
        <StatusField label="Delivery" state={item.state.toLowerCase()} value={item.state.replace(/_/g, " ")} icon={["failed", "blocked"].includes(item.state.toLowerCase()) ? <TriangleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />} />
      </dl>
      <span className="community-member-row-actions">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${expanded ? "Hide" : "Show"} details for ${item.username}`} aria-expanded={expanded} aria-controls={notesId} title={expanded ? "Hide details" : "Show details"} onClick={toggleDetails}>
          <ChevronDown className="member-delivery-details-chevron h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </span>
    </div>
    <div id={notesId} className="member-delivery-notes" hidden={!expanded}>
      <p><span>Delivery</span>{item.details}</p>
      {item.reactionState && item.reactionState !== "completed" && item.reactionDetails ? <p data-state={item.reactionState}><span>Reaction</span>{item.reactionEmoji} {item.reactionDetails}</p> : null}
      {item.autoLeaveDetails ? <p data-state={item.autoLeaveStatus}><span>Auto Leave</span>{item.autoLeaveDetails}</p> : null}
    </div>
  </article>;
}
