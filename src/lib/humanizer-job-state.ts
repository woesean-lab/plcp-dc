import type { HumanizerJob } from "./humanizer";

export function isHumanizerJobActive(job: HumanizerJob | null) {
  return Boolean(job && ["queued", "running", "stopping"].includes(job.status));
}

// An older poll must not undo a stop, finished run or already reported work.
export function mergeHumanizerJob(current: HumanizerJob | null, incoming: HumanizerJob) {
  if (!current || current.id !== incoming.id) return incoming;
  if (!isHumanizerJobActive(current) && isHumanizerJobActive(incoming)) return current;
  if (current.stopRequestedAt && !incoming.stopRequestedAt) return current;
  if (incoming.completed < current.completed) return current;
  return incoming;
}
