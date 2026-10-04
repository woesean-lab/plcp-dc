import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type FilterDropdownOption = {
  value: string;
  label: string;
};

type FilterDropdownProps = {
  label: string;
  value: string;
  options: FilterDropdownOption[];
  onChange: (value: string) => void;
  showLabel?: boolean;
  className?: string;
  disabled?: boolean;
  placement?: "bottom" | "top";
};

export function FilterDropdown({
  label,
  value,
  options,
  onChange,
  showLabel = true,
  className = "",
  disabled = false,
  placement = "bottom"
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className={`filter-dropdown ${placement === "top" ? "is-top" : ""} ${className}`.trim()}>
      {showLabel ? <span className="field-label">{label}</span> : null}
      <button
        type="button"
        className={`filter-dropdown-trigger ${open ? "is-open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-dropdown-menu" role="listbox" tabIndex={-1}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`filter-dropdown-option ${option.value === value ? "is-selected" : ""}`}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
              {option.value === value ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
