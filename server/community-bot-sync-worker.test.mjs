import test from "node:test";
import assert from "node:assert/strict";
import { startBotSyncWorker } from "./community-bot-sync.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(tick) {
  let clock = 0;
  const timers = new Map(), errors = [];
  const stop = startBotSyncWorker({ tick, onError: error => errors.push(error), now: () => clock,
    setTimer(callback, delay) { const timer = { unref() {} }; timers.set(timer, { callback, delay }); return timer; },
    clearTimer: timer => timers.delete(timer) });
  return { timers, errors, stop, elapse: ms => { clock += ms; },
    async fire() {
      assert.equal(timers.size, 1);
      const [id, { callback, delay }] = timers.entries().next().value;
      timers.delete(id); clock += delay; callback(); await flush();
    }, delay: () => timers.values().next().value?.delay };
}

test("slow account work proceeds immediately after completion without overlapping ticks", async () => {
  let finish, calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  assert.equal(f.delay(), 2000);
  await f.fire();
  f.elapse(7500);
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
  finish(); await flush();
  assert.equal(f.delay(), 0);
  await f.fire();
  assert.equal(calls, 2);
  assert.equal(f.timers.size, 0);
  f.stop(); finish(); await flush();
  assert.equal(f.timers.size, 0);
});

test("fast account work retains the existing two-second minimum start cadence", async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  await f.fire(); f.elapse(300); finish(); await flush();
  assert.equal(f.delay(), 1700);
  f.stop();
  assert.equal(f.timers.size, 0);
});

test("an error is reported once and short failures retain the idle delay", async () => {
  const failure = Error("Database unavailable");
  const f = fixture(async () => { throw failure; });
  await f.fire();
  assert.deepEqual(f.errors, [failure]);
  assert.equal(f.delay(), 2000);
  f.stop();
});
