import { useState, type ReactNode } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import "./MemberActivityAvatar.css";

function activityState(value?: string) {
  const state = value?.toLowerCase();
  if (["joining", "replacing", "running", "processing"].includes(state ?? "")) return "processing";
  if (["joined", "success", "completed"].includes(state ?? "")) return "success";
  if (["failed", "blocked", "partial"].includes(state ?? "")) return "failed";
  return "idle";
}

export function MemberActivityAvatar({ src, state, className, fallback }: {
  src?: string | null;
  state?: string;
  className: string;
  fallback: ReactNode;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const activity = activityState(state);
  const label = activity === "processing" ? "Processing"
    : activity === "success" ? "Completed"
    : activity === "failed" ? state === "partial" ? "Partially completed" : "Failed" : undefined;
  return <span className={className + " member-activity-avatar"} data-activity={activity} title={label} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <span className="member-activity-avatar-content">
      {src && src !== failedSource ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSource(src)} /> : fallback}
    </span>
    {activity !== "idle" ? <span className="member-activity-avatar-indicator" aria-hidden="true">
      {activity === "processing" ? <LoaderCircle /> : activity === "success" ? <Check /> : <CircleAlert />}
    </span> : null}
  </span>;
}
