import type { BotSyncJob } from "./community";

export const botSyncActive = (job: BotSyncJob | null) => Boolean(job && (["queued", "running", "paused"].includes(job.status) || job.stopping));
export const botSyncPolling = (job: BotSyncJob | null) => Boolean(job && (["queued", "running"].includes(job.status) || job.stopping));
export function botSyncStatus(job: BotSyncJob) {
  if (job.stopping) return "Stopping";
  return { queued: "Queued", running: "Syncing", paused: "Paused", cancelled: "Stopped", completed: job.failed ? "Completed with errors" : "Completed" }[job.status];
}
export function formatBotSyncEta(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "Calculating…";
  if (seconds < 60) return "Less than a minute";
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
export function mergeBotSyncJob(current: BotSyncJob | null, next: BotSyncJob | null) {
  if (!current || !next || current.id !== next.id) return next;
  if (next.processed < current.processed) return current;
  if (["completed", "cancelled"].includes(current.status) && ["queued", "running", "paused"].includes(next.status)) return current;
  return next;
}
export const BOT_SYNC_ERROR_TYPES = ["verification", "credentials", "connection", "rate_limit", "other"] as const;
export type BotSyncErrorType = typeof BOT_SYNC_ERROR_TYPES[number];
export function describeBotSyncError(message: string): { type: BotSyncErrorType; title: string; detail: string } {
  if (/verify your account|verification required|40002/i.test(message)) return { type: "verification", title: "Verification required", detail: "Discord requires account verification before this authorization can continue." };
  if (/code 4004|token.*(?:invalid|rejected)|rejected.*token|HTTP 401/i.test(message)) return { type: "credentials", title: "Authentication failed", detail: "Discord rejected the saved account credentials." };
  if (/timed? out|socket|proxy|gateway.*(?:closed|rejected)|ECONN/i.test(message)) return { type: "connection", title: "Connection failed", detail: "The account connection did not complete. Review the technical details before retrying." };
  if (/429|rate.?limit/i.test(message)) return { type: "rate_limit", title: "Rate limited", detail: "Discord requested a pause before more requests." };
  return { type: "other", title: "Authorization failed", detail: "This account could not be synced. Review the technical details." };
}
