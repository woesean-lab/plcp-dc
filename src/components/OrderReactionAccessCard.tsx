import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function OrderReactionAccessCard({ disabled = false, dailyLimit = 0, firstDayLimit = 0, onManage }: {
  disabled?: boolean;
  dailyLimit?: number;
  firstDayLimit?: number;
  onManage: () => void;
}) {
  const configured = dailyLimit > 0;
  return <section className="order-reaction-access-card" aria-label="Reaction access">
    <div className="order-reaction-access-layout">
      <div className="order-reaction-access-intro">
        <div className="monitor-panel-heading">
          <span className="monitor-panel-icon" aria-hidden="true"><Sparkles className="h-4 w-4" /></span>
          <div>
            <p className="app-kicker">Reaction control</p>
            <div className="order-reaction-access-title"><h2>Message reactions</h2><Badge variant="secondary">{disabled ? "Disabled" : configured ? "Unavailable" : "Not enabled"}</Badge></div>
          </div>
        </div>
        {!disabled ? <p className="order-reaction-access-description">Let this order’s members react to Discord messages. Choose a daily allowance to get started.</p> : null}
      </div>
      <dl className="order-reaction-access-limits app-panel-soft">
        <div><dt>First-day allowance</dt><dd>{firstDayLimit > 0 ? firstDayLimit.toLocaleString("en-US") : "Order amount"}</dd></div>
        <div><dt>Daily limit</dt><dd>{configured ? <>{dailyLimit.toLocaleString("en-US")}<small> / day</small></> : "Set on activation"}</dd></div>
      </dl>
    </div>
    <div className="order-reaction-access-footer">
      <span><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Available during support</span>
      <Button type="button" size="sm" onClick={onManage}>{configured && !disabled ? "Manage reactions" : "Enable reactions"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
  </section>;
}
