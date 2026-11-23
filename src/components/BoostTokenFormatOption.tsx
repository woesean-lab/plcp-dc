import { KeyRound } from "lucide-react";

export function BoostTokenFormatOption({ checked, onChange, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return <label className={`boost-proxy-toggle ${checked ? "is-enabled" : ""}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span><KeyRound className="h-4 w-4" aria-hidden="true" /></span>
    <strong>Remove 2FA field</strong>
    <small>Request only. Stock keeps all four fields.</small>
  </label>;
}
