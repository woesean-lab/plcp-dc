import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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
  portal?: boolean;
};

export function FilterDropdown({
  label,
  value,
  options,
  onChange,
  showLabel = true,
  className = "",
  disabled = false,
  placement = "bottom",
  portal = false
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ position: "fixed", top: 0, left: 0, right: "auto", bottom: "auto", width: 88, visibility: "hidden" });
  const selected = options.find((option) => option.value === value) ?? options[0];
  const isOpen = open && !disabled;

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!isOpen || !portal || !triggerRef.current || !menuRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    menuRef.current.style.width = `${Math.max(trigger.width, 88)}px`;
    const menu = menuRef.current.getBoundingClientRect();
    const preferredTop = placement === "top" ? trigger.top - menu.height - 8 : trigger.bottom + 8;
    setMenuPosition({
      position: "fixed", zIndex: 1000, bottom: "auto", right: "auto",
      top: Math.max(8, Math.min(preferredTop, window.innerHeight - menu.height - 8)),
      left: Math.max(8, Math.min(trigger.left, window.innerWidth - menu.width - 8)),
      width: Math.max(trigger.width, 88)
    });
  }, [isOpen, portal, placement]);

  useEffect(() => {
    if (!isOpen || !portal) return;
    const close = () => setOpen(false);
    const closeOutside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [isOpen, portal]);

  const menu = isOpen ? (
    <div ref={menuRef} className={`filter-dropdown-menu${portal ? " filter-dropdown-portal" : ""}`} role="listbox" aria-label={label} tabIndex={-1} style={portal ? menuPosition : undefined}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } }}
      onBlur={(event) => {
        if (portal && !menuRef.current?.contains(event.relatedTarget as Node | null) && !triggerRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
      {options.map((option) => (
        <button key={option.value} type="button" className={`filter-dropdown-option ${option.value === value ? "is-selected" : ""}`} role="option" aria-selected={option.value === value}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { onChange(option.value); setOpen(false); }}>
          {option.label}
          {option.value === value ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={`filter-dropdown ${placement === "top" ? "is-top" : ""} ${className}`.trim()}>
      {showLabel ? <span className="field-label">{label}</span> : null}
      <button
        ref={triggerRef}
        type="button"
        className={`filter-dropdown-trigger ${isOpen ? "is-open" : ""}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null) && !menuRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && isOpen) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        }}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {portal && typeof document !== "undefined" ? createPortal(menu, document.body) : menu}
    </div>
  );
}
