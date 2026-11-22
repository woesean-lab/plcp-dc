import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import "./OrderDetailDisclosure.css";

export function OrderDetailDisclosure({ title, kicker, icon, children }: {
  title: string;
  kicker: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return <details className="monitor-reaction-panel monitor-control-panel is-collapsible order-detail-disclosure" aria-labelledby={titleId}>
    <summary className="monitor-panel-heading monitor-reaction-collapse-toggle">
      <span className="monitor-panel-icon" aria-hidden="true">{icon}</span>
      <span><span className="app-kicker">{kicker}</span><strong id={titleId}>{title}</strong></span>
      <ChevronDown aria-hidden="true" />
    </summary>
    {children}
  </details>;
}
