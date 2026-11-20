export function ReactionAllowanceIndicator({ remaining, limit }: { remaining: number; limit: number }) {
  const total = Number.isFinite(limit) ? Math.max(0, limit) : 0;
  const available = Number.isFinite(remaining) ? Math.min(total, Math.max(0, remaining)) : 0;
  return <span className="reaction-allowance-indicator" role="meter" aria-label="Daily reactions remaining"
    aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={available} aria-valuetext={`${available} of ${total} reactions available today`}>
    <span className="reaction-allowance-numbers" aria-hidden="true"><b>{available.toLocaleString("en-US")}</b><span>/ {total.toLocaleString("en-US")}</span></span>
    <span className="monitor-reaction-progress-track reaction-allowance-track" aria-hidden="true"><i style={{ width: `${total ? available / total * 100 : 0}%` }} /></span>
  </span>;
}
