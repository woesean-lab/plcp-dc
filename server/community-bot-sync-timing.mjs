export function estimateBotSyncRemaining(payload, status, now = Date.now()) {
  if (!["queued", "running"].includes(status)) return null;
  const samples = (payload.timingSamplesMs ?? []).filter(value => Number.isFinite(value) && value > 0);
  if (samples.length < 3) return null;
  const remaining = Math.max(0, Number(payload.total) - Number(payload.processed));
  if (!remaining) return 0;
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const sinceLast = Math.max(0, now - Date.parse(payload.lastProgressAt));
  return Math.max(1, Math.ceil((remaining * average - Math.min(Number.isFinite(sinceLast) ? sinceLast : 0, average)) / 1000));
}

export function recordBotSyncTiming(payload, startedAt, completedAt = Date.now()) {
  const last = Date.parse(payload.lastProgressAt);
  const duration = Math.max(2_000, completedAt - (Number.isFinite(last) ? last : startedAt));
  payload.timingSamplesMs = [...(payload.timingSamplesMs ?? []), duration].slice(-20);
  payload.lastProgressAt = new Date(completedAt).toISOString();
}
