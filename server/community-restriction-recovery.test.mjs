import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { captureCommunityInviteRestriction } from "../shared/community-invite-restriction.mjs";

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionCode = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
const userId = "123456789012345678";
const legacy = (overrides = {}) => ({
  uniqid: "order", provider: "community", serverId: "234567890123456789", status: "PARTIAL", amount: 750, added: 125,
  communityResults: [{ discordUserId: userId, state: "failed", details: "Discord code 400002: access to inviting new users through invite links has been limited for this guild" }],
  ...overrides
});

function fixture(current, failOrderUpdate = false) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (failOrderUpdate && sql.startsWith("UPDATE tracked_orders")) throw new Error("Database write failed");
    if (sql.includes("SELECT payload")) return { rows: current ? [{ payload: structuredClone(current) }] : [] };
    return { rows: [], rowCount: 1 };
  };
  const scope = {
    captureCommunityInviteRestriction,
    pool: { query, connect: async () => ({ query, release: () => calls.push({ sql: "RELEASE" }) }) },
    isDiscordGuildId: value => /^\d{17,20}$/.test(String(value)),
    saveTrackedOrderPayload: async order => { calls.push({ sql: "UNGUARDED_SAVE", params: [order] }); },
    Date
  };
  vm.runInNewContext(`${functionCode("isDiscordGuildInviteLimited")}\n${functionCode("recoverCommunityGuildRestrictionOrder")}\nthis.recover = recoverCommunityGuildRestrictionOrder;`, scope);
  return { calls, recover: scope.recover };
}

test("status polling never pauses active, manually paused or terminal orders from historical member errors", async () => {
  for (const status of ["NEW", "PROCESS", "RECOVERING", "WAITING", "PAUSED", "INVITES PAUSED", "COMPLETED", "CANCELLED", "CANCELED", "TERMINATED"]) {
    const order = legacy({ status });
    const api = fixture(order);
    assert.equal(await api.recover(order), order, status);
    assert.equal(api.calls.length, 0, `${status} must not mutate stock or order state`);
  }
});

test("a generic HTTP 400 with valid OAuth cannot establish a guild restriction", async () => {
  const order = legacy({ communityResults: [{ discordUserId: userId, state: "failed", details: "Discord Add Guild Member failed (HTTP 400): 400: Bad Request. OAuth check passed: user, application and guilds.join match." }] });
  const api = fixture(order);
  assert.equal(await api.recover(order), order);
  assert.equal(api.calls.length, 0);
});

test("legacy recovery locks and rechecks current state so a concurrent restart is preserved", async () => {
  const current = legacy({ status: "PROCESS", details: "Delivery resumed." });
  const api = fixture(current);
  const result = await api.recover(legacy());
  assert.equal(result.status, "PROCESS");
  assert.equal(result.details, "Delivery resumed.");
  assert.ok(api.calls.some(call => /SELECT payload.*FOR UPDATE/.test(call.sql)));
  assert.ok(!api.calls.some(call => /^UPDATE |UNGUARDED_SAVE/.test(call.sql)));
  assert.equal(api.calls.at(-1).sql, "RELEASE");
});

test("confirmed legacy restriction is recovered atomically without disabling accounts or losing delivered members", async () => {
  const delivered = { discordUserId: "345678901234567890", state: "joined", details: "Member joined the server." };
  const order = legacy();
  order.communityResults.unshift(delivered);
  const api = fixture(order);
  const result = await api.recover(order);
  assert.equal(result.status, "INVITES PAUSED");
  assert.equal(result.waitingCode, "discord_guild_invites_limited");
  assert.equal(result.added, 125);
  assert.equal(JSON.stringify(result.communityResults[0]), JSON.stringify(delivered));
  assert.equal(result.communityResults[1].state, "queued");
  assert.equal(result.communityResults[1].authorizationStatus, "active");
  const stockUpdate = api.calls.find(call => /UPDATE community_oauth_joins/.test(call.sql));
  assert.ok(stockUpdate);
  assert.match(stockUpdate.sql, /reserved_order_id IS NULL OR reserved_order_id = \$3/);
  assert.equal(stockUpdate.params[2], order.uniqid);
  assert.ok(api.calls.some(call => /UPDATE tracked_orders/.test(call.sql)));
  assert.ok(!api.calls.some(call => call.sql === "UNGUARDED_SAVE"));
  assert.ok(api.calls.some(call => call.sql === "COMMIT"));
});

test("deleted and fully delivered orders cannot modify stock during legacy recovery", async () => {
  const missing = fixture(null);
  await missing.recover(legacy());
  assert.ok(!missing.calls.some(call => /^UPDATE |UNGUARDED_SAVE/.test(call.sql)));
  const complete = legacy({ added: 750 });
  const api = fixture(complete);
  assert.equal(await api.recover(complete), complete);
  assert.equal(api.calls.length, 0);
});

test("a failed order write rolls back stock recovery and releases the lock", async () => {
  const api = fixture(legacy(), true);
  await assert.rejects(api.recover(legacy()), /Database write failed/);
  assert.ok(api.calls.some(call => call.sql === "ROLLBACK"));
  assert.ok(!api.calls.some(call => call.sql === "COMMIT"));
  assert.equal(api.calls.at(-1).sql, "RELEASE");
});
