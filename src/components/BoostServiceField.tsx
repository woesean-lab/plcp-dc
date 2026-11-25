import { ArrowUpRight, Cable, Check, Gem, Globe2 } from "lucide-react";
import type { BoostProvider } from "../types";

export function BoostServiceField({ value, onChange, disabled = false, useProxy = true, onSolarix }: {
  value: BoostProvider;
  onChange: (value: BoostProvider) => void;
  disabled?: boolean;
  useProxy?: boolean;
  onSolarix?: () => void;
}) {
  return <div className="community-speed-profile-field">
    <div className="community-speed-profile-copy">
      <span className="boost-order-label">Boost service</span>
      <small>Delivery provider.</small>
    </div>
    <div className={`community-speed-profile-options boost-service-options${onSolarix ? " has-solarix" : ""}`} role="group" aria-label="Boost service">
      {([{ key: "dcord", label: "Dcord", detail: useProxy ? "Uses your proxy" : "No proxy required", Icon: Cable }, { key: "salta7", label: "Salta7", detail: "No proxy required", Icon: Globe2 }] as const).map(({ key, label, detail, Icon }) => <button
        key={key} type="button" className={`${value === key ? "is-selected " : ""}disabled:pointer-events-none disabled:opacity-45`}
        aria-pressed={value === key} disabled={disabled} onClick={() => onChange(key)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="community-speed-option-copy"><strong>{label}</strong><small>{detail}</small></span>
        <Check className={`h-3.5 w-3.5${value === key ? "" : " invisible"}`} aria-hidden="true" />
      </button>)}
      {onSolarix ? <button type="button" disabled={disabled} aria-haspopup="dialog" onClick={onSolarix} className="disabled:pointer-events-none disabled:opacity-45"><Gem className="h-4 w-4" aria-hidden="true" /><span className="community-speed-option-copy"><strong>SolarixAIO</strong><small>Solarix stock</small></span><ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
    </div>
  </div>;
}
