import { Skeleton } from "./ui/skeleton";
import { ChartPie, CircleAlert, CircleCheck, CircleDashed, Clock3, Pause } from "lucide-react";
import "./OrderStatusIndicator.css";

export function OrderStatusIndicator({ status = "New", loading = false }: { status?: string; loading?: boolean }) {
  const normalized = status.trim().toLowerCase();
  const tone = normalized.includes("completed") ? "success"
    : ["error", "invalid", "terminated", "canceled", "cancelled", "failed", "invites paused"].some((value) => normalized.includes(value)) ? "danger"
    : normalized.includes("paused") ? "paused"
    : normalized.includes("partial") ? "partial"
    : ["new", "pending", "unknown", "unavailable"].includes(normalized) || normalized.includes("waiting") ? "waiting"
    : "active";
  const label = normalized.replace(/[_-]+/g, " ");
  const Icon = tone === "success" ? CircleCheck : tone === "danger" ? CircleAlert : tone === "paused" ? Pause : tone === "partial" ? ChartPie : tone === "waiting" ? Clock3 : CircleDashed;
  return <span className="lookup-status order-status-indicator" data-tone={tone} aria-busy={loading}>
    <small>Status</small>
    <strong className="order-status-value"><Icon aria-hidden="true" />
      {loading ? <Skeleton className="h-3 w-16" /> : <span>{label ? label.charAt(0).toUpperCase() + label.slice(1) : "Unknown"}</span>}
    </strong>
  </span>;
}
