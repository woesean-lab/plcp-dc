import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { getActiveStockHumanizerJob, getLatestStockHumanizerJob, isHumanizerJobActive, pruneHumanizerJobs, stopHumanizerJob } from "./humanizer-job-control.mjs";

// Execute the production worker and routes with deferred requests, without Discord or a database.
const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(ts.isFunctionDeclaration);
const functionCode = (name) => functions.find((node) => node.name?.text === name).getText(ast);
const snapshotCode = functionCode("getHumanizerJobSnapshot");
function makeJob(count = 4, status = "queued") {
  return { id: "stock-run", source: "members-stock", status, createdAt: "2026-11-22T00:00:00Z", startedAt: null, completedAt: null,
    total: count, completed: 0, succeeded: 0, failed: 0, results: Array.from({ length: count }, (_, index) => ({ id: String(100000000000000000n + BigInt(index)), username: `member-${index}`, state: "pending", changed: [], error: null, startedAt: null, completedAt: null })) };
}
function worker(overrides = {}) {
  const scope = { crypto, pool: { query: async () => ({ rows: [] }) }, sendHumanizerAccountUpdate: async () => ({ result: { response: { ok: true }, payload: {} }, gatewayFallback: false }),
    sendHumanizerDiscordRequest: async () => ({ response: { ok: true } }), getHumanizerDiscordError: () => "Account unavailable", ...overrides };
  vm.runInNewContext(`${snapshotCode}\n${functionCode("forEachWithConcurrency")}\n${functionCode("runHumanizerJob")}\nthis.run = runHumanizerJob;`, scope);
  return scope.run;
}
const recipe = { usernames: [], displayNames: ["New display name"], bios: [], pronouns: [], avatarIds: [], concurrency: 2 };

test("stop finishes in-flight accounts, never starts queued accounts and preserves truthful counts", async () => {
  const job = makeJob();
  const releases = [];
  let calls = 0;
  const run = worker({ sendHumanizerAccountUpdate: () => { calls += 1; return new Promise((resolve) => releases.push(() => resolve({ result: { response: { ok: true }, payload: {} }, gatewayFallback: false }))); } });
  const task = run(job, job.results, recipe);
  assert.equal(calls, 2);
  stopHumanizerJob(job);
  assert.equal(job.status, "stopping");
  assert.equal(job.results.filter((row) => row.state === "cancelled").length, 2);
  assert.equal(isHumanizerJobActive(job), true);
  releases.forEach((release) => release());
  await task;
  assert.equal(calls, 2);
  assert.equal(job.status, "stopped");
  assert.equal(job.completed, 2);
  assert.equal(job.succeeded, 2);
  assert.equal(job.failed, 0);
  assert.ok(job.results.slice(0, 2).every((row) => row.changed.includes("Display name")));
  const finished = JSON.stringify(job);
  stopHumanizerJob(job);
  assert.equal(JSON.stringify(job), finished, "repeated stop is idempotent");
});

test("stopping before a queued worker starts performs no updates", async () => {
  const job = makeJob();
  stopHumanizerJob(job);
  await worker({ sendHumanizerAccountUpdate: () => assert.fail("no update may start") })(job, job.results, recipe);
  assert.equal(job.status, "stopped");
  assert.equal(job.completed, 0);
  assert.ok(job.results.every((result) => result.state === "cancelled" && result.startedAt === null));
});

test("completed work remains partial if a later step throws, and duplicate errors are collapsed", async () => {
  const job = makeJob(1);
  await worker({ pool: { query: async () => { throw new Error("Local cache could not be updated"); } } })(job, job.results, recipe);
  assert.equal(job.results[0].state, "partial");
  assert.ok(job.results[0].changed.includes("Display name"));
  assert.equal(job.failed, 1);
  const failed = makeJob(1);
  await worker({ sendHumanizerAccountUpdate: async () => ({ result: { response: { ok: false } } }), sendHumanizerDiscordRequest: async () => ({ response: { ok: false } }) })(failed, failed.results, { ...recipe, bios: ["Bio"] });
  assert.equal(failed.results[0].error, "Account unavailable");
});

test("active stock runs take priority over newer boost runs and survive history pruning", () => {
  const active = makeJob(1, "stopping");
  const boost = { ...makeJob(1, "running"), id: "boost", source: "boost-order", createdAt: "2026-11-23T00:00:00Z" };
  const jobs = new Map([[active.id, active], [boost.id, boost]]);
  for (let index = 0; index < 25; index++) jobs.set(`old-${index}`, { ...makeJob(1, "completed"), id: `old-${index}`, createdAt: `2026-11-22T01:00:${String(index).padStart(2, "0")}Z` });
  assert.equal(getLatestStockHumanizerJob(jobs), active);
  assert.equal(getActiveStockHumanizerJob(jobs), active);
  pruneHumanizerJobs(jobs);
  assert.equal(jobs.size, 22);
  assert.equal(jobs.get(active.id), active);
  assert.equal(jobs.get(boost.id), boost);
});

function route(path, scope = {}) {
  let captured;
  const requireSession = () => {};
  const node = ast.statements.find((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
    && statement.expression.expression.getText(ast) === "app.post" && statement.expression.arguments[0]?.text === path);
  const context = { ...scope, requireSession, app: { post(_path, auth, handler) { assert.equal(auth, requireSession); captured = handler; } } };
  vm.runInNewContext(`${snapshotCode}\n${node.getText(ast)}`, context);
  return captured;
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(payload) { this.body = payload; return this; } }; }

test("authenticated stop API handles missing, finished and boost-order runs safely", () => {
  const job = makeJob(1);
  const jobs = new Map([[job.id, job]]);
  const stop = route("/api/humanizer/jobs/:jobId/stop", { humanizerJobs: jobs, stopHumanizerJob });
  const res = response();
  stop({ params: { jobId: job.id } }, res);
  assert.equal(res.body.status, "stopped");
  assert.equal(res.body.cancelled, 1);
  assert.equal(res.body.canStop, true);
  job.status = "completed";
  stop({ params: { jobId: job.id } }, res);
  assert.equal(res.body.status, "completed", "an already finished run is not rewritten as stopped");
  stop({ params: { jobId: "missing" } }, res);
  assert.equal(res.statusCode, 404);
  job.source = "boost-order";
  stop({ params: { jobId: job.id } }, res);
  assert.equal(res.statusCode, 409);
});

test("concurrent starts recheck after validation and create exactly one job; oversized selections are rejected", async () => {
  const jobs = new Map();
  const start = route("/api/humanizer/jobs", { humanizerJobs: jobs, getActiveStockHumanizerJob, pruneHumanizerJobs,
    crypto, isDiscordGuildId: (id) => /^\d{17,20}$/.test(id), normalizeHumanizerEnabledFields: (values) => values, cleanHumanizerLines: (values) => values ?? [],
    getCommunityOAuthConfig: async () => ({ configured: true, guildId: "guild" }),
    pool: { query: async () => ({ rows: [{ discord_user_id: "100000000000000000", username: "Member", encrypted_account_token: "saved" }] }) },
    getDiscordOnlinerConfig: async () => ({ accounts: [{ discordUserId: "100000000000000000", proxyUrl: "assigned-proxy" }] }),
    decryptCredential: () => "saved-token", normalizeDiscordOnlinerProxyUrl: (value) => value, runHumanizerJob: async () => {} });
  const body = { accountIds: ["100000000000000000"], enabledFields: ["displayName"], displayNames: ["Name"] };
  const first = response(); const second = response();
  await Promise.all([start({ body }, first, (error) => { throw error; }), start({ body }, second, (error) => { throw error; })]);
  assert.equal(jobs.size, 1);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [202, 409]);
  jobs.clear();
  const oversized = response();
  await start({ body: { ...body, accountIds: Array.from({ length: 501 }, (_, index) => String(100000000000000000n + BigInt(index))) } }, oversized, (error) => { throw error; });
  assert.equal(oversized.statusCode, 400);
  assert.equal(jobs.size, 0);
});
