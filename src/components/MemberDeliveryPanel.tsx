import type { MouseEvent, ReactNode } from "react";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Pause, Users } from "lucide-react";
import "./MemberDeliveryPanel.css";

type Operation = "checking" | "leaving" | "replacing" | "retrying";

export function MemberDeliveryPanel({ id, completed, total, status, operation, checkingProgress, attention = false, audience = "admin", actions, children }: {
  id?: string;
  completed: number;
  total: number;
  status: string;
  operation?: Operation;
  checkingProgress?: { checked: number; total: number } | null;
  attention?: boolean;
  audience?: "admin" | "public";
  actions?: ReactNode;
  children: ReactNode;
}) {
  const count = Number.isFinite(total) ? Math.max(0, total) : 0;
  const processed = Math.min(count, Number.isFinite(completed) ? Math.max(0, completed) : 0);
  const checking = operation === "checking";
  const progressTotal = checking && checkingProgress?.total && Number.isFinite(checkingProgress.total) ? Math.max(0, checkingProgress.total) : count;
  const progressCompleted = checking
    ? Math.min(progressTotal, Math.max(0, Number.isFinite(checkingProgress?.checked) ? checkingProgress!.checked : 0))
    : processed;
  const progress = progressTotal ? Math.round(progressCompleted / progressTotal * 100) : 0;
  const normalized = status.toUpperCase();
  const done = count > 0 && processed >= count;
  const paused = normalized.includes("PAUSED");
  const stopped = ["ERROR", "INVALID", "TERMINATED", "CANCELLED"].includes(normalized);
  const active = Boolean(operation) || (!done && !paused && ["PROCESS", "RECOVERING"].includes(normalized));
  const needsReview = !active && (attention || ["PARTIAL", "ERROR", "INVALID", "TERMINATED"].includes(normalized));
  const operationLabel = { checking: "Checking members", leaving: "Members leaving", replacing: "Replacing members", retrying: "Retrying members" };
  const label = operation ? operationLabel[operation] : paused ? "Delivery paused" : stopped ? "Delivery stopped"
    : done ? needsReview ? "Completed with issues" : "Delivery complete" : active ? "Delivery in progress" : "Waiting for delivery";
  const Icon = active ? LoaderCircle : paused ? Pause : needsReview ? CircleAlert : done ? Check : Users;
  const progressVerb = checking ? "checked" : "processed";
  const summary = progressTotal ? progressCompleted + " of " + progressTotal + " " + progressVerb + " · " + progress + "%" : progressCompleted + " " + progressVerb;
  function handleSummaryClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, select, textarea, [role=button]")) event.preventDefault();
  }
  return <details open id={id} className="monitor-reaction-panel monitor-control-panel is-collapsible community-order-log member-delivery-panel" data-audience={audience} aria-label="Per-member delivery">
    <summary className="monitor-panel-heading monitor-reaction-collapse-toggle member-delivery-panel-toggle" onClick={handleSummaryClick}>
      <span className="monitor-panel-icon" aria-hidden="true"><Users className="h-4 w-4" /></span>
      <span><span className="app-kicker">Member results</span><strong>Per-member delivery log</strong></span>
      <div className="humanizer-run-actions">
        {actions ? <div className="member-delivery-panel-actions">{actions}</div> : null}
        <div className="humanizer-run-outcome" data-state={active ? "running" : needsReview ? "attention" : done && !paused && !stopped ? "success" : "stopped"} role="status">
          <span className="humanizer-run-outcome-icon" aria-hidden="true"><Icon className={"h-4 w-4" + (active ? " animate-spin" : "")} /></span>
          <span className="humanizer-run-outcome-copy"><strong>{label}</strong><small>{summary}</small></span>
        </div>
      </div>
      <ChevronDown className="member-delivery-panel-chevron h-4 w-4" aria-hidden="true" />
    </summary>
    <div className="humanizer-run-body">
      <div className="humanizer-progress" role="progressbar" aria-label={checking ? "Member check progress" : "Member delivery progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-valuetext={summary}>
        <span style={{ width: progress + "%" }} />
      </div>
      {children}
    </div>
  </details>;
}
