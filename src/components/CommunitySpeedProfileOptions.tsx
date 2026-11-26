import type { ReactNode } from "react";
import { Rocket, ShieldCheck, Timer } from "lucide-react";
import { getCommunitySpeedPresetDelay, getCommunitySpeedRange, type CommunitySpeedProfile } from "../../shared/community-speed.mjs";

const profiles = [
  { key: "safe", label: "Safe", timing: "700s", description: "Lowest risk", Icon: ShieldCheck },
  { key: "balanced", label: "Balanced", timing: "30–300s", description: "12-step rhythm", Icon: Timer },
  { key: "balanced2", label: "Balanced 2", timing: "", description: "By delivery progress", Icon: Timer },
  { key: "fast", label: "Fast", timing: "60s", description: "Quick delivery", Icon: Rocket }
] as const;

export function CommunitySpeedProfileOptions({ value, added = 0, onChange, disabled = false, creation = false, className = "", children }: {
  value: string;
  added?: number;
  onChange: (value: CommunitySpeedProfile, delay: number) => void;
  disabled?: boolean;
  creation?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return <div className={`${creation ? "community-speed-profile-options" : "monitor-speed-profile-options"} community-member-speed-options${children ? " has-custom" : ""} ${className}`} role="group" aria-label="Delivery speed profile">
    {profiles.map(({ key, label, timing, description, Icon }) => <button key={key} type="button" className={value === key ? "is-selected" : ""} aria-pressed={value === key} disabled={disabled}
      onClick={() => onChange(key, getCommunitySpeedPresetDelay(key)!)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className={creation ? "community-speed-option-copy" : undefined}><strong>{label}</strong><small>{description}</small></span>
      <em>{key === "balanced2" ? getCommunitySpeedRange(key, added) : timing}</em>
    </button>)}
    {children}
  </div>;
}
