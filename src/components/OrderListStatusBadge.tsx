import { ChartPie, CircleAlert, CircleCheck, CircleDashed, Clock3, Pause } from "lucide-react";

export function OrderListStatusBadge({ status = "New" }: { status?: string }) {
  const normalized = status.trim().toLowerCase();
  const tone = normalized.includes("completed") ? "success"
    : ["error", "invalid", "terminated", "canceled", "cancelled", "failed", "invites paused"].some((value) => normalized.includes(value)) ? "danger"
    : normalized.includes("paused") ? "paused"
    : normalized.includes("partial") ? "partial"
    : ["new", "pending", "unknown", "unavailable"].includes(normalized) || normalized.includes("waiting") ? "waiting"
    : "active";
  const Icon = tone === "success" ? CircleCheck : tone === "danger" ? CircleAlert : tone === "paused" ? Pause : tone === "partial" ? ChartPie : tone === "waiting" ? Clock3 : CircleDashed;
  const label = normalized.replace(/[_-]+/g, " ");
  return <span className="orders-status-badge status-badge" data-tone={tone} data-status={normalized}>
    <Icon aria-hidden="true" />
    <span>{label ? label.charAt(0).toUpperCase() + label.slice(1) : "Unknown"}</span>
  </span>;
}
