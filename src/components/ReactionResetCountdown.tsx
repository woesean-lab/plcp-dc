import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import { getReactionResetCountdown } from "../lib/reaction-reset";

export function ReactionResetCountdown({ resetsAt }: { resetsAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const countdown = getReactionResetCountdown(resetsAt);
  if (!countdown) return null;
  return <span className="reaction-reset-countdown" role="timer" aria-live="off"
    aria-label={countdown.seconds ? `Daily reactions reset in ${countdown.label}, at ${countdown.resetTime}` : "Refreshing daily reaction allowance"}
    title={`Daily allowance resets at ${countdown.resetTime}`}>
    <span className="reaction-reset-label"><Timer aria-hidden="true" />{countdown.seconds ? "Resets in" : "Daily allowance"}</span>
    <strong className="reaction-reset-value">{countdown.seconds ? <time dateTime={`PT${countdown.seconds}S`}>{countdown.label}</time> : "Resetting…"}</strong>
    <span className="reaction-reset-time">Resets at {countdown.resetTime}</span>
  </span>;
}
