import { RefreshCw } from "lucide-react";

export function OrderAutoReplaceOption({ checked, onChange, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return <label className={`boost-proxy-toggle ${checked ? "is-enabled" : ""}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span><RefreshCw className="h-4 w-4" aria-hidden="true" /></span>
    <strong>Auto-replace</strong>
    <small>Replace failed deliveries after each round, up to the limit in Settings.</small>
  </label>;
}
