import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { KeyRound, Users } from "lucide-react";
import "./SettingsWorkspace.css";
import "./StockWorkspace.css";

const sections = [
  { id: "boosts", label: "Boost Stock", description: "Manage boost inventory", Icon: KeyRound },
  { id: "offline", label: "Members Stock", description: "Manage connected members", Icon: Users }
] as const;

export function StockWorkspace({ category, onCategoryChange, heading, children }: {
  category: "boosts" | "offline";
  onCategoryChange: (category: "boosts" | "offline") => void;
  heading: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width <= 820));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(event.key) ? 1 - index
      : event.key === "Home" ? 0 : event.key === "End" ? 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onCategoryChange(sections[next].id);
    tabs.current[next]?.focus();
  }
  return <section ref={root} className="settings-workspace stock-workspace">
    {heading}
    <div className="settings-layout">
      <aside className="settings-navigation">
        <span className="app-kicker settings-navigation-label">Stock type</span>
        <div className="stock-category-tabs settings-section-tabs" role="tablist" aria-label="Stock type" aria-orientation={compact ? "horizontal" : "vertical"}>
          {sections.map(({ id: key, label, description, Icon }, index) => <button key={key} ref={node => { tabs.current[index] = node; }} id={`${id}-${key}-tab`} type="button" role="tab" aria-selected={category === key} aria-controls={`${id}-panel`} tabIndex={category === key ? 0 : -1} className={category === key ? "is-active" : undefined} onClick={() => onCategoryChange(key)} onKeyDown={event => navigate(event, index)}>
            <Icon className="h-4 w-4" aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span>
          </button>)}
        </div>
      </aside>
      <div className="settings-content stock-workspace-content" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${category}-tab`} tabIndex={0}>{children}</div>
    </div>
  </section>;
}
