import { useId } from "react";
import { Sparkles } from "lucide-react";
import { FilterDropdown } from "./ui/filter-dropdown";
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
        <div className="community-reaction-first-day">
          <span className="boost-order-label">First day</span>
          <div className="community-reaction-first-amount" data-enabled={enabled}><strong>{Number.isFinite(memberCount) ? Math.max(0, memberCount).toLocaleString("en-US") : "—"}</strong><small>reactions</small></div>
        </div>
        <div className="boost-order-field">
          <span className="boost-order-label">Then per day</span>
          <FilterDropdown label="Reactions per day after the first day" showLabel={false} portal value={String(dailyLimit)} disabled={!enabled}
            options={CUSTOMER_REACTION_LIMITS.map((limit) => ({ value: String(limit), label: `${limit} / day` }))} onChange={(value) => onDailyLimitChange(Number(value))} />
        </div>
      </div>
    </div>
  </div>;
}
