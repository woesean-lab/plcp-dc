import { Sparkles } from "lucide-react";
import { Button } from "./ui/button";

export function OrderReactionAccessCard({ disabled = false, configured = false, onManage }: {
  disabled?: boolean;
  configured?: boolean;
  onManage: () => void;
}) {
  return <div className="order-reaction-access-card monitor-panel-heading">
    <span className="monitor-panel-icon" aria-hidden="true"><Sparkles className="h-4 w-4" /></span>
    <div><p className="app-kicker">Reaction control</p><h2>Reactions</h2><p className="text-xs text-[var(--app-muted)]">{disabled ? "Disabled for this order." : configured ? "Reactions are currently unavailable." : "Not enabled for this order."}</p></div>
    <Button type="button" variant="secondary" size="sm" onClick={onManage}><Sparkles className="h-4 w-4" />{configured && !disabled ? "Manage reactions" : "Enable reactions"}</Button>
  </div>;
}
