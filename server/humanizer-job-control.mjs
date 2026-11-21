export function isHumanizerJobActive(job) {
  return Boolean(job && ["queued", "running", "stopping"].includes(job.status));
}

export function getActiveStockHumanizerJob(jobs) {
  return [...jobs.values()].find((job) => job.source !== "boost-order" && isHumanizerJobActive(job)) ?? null;
}

export function getLatestStockHumanizerJob(jobs) {
  return getActiveStockHumanizerJob(jobs) ?? [...jobs.values()]
    .filter((job) => job.source !== "boost-order")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export function stopHumanizerJob(job, now = new Date().toISOString()) {
  if (!isHumanizerJobActive(job)) return job;
  job.stopRequestedAt ??= now;
  job.status = "stopping";
  for (const result of job.results) {
    if (result.state !== "pending") continue;
    result.state = "cancelled";
    result.completedAt = now;
  }
  if (!job.results.some((result) => result.state === "running")) {
    job.status = "stopped";
    job.completedAt = now;
  }
  return job;
}

export function pruneHumanizerJobs(jobs, keep = 20) {
  const completed = [...jobs.values()].filter((job) => !isHumanizerJobActive(job))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const job of completed.slice(keep)) jobs.delete(job.id);
}
