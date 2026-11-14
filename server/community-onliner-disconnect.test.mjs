import test from "node:test";
import assert from "node:assert/strict";
import { planCommunityOnlinerDisconnect } from "./community-onliner-disconnect.mjs";

test("disconnect resolves explicit and legacy runtime identities and keeps unrelated accounts", () => {
  const accounts = [
    { id: "a", discordUserId: "user1", botToken: "token1" },
    { id: "b", botToken: "token2" },
    { id: "c", discordUserId: "user3", botToken: "token3" }
  ];
  const plan = planCommunityOnlinerDisconnect(accounts, [{ account_id: "b", payload: { bot: { id: "user2" } } }], ["user1", "user2"]);
  assert.deepEqual(plan.removedIds, ["a", "b"]);
  assert.deepEqual(plan.removedUsers, ["user1", "user2"]);
  assert.deepEqual(plan.remainingAccounts, [accounts[2]]);
  assert.deepEqual([...plan.recoverableTokens], [["user1", "token1"], ["user2", "token2"]]);
  assert.equal(accounts.length, 3);
});

test("duplicate profiles are removed together but a member counts once", () => {
  const plan = planCommunityOnlinerDisconnect([
    { id: "a", discordUserId: "user1", botToken: "first" },
    { id: "b", discordUserId: "user1", botToken: "second" }
  ], [], ["user1", "user1"]);
  assert.deepEqual(plan.removedIds, ["a", "b"]);
  assert.deepEqual(plan.removedUsers, ["user1"]);
  assert.equal(plan.recoverableTokens.get("user1"), "first");
});

test("already disconnected selections do not change other accounts", () => {
  const account = { id: "a", discordUserId: "other", botToken: "other-token" };
  const plan = planCommunityOnlinerDisconnect([account], [], ["offline"]);
  assert.deepEqual(plan.removedIds, []);
  assert.deepEqual(plan.removedUsers, []);
  assert.deepEqual(plan.remainingAccounts, [account]);
  assert.equal(plan.recoverableTokens.size, 0);
});
