import { useId } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "./ui/badge";
import { CUSTOMER_REACTION_LIMITS } from "../../shared/reaction-limits.mjs";

export function OrderReactionOption({ enabled, memberCount, dailyLimit, onEnabledChange, onDailyLimitChange }: {
  enabled: boolean;
  memberCount: number;
  dailyLimit: number;
  onEnabledChange: (enabled: boolean) => void;
  onDailyLimitChange: (limit: number) => void;
}) {
  const id = useId();
  return <div className="community-reaction-option-field">
    <div className={`boost-proxy-toggle community-reaction-option ${enabled ? "is-enabled" : ""}`}>
      <label className="community-reaction-option-toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} />
        <span className="monitor-panel-icon" aria-hidden="true"><Sparkles className="h-4 w-4" /></span>
        <span className="community-reaction-option-copy"><strong id={`${id}-title`}>Customer reactions</strong><small id={`${id}-description`}>Available during support.</small></span>
      </label>
      <div className="community-reaction-option-limits">
        <Badge variant="secondary" id={`${id}-allowance`}>First day: {Number.isFinite(memberCount) ? Math.max(0, memberCount).toLocaleString("en-US") : "—"}</Badge>
        <span className="boost-order-label">Then / day</span>
        <div className="stock-duration-filter" role="group" aria-label="Reactions per day after the first day" aria-describedby={`${id}-allowance`} aria-disabled={!enabled}>
          {CUSTOMER_REACTION_LIMITS.map((limit) => <button key={limit} type="button" className={`${dailyLimit === limit ? "is-active" : ""} disabled:pointer-events-none`} disabled={!enabled} aria-pressed={dailyLimit === limit} onClick={() => onDailyLimitChange(limit)}>{limit}</button>)}
        </div>
      </div>
    </div>
  </div>;
}
