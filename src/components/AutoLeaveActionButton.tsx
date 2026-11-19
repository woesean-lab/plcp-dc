import { Check, LoaderCircle, LogOut, TriangleAlert } from "lucide-react";
import { Button } from "./ui/button";

export type AutoLeaveActionState = "not-started" | "starting" | "running" | "completed" | "failed";

const LABELS: Record<AutoLeaveActionState, string> = {
  "not-started": "Not started",
  starting: "Starting…",
  running: "In progress",
  completed: "Finished",
  failed: "Finished with errors"
};

export function AutoLeaveActionButton({ state, details, disabled = false, onStart }: {
  state: AutoLeaveActionState;
  details?: string;
  disabled?: boolean;
  onStart?: () => void;
}) {
  const label = `Auto leave: ${LABELS[state]}${details ? ` · ${details}` : ""}`;
  return <span className="inline-flex" title={label}>
    <Button type="button" size="icon-sm" variant={state === "not-started" || state === "starting" ? "destructive" : "secondary"}
      aria-label={label} data-auto-leave-state={state} disabled={disabled || state !== "not-started"} onClick={onStart}>
      {state === "starting" || state === "running" ? <LoaderCircle className={`h-3.5 w-3.5 animate-spin${state === "running" ? " text-[var(--app-accent-bright)]" : ""}`} aria-hidden="true" />
        : state === "completed" ? <Check className="h-3.5 w-3.5 text-[var(--app-success)]" aria-hidden="true" />
        : state === "failed" ? <TriangleAlert className="h-3.5 w-3.5 text-[var(--app-danger)]" aria-hidden="true" />
        : <LogOut className="h-3.5 w-3.5" aria-hidden="true" />}
    </Button>
  </span>;
}
