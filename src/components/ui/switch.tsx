import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import "./switch.css";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children" | "role" | "aria-checked"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(({ checked, onCheckedChange, disabled, className, onClick, type = "button", ...props }, ref) => (
  <button {...props} ref={ref} type={type} role="switch" aria-checked={checked} disabled={disabled} className={cn("ui-switch", className)}
    onClick={event => { onClick?.(event); if (!event.defaultPrevented && !disabled) onCheckedChange(!checked); }}>
    <span className="ui-switch-state" aria-hidden="true">{checked ? "On" : "Off"}</span>
    <span className="ui-switch-thumb" aria-hidden="true" />
  </button>
));
Switch.displayName = "Switch";
