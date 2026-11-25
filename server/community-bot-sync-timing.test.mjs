import test from "node:test";
import assert from "node:assert/strict";
import { estimateBotSyncRemaining, recordBotSyncTiming } from "./community-bot-sync-timing.mjs";

test("ETA waits for samples, uses recent actual durations and survives serialization", () => {
  const now = Date.now(), payload = { total: 103, processed: 3, timingSamplesMs: [4000, 6000, 8000], lastProgressAt: new Date(now).toISOString() };
  assert.equal(estimateBotSyncRemaining(payload, "running", now), 600);
  assert.equal(estimateBotSyncRemaining(JSON.parse(JSON.stringify(payload)), "queued", now + 3000), 597);
  assert.equal(estimateBotSyncRemaining({ ...payload, timingSamplesMs: [4000, 6000] }, "running", now), null);
  for (const status of ["paused", "cancelled", "completed"]) assert.equal(estimateBotSyncRemaining(payload, status, now), null);
});

test("timing retains 20 accounts, includes queue waits and preserves the minimum cadence", () => {
  const payload = { timingSamplesMs: Array(20).fill(2000), lastProgressAt: new Date(10_000).toISOString() };
  recordBotSyncTiming(payload, 13_000, 17_000);
  assert.equal(payload.timingSamplesMs.length, 20);
  assert.equal(payload.timingSamplesMs.at(-1), 7000);
  recordBotSyncTiming(payload, 17_000, 17_100);
  assert.equal(payload.timingSamplesMs.at(-1), 2000);
  assert.equal(estimateBotSyncRemaining({ total: 3, processed: 3, ...payload }, "running", 17_100), 0);
});
