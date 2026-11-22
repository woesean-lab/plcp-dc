import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("index.mjs", fs.readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const worker = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "processCommunityReactionJobsUnlocked");
assert.ok(worker);

function fixture(memberIds = ["missing"]) {
  const jobs = memberIds.map((discord_user_id) => ({ order_id: "order", request_id: "request", discord_user_id, emoji: "🔥", attempts: 0, status: "pending" }));
  const accounts = [];
  const results = [];
  const runtimes = new Map();
  const pool = { async query(sql, args = []) {
    if (sql.includes("SELECT order_id, request_id")) return { rows: jobs.filter((job) => ["pending", "processing"].includes(job.status)).map((job) => ({ ...job })), rowCount: jobs.filter((job) => ["pending", "processing"].includes(job.status)).length };
    if (sql.includes("FROM discord_onliner_runtime")) return { rows: [] };
    if (sql.includes("FROM discord_onliner_worker_state")) return { rows: [] };
    if (sql.includes("SELECT payload FROM tracked_orders")) return { rows: [{ payload: { reactionRequests: [{ id: "request" }] } }] };
    if (sql.includes("UPDATE community_reaction_jobs")) {
      const job = jobs.find((item) => item.discord_user_id === args[2]);
      if (sql.includes("RETURNING order_id")) { job.status = "processing"; return { rows: [{ order_id: "order" }], rowCount: 1 }; }
      job.status = sql.includes("status = 'completed'") ? "completed" : args[4];
      if (sql.includes("attempts = attempts + 1")) job.attempts++;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const run = vm.runInNewContext(`(${worker.getText(source)})`, {
    pool, discordOnlinerWorkerCurrentConfig: { accounts }, discordOnlinerRuntimes: runtimes,
    discordOnlinerWorkerHeartbeatMs: 1000, WebSocket: { OPEN: 1 },
    updateCommunityReactionResult: async (job, fields) => { results.push({ id: job.discord_user_id, ...fields }); },
    sendHumanizerDiscordRequest: async () => ({ response: { ok: true } }),
    appendDiscordOnlinerLog() {}
  });
  return { jobs, results, run, connect(memberId) {
    const id = `account-${memberId}`;
    accounts.push({ id, discordUserId: memberId });
    runtimes.set(id, { bot: { id: memberId }, state: "connected", socket: { readyState: 1 } });
  } };
}

test("an unmatched account exhausts six checks instead of remaining pending forever", async () => {
  const view = fixture();
  for (let attempt = 1; attempt <= 6; attempt++) {
    await view.run();
    assert.equal(view.jobs[0].attempts, attempt);
    assert.equal(view.jobs[0].status, attempt < 6 ? "pending" : "failed");
  }
  const last = view.results.at(-1);
  assert.equal(last.reactionState, "failed");
  assert.ok(last.reactionCompletedAt);
  assert.match(last.reactionDetails, /account is unavailable/);
  await view.run();
  assert.equal(view.results.length, 6, "terminal jobs are not retried");
});

test("a temporarily missing account can connect and complete on the next check", async () => {
  const view = fixture();
  await view.run();
  view.connect("missing");
  await view.run();
  assert.equal(view.jobs[0].status, "completed");
  assert.equal(view.results.at(-1).reactionState, "completed");
});

test("one unmatched member does not prevent a healthy member from reacting", async () => {
  const view = fixture(["missing", "healthy"]);
  view.connect("healthy");
  await view.run();
  assert.equal(view.jobs[0].status, "pending");
  assert.equal(view.jobs[1].status, "completed");
});
