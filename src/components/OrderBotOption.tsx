import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { getCommunityBotPool, type PoolBot } from "../lib/community";

export type OrderBotDraft = { enabled: boolean };
export const EMPTY_ORDER_BOT: OrderBotDraft = { enabled: false };

export function OrderBotOption({ value, onChange, onAvailabilityChange, serverName = "", disabled = false, unavailable = false, preview = false }: {
  value: OrderBotDraft; onChange: (value: OrderBotDraft) => void; onAvailabilityChange?: (ready: boolean) => void;
  serverName?: string; disabled?: boolean; unavailable?: boolean; preview?: boolean;
}) {
  const id = useId();
  const [loading, setLoading] = useState(false);
  const [bots, setBots] = useState<PoolBot[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const ready = useRef(onAvailabilityChange);
  ready.current = onAvailabilityChange;
  useEffect(() => {
    ready.current?.(false);
    if (!value.enabled || preview) { if (preview) ready.current?.(true); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    void getCommunityBotPool(controller.signal).then(result => {
      if (!controller.signal.aborted) { setBots(result.bots); ready.current?.(result.bots.some(bot => bot.enabled)); }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load bot pool."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [value.enabled, revision, preview]);
  const count = preview ? 2 : bots.filter(bot => bot.enabled).length;
  return <div className="order-bot-option">
    <label className={"boost-proxy-toggle " + (value.enabled ? "is-enabled" : "")}>
      <input type="checkbox" checked={value.enabled} disabled={disabled || unavailable} onChange={event => onChange({ enabled: event.target.checked })} aria-controls={id} aria-expanded={value.enabled} />
      <span><Bot className="h-4 w-4" aria-hidden="true" /></span><strong>Bot pool{serverName ? " · " + serverName : ""}</strong>
      <small>{unavailable ? "Available for bot-based delivery." : "Automatically assign the least loaded bot."}</small>
    </label>
    {value.enabled ? <div id={id} className="app-panel-soft order-bot-fields">
      <div className="bot-pool-option-status" role="status">{loading ? <><LoaderCircle className="h-4 w-4 animate-spin" />Loading bot pool…</> : error ? <span role="alert">{error}</span> : <span>{count ? count + " enabled bot" + (count === 1 ? "" : "s") + " · Assigned when the order is created." : "No enabled bots. Add a bot in Settings."}</span>}
        <Button type="button" size="xs" variant="secondary" disabled={disabled || loading} onClick={() => setRevision(current => current + 1)}><RefreshCw className="h-3.5 w-3.5" />{error ? "Retry" : "Refresh"}</Button>
      </div>
      <p className="settings-field-note">The assigned bot stays with this order for delivery and replacements.</p>
      {disabled ? <Button type="button" size="sm" variant="ghost" disabled>Manage bot pool</Button> : <Button asChild size="sm" variant="ghost"><Link to="/manage?tab=settings&settings=bot-pool">Manage bot pool</Link></Button>}
    </div> : null}
  </div>;
}
