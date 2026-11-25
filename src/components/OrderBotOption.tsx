import { useEffect, useId, useRef, useState } from "react";
import { Bot, LoaderCircle } from "lucide-react";
import { Input } from "./ui/input";
import { SecretField } from "./SettingsWorkspace";
import { inspectCommunityOrderBot } from "../lib/community";

export type OrderBotDraft = { enabled: boolean; botToken: string; clientSecret: string; clientId: string; botName: string };
export const EMPTY_ORDER_BOT: OrderBotDraft = { enabled: false, botToken: "", clientSecret: "", clientId: "", botName: "" };

export function OrderBotOption({ value, onChange, guildId = "", serverName = "", disabled = false, unavailable = false, preview = false }: {
  value: OrderBotDraft; onChange: (value: OrderBotDraft) => void; guildId?: string; serverName?: string;
  disabled?: boolean; unavailable?: boolean; preview?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const fieldsId = useId();
  const [error, setError] = useState("");
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => {
    setError("");
    setLoading(false);
    if (!value.enabled || !value.botToken.trim() || preview) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void inspectCommunityOrderBot(value.botToken.trim(), guildId, controller.signal).then(identity => {
        if (!controller.signal.aborted) latest.current.onChange({ ...latest.current.value, clientId: identity.clientId, botName: identity.botName });
      }).catch(reason => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Bot could not be verified.");
          latest.current.onChange({ ...latest.current.value, clientId: "", botName: "" });
        }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 600);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [value.enabled, value.botToken, guildId, preview]);
  return <div className="order-bot-option">
    <label className={`boost-proxy-toggle ${value.enabled ? "is-enabled" : ""}`}>
      <input type="checkbox" checked={value.enabled} disabled={disabled || unavailable} onChange={event => onChange({ ...value, enabled: event.target.checked })} aria-controls={fieldsId} aria-expanded={value.enabled} />
      <span><Bot className="h-4 w-4" aria-hidden="true" /></span>
      <strong>New bot{serverName ? ` · ${serverName}` : ""}</strong>
      <small>{unavailable ? "Available for bot-based delivery." : "Use a separate bot for this order."}</small>
    </label>
    {value.enabled ? <div id={fieldsId} className="app-panel-soft order-bot-fields">
      <div className="order-bot-field-grid">
        <label className="settings-field"><span className="field-label">Client ID</span><Input value={value.clientId} readOnly placeholder="Detected from bot token" /></label>
        <label className="settings-field"><span className="field-label">Stock server ID</span><Input value={guildId} readOnly placeholder="Detected from server invite" /></label>
        <SecretField label="Client secret" value={value.clientSecret} disabled={disabled} autoComplete="new-password" placeholder="Discord client secret" onChange={event => onChange({ ...value, clientSecret: event.target.value })} />
        <SecretField label="Bot token" value={value.botToken} disabled={disabled} autoComplete="new-password" placeholder="Discord bot token" onChange={event => onChange({ ...value, botToken: event.target.value, clientId: "", botName: "" })} />
      </div>
      <p className="settings-field-note">{loading ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Checking bot…</> : value.botName ? `Bot: ${value.botName}` : "Enter the new bot credentials."}</p>
      <label className="settings-field"><span className="field-label">OAuth redirect URL</span><Input value={`${window.location.origin}/api/community/oauth/callback`} readOnly /></label>
      {error ? <p className="text-sm text-[var(--app-danger)]" role="alert">{error}</p> : null}
    </div> : null}
  </div>;
}
