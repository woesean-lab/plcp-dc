export function getPopoverPlacement(trigger: { top: number; bottom: number }, contentHeight: number, viewportHeight: number) {
  const margin = 12;
  const gap = 7;
  const above = Math.max(0, Math.min(trigger.top, viewportHeight - margin) - margin - gap);
  const below = Math.max(0, viewportHeight - Math.max(trigger.bottom, margin) - margin - gap);
  const placement = below >= contentHeight || below >= above ? "bottom" : "top";
  return { placement, maxHeight: Math.floor(placement === "top" ? above : below) } as const;
}
