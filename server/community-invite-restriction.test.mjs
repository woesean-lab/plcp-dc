import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { captureCommunityInviteRestriction, communityInviteRestrictionSummary } from "../shared/community-invite-restriction.mjs";

const now = Date.parse("2026-11-25T12:00:00Z");
const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fn = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const response = { response: { status: 400 }, payload: { code: 400002, message: "private raw response", access_token: "secret" }, diagnosticSecrets: ["secret"] };

test("restriction snapshots distinguish a live join rejection from guild settings without copying sensitive fields", () => {
  const snapshot = captureCommunityInviteRestriction({ result: response, added: 464, delay: 20, speedProfile: "custom" }, now);
  assert.deepEqual(snapshot, { source: "join_response", detectedAt: "2026-11-25T12:00:00.000Z", discordCode: 400002, httpStatus: 400, added: 464, configuredDelay: 20, speedProfile: "custom" });
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("private raw"), false);
  assert.equal(communityInviteRestrictionSummary(snapshot), "Discord rejected new member access · Discord 400002 · HTTP 400");
  const settings = captureCommunityInviteRestriction({ guild: { features: ["INVITES_DISABLED"], incidents_data: { invites_disabled_until: "2026-11-25T13:00:00Z" } } }, now);
  assert.equal(settings.source, "guild_settings"); assert.equal(settings.invitesDisabled, true);
  assert.equal(settings.invitesDisabledUntil, "2026-11-25T13:00:00.000Z");
  assert.equal(communityInviteRestrictionSummary(settings), "Server invites are disabled");
});

test("expired pause timestamps are omitted and unknown historical reasons are not invented", () => {
  const settings = captureCommunityInviteRestriction({ guild: { features: [], incidents_data: { invites_disabled_until: "2026-11-25T11:00:00Z" } } }, now);
  assert.equal(settings.invitesDisabledUntil, undefined);
  assert.equal(communityInviteRestrictionSummary(), "Server restriction detected. Open order details to review.");
  assert.match(communityInviteRestrictionSummary(captureCommunityInviteRestriction({ legacy: true }, now)), /earlier delivery results · Discord 400002/);
});

test("the real delivery worker preserves the original restriction evidence when putting accounts back in queue", async () => {
  const worker = fn("runCommunityOrder");
  const pause = worker.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "pauseForCommunityBotIssue");
  const snapshot = captureCommunityInviteRestriction({ result: response }, now);
  let saved;
  const scope = { members: [{ discord_user_id: "a" }, { discord_user_id: "b" }], results: [{ discordUserId: "a", state: "joining" }, { discordUserId: "b", state: "queued" }],
    order: { uniqid: "order", delay: 20, speedProfile: "custom" }, added: 464, config: { guildId: "guild" },
    createCommunityBotInvite: () => "https://discord.com/oauth2/authorize", getCommunityOrderJoinMethod: () => "create_invite",
    saveCommunityProgress: async value => { saved = value; }
  };
  vm.runInNewContext(`${pause.getText(ast)}; this.run = pauseForCommunityBotIssue;`, scope);
  await scope.run(0, { status: "INVITES PAUSED", waitingCode: "discord_guild_invites_limited", details: "Server access paused.", memberDetails: "Waiting for Discord.", inviteRestriction: snapshot });
  assert.equal(saved.status, "INVITES PAUSED"); assert.equal(saved.added, 464);
  assert.equal(saved.inviteRestriction.discordCode, 400002); assert.equal(saved.inviteRestriction.httpStatus, 400);
  assert.equal(saved.inviteRestriction.added, 464); assert.equal(saved.inviteRestriction.configuredDelay, 20);
  assert.equal(saved.communityResults[0].state, "queued"); assert.equal(saved.communityResults[1].state, "queued");
});

test("the real single-member replacement saves the same restriction evidence without disabling its account", async () => {
  let saved;
  const order = { uniqid: "order", provider: "community", delay: 20, speedProfile: "custom", communityResults: [{ discordUserId: "member", state: "replacing" }, { discordUserId: "delivered", state: "joined" }] };
  const query = async (sql, params) => {
    if (sql.startsWith("SELECT payload")) return { rows: [{ payload: order }] };
    if (sql.startsWith("UPDATE tracked_orders")) saved = JSON.parse(params[1]);
    if (sql.includes("UPDATE community_oauth_joins")) assert.fail("a guild restriction must not disable a stock account");
    return { rows: [] };
  };
  const scope = { pool: { connect: async () => ({ query, release() {} }), query }, captureCommunityInviteRestriction,
    normalizeCommunityJoinMethod: () => "create_invite", addCommunityGuildMember: async () => response, loadCommunityAccessToken: async () => "test-credential",
    isCommunityMembershipScreeningResponse: () => false, isDiscordMemberAuthorizationInactive: () => false,
    createCommunityBotInvite: () => "https://discord.com/oauth2/authorize", getCommunityOrderJoinMethod: () => "create_invite" };
  vm.runInNewContext(`${fn("isDiscordGuildInviteLimited").getText(ast)}\n${fn("processCommunityReplacement").getText(ast)}; this.run = processCommunityReplacement;`, scope);
  await scope.run("order", 0, { discord_user_id: "member" }, { guildId: "guild" });
  assert.equal(saved.status, "INVITES PAUSED"); assert.equal(saved.inviteRestriction.discordCode, 400002);
  assert.equal(saved.inviteRestriction.source, "join_response"); assert.equal(saved.added, 1);
});

test("public responses remove admin restriction evidence", () => {
  const scope = { canPublicLeaveAll: () => false, getCustomerReactionSummary: () => ({}), hideCommunityLeaveInformation: value => value };
  vm.runInNewContext(`${fn("sanitizePublicCommunityOrder").getText(ast)}; this.sanitize = sanitizePublicCommunityOrder;`, scope);
  const original = { uniqid: "order", inviteRestriction: captureCommunityInviteRestriction({ result: response }, now) };
  const sanitized = scope.sanitize(original);
  assert.equal(sanitized.inviteRestriction, undefined);
  assert.equal(sanitized.uniqid, "order"); assert.ok(original.inviteRestriction);
});
