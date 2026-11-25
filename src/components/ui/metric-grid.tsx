import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import "./metric-grid.css";

export type MetricItem = { label: string; value: number; icon?: ReactNode; tone?: "neutral" | "success" };

export function MetricGrid({ items, label, className }: { items: MetricItem[]; label: string; className?: string }) {
  return <div className={cn("metric-grid-container", className)}><dl className="app-panel-soft metric-grid" aria-label={label}>
    {items.map(item => <div className="metric-grid-item" key={item.label} data-tone={item.tone || "neutral"}>
      <dt><span title={item.label}>{item.label}</span>{item.icon ? <span className="metric-grid-icon" aria-hidden="true">{item.icon}</span> : null}</dt>
      <dd title={item.value.toLocaleString("en-US")}>{item.value.toLocaleString("en-US")}</dd>
    </div>)}
  </dl></div>;
}
