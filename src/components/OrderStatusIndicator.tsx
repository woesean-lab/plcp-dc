import { Skeleton } from "./ui/skeleton";
import "./OrderStatusIndicator.css";

export function OrderStatusIndicator({ status = "New", loading = false }: { status?: string; loading?: boolean }) {
  const normalized = status.trim().toLowerCase();
  const tone = normalized.includes("completed") ? "success"
    : ["error", "invalid", "terminated", "canceled", "cancelled", "failed", "invites paused"].some((value) => normalized.includes(value)) ? "danger"
    : normalized.includes("paused") ? "paused"
    : ["new", "pending", "unknown", "unavailable"].includes(normalized) || normalized.includes("waiting") ? "waiting"
    : "active";
  const label = normalized.replace(/[_-]+/g, " ");
  return <span className="order-status-indicator" data-tone={tone} aria-busy={loading}>
    <span className="order-status-indicator-dot" aria-hidden="true" />
    {loading ? <Skeleton className="h-3 w-16" /> : <span>{label ? label.charAt(0).toUpperCase() + label.slice(1) : "Unknown"}</span>}
  </span>;
}
