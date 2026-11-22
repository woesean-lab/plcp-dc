import type { ReactNode } from "react";
import { Badge, type BadgeProps } from "./badge";
import "./status-field.css";

export function StatusField({ label, state, value, icon, details, variant }: {
  label: string; state?: string; value?: string; icon: ReactNode; details?: string; variant?: BadgeProps["variant"];
}) {
  if (!value?.trim()) return null;
  const status = state?.toLowerCase().trim();
  const tone = variant ?? (["active", "joined", "boosted", "success", "connected"].includes(status ?? "") ? "success"
    : ["failed", "blocked", "inactive", "error"].includes(status ?? "") ? "destructive"
    : ["joining", "replacing", "processing", "running", "verifying", "connecting", "reconnecting"].includes(status ?? "") ? "default"
    : "secondary");
  return <Badge className="member-delivery-field" variant={tone} data-state={state} title={details ? `${value} · ${details}` : value}>
    <span className="status-field-label">{icon}<span>{label}</span></span>
    <span className="member-delivery-value"><span>{value}</span></span>
  </Badge>;
}
