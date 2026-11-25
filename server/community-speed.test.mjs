import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { COMMUNITY_BALANCED_DELAY_PATTERN, normalizeCommunitySpeedProfile, getCommunitySpeedPattern, getCommunitySpeedRange, getCommunitySpeedPresetDelay, getCommunitySpeedDelay, getCommunitySpeedAverage, getCommunitySpeedDescription } from "../shared/community-speed.mjs";
import { buildEldoradoDeliveryMessage } from "./eldorado-integration.mjs";

test("Balanced 2 brackets include 250 and 400 and use the whole purchased total", () => {
  for (const [amount, min, max] of [[1, 1, 6], [249, 1, 6], [250, 1, 6], [251, 30, 60], [399, 30, 60], [400, 30, 60], [401, 30, 300], [500, 30, 300], [1000, 30, 300]]) {
    const pattern = getCommunitySpeedPattern("balanced2", amount);
    assert.equal(Math.min(...pattern), min); assert.equal(Math.max(...pattern), max);
    assert.equal(getCommunitySpeedRange("balanced2", amount), `${min}–${max}s`);
    for (let index = 0; index < amount * 2; index++) {
      const delay = getCommunitySpeedDelay("balanced2", 300, index, amount);
      assert.ok(delay >= min && delay <= max, `${amount} members, step ${index}: ${delay}`);
    }
    assert.equal(getCommunitySpeedAverage("balanced2", 300, amount), pattern.reduce((sum, delay) => sum + delay, 0) / pattern.length);
  }
});

test("existing speeds retain their cadence, custom zero cancels waiting, and missing totals use the slow bracket", () => {
  assert.equal(normalizeCommunitySpeedProfile(" Balanced2 "), "balanced2");
  assert.equal(normalizeCommunitySpeedProfile("other"), "custom");
  assert.deepEqual(COMMUNITY_BALANCED_DELAY_PATTERN, [30, 180, 75, 300, 120, 45, 240, 90, 150, 60, 210, 100]);
  for (const amount of [250, 251, 400, 401]) assert.equal(getCommunitySpeedPattern("balanced", amount), COMMUNITY_BALANCED_DELAY_PATTERN);
  for (const profile of ["custom", "safe", "fast"]) assert.equal(getCommunitySpeedDelay(profile, 77, 99, 500), 77);
  for (const profile of ["balanced", "balanced2"]) {
    assert.equal(getCommunitySpeedDelay(profile, 0, 5, 250), 0);
    assert.equal(getCommunitySpeedAverage(profile, 0, 250), 0);
  }
  for (const amount of [undefined, null, "invalid", 0]) assert.equal(getCommunitySpeedPattern("balanced2", amount), COMMUNITY_BALANCED_DELAY_PATTERN);
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
  const scope = { order, Date: Clock, getCommunitySpeedDelay, normalizeCommunitySpeedProfile,
    setTimeout(callback, milliseconds) { now += milliseconds; callback(); }, detectMissingCommunityBot: async () => null,
    pool: { query: async (sql, params) => {
      if (sql.startsWith("SELECT")) {
        controlReads++;
        return { rowCount: 1, rows: [{ status: cancelled ? "PAUSED" : "PROCESS", delay: changeProfile && controlReads > 1 ? "60" : "300", speed_profile: changeProfile && controlReads > 1 ? "fast" : "balanced2", amount: String(amount) }] };
      }
      if (params.length === 3) writes.push({ delay: params[1], nextMemberAt: params[2] });
      return { rowCount: 1, rows: [] };
    } }
  };
  vm.runInNewContext(`${waitFunction}; this.run = waitForNextCommunityMember;`, scope);
  const result = await scope.run(index, 0, existingNextMemberAt);
  return { result, writes, elapsed: now, order };
}

test("actual worker delays depend on total amount even at the beginning, after delivery and in small replacement batches", async () => {
  for (const [amount, expected] of [[250, 4], [251, 48], [400, 48], [401, 180], [500, 180]]) {
    for (const added of [0, amount - 1]) {
      const run = await waitInProductionWorker({ amount, added });
      assert.equal(run.result, true); assert.equal(run.writes[0].delay, expected);
      assert.equal(run.elapsed, expected * 1000); assert.equal(run.order.nextMemberAt, null);
    }
  }
});

test("resuming retains the current deadline, and pause/profile changes remain effective during waiting", async () => {
  const resume = await waitInProductionWorker({ amount: 500, existingNextMemberAt: new Date(90_000).toISOString() });
  assert.equal(resume.elapsed, 90_000); assert.equal(resume.writes[0].delay, 180);
  const paused = await waitInProductionWorker({ amount: 500, cancelled: true });
  assert.equal(paused.result, false); assert.equal(paused.writes.length, 0);
  const changed = await waitInProductionWorker({ amount: 500, changeProfile: true });
  assert.equal(changed.writes[0].delay, 180); assert.equal(changed.writes.at(-1).delay, 60);
  assert.equal(changed.elapsed, 60_000, "switching to Fast changes the current wait");
});

test("admin and Monitor delay endpoints retain Balanced 2 and return a valid worker configuration", async () => {
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

test("integration delivery text names Balanced 2 and its order-size range", () => {
  for (const [amount, range] of [[250, "1–6"], [400, "30–60"], [401, "30–300"]]) {
    assert.equal(getCommunitySpeedDescription("balanced2", 300, amount), `Balanced 2 (variable ${range} second delay)`);
    const message = buildEldoradoDeliveryMessage({ uniqid: "test", provider: "community", speedProfile: "balanced2", amount, delay: 300 }, "https://example.test");
    assert.ok(message.includes(`Balanced 2 (variable ${range} second delay)`));
  }
});
