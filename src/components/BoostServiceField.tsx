import { Cable, Check, Gem, Globe2 } from "lucide-react";
import type { BoostProvider } from "../types";
export type BoostServiceChoice = BoostProvider | "solarix";

export function BoostServiceField({ value, onChange, disabled = false, useProxy = true }: {
  value: BoostServiceChoice;
  onChange: (value: BoostServiceChoice) => void;
  disabled?: boolean;
  useProxy?: boolean;
}) {
  return <div className="community-speed-profile-field">
    <div className="community-speed-profile-copy">
      <span className="boost-order-label">Boost service</span>
      <small>Delivery provider.</small>
    </div>
    <div className="community-speed-profile-options boost-service-options has-solarix" role="group" aria-label="Boost service">
      {([{ key: "dcord", label: "Dcord", detail: useProxy ? "Uses your proxy" : "No proxy required", Icon: Cable }, { key: "salta7", label: "Salta7", detail: "No proxy required", Icon: Globe2 }, { key: "solarix", label: "SolarixAIO", detail: "Solarix stock", Icon: Gem }] as const).map(({ key, label, detail, Icon }) => <button
        key={key} type="button" className={`${value === key ? "is-selected " : ""}disabled:pointer-events-none disabled:opacity-45`}
        aria-pressed={value === key} disabled={disabled} onClick={() => onChange(key)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="community-speed-option-copy"><strong>{label}</strong><small>{detail}</small></span>
        <Check className={`h-3.5 w-3.5${value === key ? "" : " invisible"}`} aria-hidden="true" />
      </button>)}
    </div>
  </div>;
}
