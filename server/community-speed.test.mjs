import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { COMMUNITY_BALANCED_DELAY_PATTERN, normalizeCommunitySpeedProfile, getCommunitySpeedPattern, getCommunitySpeedRange, getCommunitySpeedPresetDelay, getCommunitySpeedDelay, getCommunitySpeedAverage, getCommunityDeliveryEstimateSeconds, getCommunitySpeedDescription } from "../shared/community-speed.mjs";
import { buildEldoradoDeliveryMessage } from "./eldorado-integration.mjs";

test("Balanced Fast advances after delivering member 250 and member 400", () => {
  for (const [amount, min, max] of [[0, 1, 6], [25, 1, 6], [249, 1, 6], [250, 30, 60], [251, 30, 60], [399, 30, 60], [400, 30, 300], [401, 30, 300], [750, 30, 300]]) {
    const pattern = getCommunitySpeedPattern("balanced2", amount);
    assert.equal(Math.min(...pattern), min); assert.equal(Math.max(...pattern), max);
    assert.equal(getCommunitySpeedRange("balanced2", amount), `${min}–${max}s`);
    for (let index = 0; index < 800; index++) {
      const delay = getCommunitySpeedDelay("balanced2", 300, index, amount);
      assert.ok(delay >= min && delay <= max, `${amount} members, step ${index}: ${delay}`);
    }
    assert.equal(getCommunitySpeedAverage("balanced2", 300, amount), pattern.reduce((sum, delay) => sum + delay, 0) / pattern.length);
  }
});

test("existing speeds retain their cadence, custom zero cancels waiting, and new orders start in the first stage", () => {
  assert.equal(normalizeCommunitySpeedProfile(" Balanced2 "), "balanced2");
  assert.equal(normalizeCommunitySpeedProfile("other"), "custom");
  assert.deepEqual(COMMUNITY_BALANCED_DELAY_PATTERN, [30, 180, 75, 300, 120, 45, 240, 90, 150, 60, 210, 100]);
  for (const amount of [250, 251, 400, 401]) assert.equal(getCommunitySpeedPattern("balanced", amount), COMMUNITY_BALANCED_DELAY_PATTERN);
  for (const profile of ["custom", "safe", "fast"]) assert.equal(getCommunitySpeedDelay(profile, 77, 99, 500), 77);
  for (const profile of ["balanced", "balanced2"]) {
    assert.equal(getCommunitySpeedDelay(profile, 0, 5, 250), 0);
    assert.equal(getCommunitySpeedAverage(profile, 0, 250), 0);
  }
  for (const amount of [undefined, null, "invalid", 0]) assert.equal(getCommunitySpeedRange("balanced2", amount), "1–6s");
});

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const worker = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "runCommunityOrder");
const waitFunction = worker.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "waitForNextCommunityMember").getText(ast);

async function waitInProductionWorker({ amount, index = 1, added = 0, existingNextMemberAt, cancelled = false, changeProfile = false }) {
  let now = 0, controlReads = 0;
  const writes = [];
  const order = { uniqid: "speed-test", amount, added, delay: 300, speedProfile: "balanced2", activeDelay: existingNextMemberAt ? 180 : null };
  class Clock extends Date { static now() { return now; } }
  const scope = { order, added, Date: Clock, getCommunitySpeedDelay, normalizeCommunitySpeedProfile,
    setTimeout(callback, milliseconds) { now += milliseconds; callback(); }, detectMissingCommunityBot: async () => null,
    pool: { query: async (sql, params) => {
      if (sql.startsWith("SELECT")) {
        controlReads++;
        return { rowCount: 1, rows: [{ status: cancelled ? "PAUSED" : "PROCESS", delay: changeProfile && controlReads > 1 ? "60" : "300", speed_profile: changeProfile && controlReads > 1 ? "fast" : "balanced2", added: String(added) }] };
      }
      if (params.length === 3) writes.push({ delay: params[1], nextMemberAt: params[2] });
      return { rowCount: 1, rows: [] };
    } }
  };
  vm.runInNewContext(`${waitFunction}; this.run = waitForNextCommunityMember;`, scope);
  const result = await scope.run(index, 0, existingNextMemberAt);
  return { result, writes, elapsed: now, order };
}

test("750-member orders start fast and advance through delivery stages, including resumed/replacement progress", async () => {
  for (const amount of [750, 1000]) {
    for (const [added, expected] of [[0, 4], [25, 4], [249, 4], [250, 48], [399, 48], [400, 180], [749, 180]]) {
      const run = await waitInProductionWorker({ amount, added });
      assert.equal(run.result, true); assert.equal(run.writes[0].delay, expected, `total ${amount}, delivered ${added}`);
      assert.equal(run.elapsed, expected * 1000); assert.equal(run.order.nextMemberAt, null);
    }
  }
});

test("resuming retains the current deadline, and pause/profile changes remain effective during waiting", async () => {
  const resume = await waitInProductionWorker({ amount: 500, added: 400, existingNextMemberAt: new Date(90_000).toISOString() });
  assert.equal(resume.elapsed, 90_000); assert.equal(resume.writes[0].delay, 180);
  const paused = await waitInProductionWorker({ amount: 500, cancelled: true });
  assert.equal(paused.result, false); assert.equal(paused.writes.length, 0);
  const changed = await waitInProductionWorker({ amount: 500, added: 400, changeProfile: true });
  assert.equal(changed.writes[0].delay, 180); assert.equal(changed.writes.at(-1).delay, 60);
  assert.equal(changed.elapsed, 60_000, "switching to Fast changes the current wait");
});

test("admin and Monitor delay endpoints retain Balanced Fast and return a valid worker configuration", async () => {
  const paths = ["/api/community/orders/:uniqid/delay", "/api/public/orders/:uniqid/delay"];
  for (const path of paths) {
    let handler, updated;
    const node = ast.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "app.post" && node.expression.arguments[0]?.text === path);
    assert.ok(node, path);
    const scope = { normalizeCommunitySpeedProfile, getCommunitySpeedPresetDelay, requireSession() {},
      publicDelayCooldowns: new Map(), publicDelayCooldownMs: 1000,
      app: { post: (_path, ...handlers) => { handler = handlers.at(-1); } },
      pool: { query: async (sql, values) => {
        if (sql.startsWith("SELECT")) return { rows: [{ payload: { provider: "community", amount: 250 } }], rowCount: 1 };
        updated = values;
        return { rows: [{ payload: { uniqid: values[0], delay: values[1], speedProfile: values[2] } }], rowCount: 1 };
      } }
    };
    vm.runInNewContext(node.getText(ast), scope);
    const response = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ params: { uniqid: "test" }, ip: "test", body: { speedProfile: "balanced2", delay: 300 } }, response, error => { throw error; });
    assert.deepEqual(Array.from(updated), ["test", 300, "balanced2"]);
    assert.equal(response.body.speedProfile, "balanced2");
  }
});

test("delivery messages describe all stages instead of choosing a bracket from order size", () => {
  const description = "Balanced Fast (members 1–250: 1–6s; 251–400: 30–60s; 401+: 30–300s)";
  assert.equal(getCommunitySpeedDescription("balanced2", 300), description);
  for (const amount of [250, 400, 750]) {
    const message = buildEldoradoDeliveryMessage({ uniqid: "test", provider: "community", speedProfile: "balanced2", amount, added: 25, delay: 300 }, "https://example.test");
    assert.ok(message.includes(description));
  }
});

test("ETA includes later stages rather than applying the current fast delay to the entire remainder", () => {
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
  close(getCommunityDeliveryEstimateSeconds("balanced2", 300, 750, 25), 225 * 3.5 + 150 * (529 / 12) + 350 * (1600 / 12));
  close(getCommunityDeliveryEstimateSeconds("balanced2", 300, 250, 25), 225 * 3.5);
  close(getCommunityDeliveryEstimateSeconds("balanced2", 300, 400, 250), 150 * (529 / 12));
  close(getCommunityDeliveryEstimateSeconds("balanced2", 300, 750, 400), 350 * (1600 / 12));
  assert.equal(getCommunityDeliveryEstimateSeconds("balanced2", 300, 750, 750), 0);
  assert.equal(getCommunityDeliveryEstimateSeconds("balanced2", 0, 750, 25), 0);
  assert.equal(getCommunityDeliveryEstimateSeconds("custom", 60, 750, 25), 725 * 60);
});
