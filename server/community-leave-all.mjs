import crypto from "node:crypto";
import { isCommunityDeliverySettled } from "../shared/community-delivery-state.mjs";
import { communityLeaveRunning, remainingCommunityLeaveMembers } from "./public-community-leave.mjs";

export function createCommunityLeaveAll({ pool, active, getConfig, leaveMember, forEachWithConcurrency, updateMembershipCache, isExpired }) {
  return async function leaveAll(order, { expiredOnly = false, source = "admin" } = {}) {
    const orderId = String(order?.uniqid ?? "").trim();
    if (!isCommunityDeliverySettled(order)) throw Object.assign(new Error("Wait for member delivery and replacements to finish before using Leave all."), { statusCode: 409 });
    if (active.has(orderId)) throw Object.assign(new Error("Leave all is already running for this order."), { statusCode: 409 });
    const reservedId = source === "customer" && order.membersLeaveJob?.status === "starting" ? order.membersLeaveJob.id : null;
    const runId = reservedId ?? crypto.randomUUID();
    active.add(orderId);
    let started = Boolean(reservedId);
    async function transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [orderId]);
        const current = locked.rows[0]?.payload;
        if (!current || current.provider !== "community") throw Object.assign(new Error("Members order could not be found."), { statusCode: 404 });
        const next = callback(current);
        await client.query("UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [orderId, JSON.stringify(next)]);
        await client.query("COMMIT");
        return next;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally { client.release(); }
    }
    try {
      let userIds;
      const initial = await transaction((current) => {
        if (!isCommunityDeliverySettled(current)) throw Object.assign(new Error("Wait for member delivery and replacements to finish before using Leave all."), { statusCode: 409 });
        if (current.autoLeaveJob?.status === "running" || (communityLeaveRunning(current) && !(reservedId && current.membersLeaveJob?.id === reservedId && current.membersLeaveJob.status === "starting"))) {
          throw Object.assign(new Error("Leave all is already running for this order."), { statusCode: 409 });
        }
        userIds = remainingCommunityLeaveMembers(current).filter((id) => !expiredOnly || current.communityResults.some((item) => String(item.discordUserId) === id && isExpired(current, item)));
        if (!/^\d{16,22}$/.test(String(current.serverId ?? "")) || !userIds.length) throw Object.assign(new Error("This order has no delivered members remaining in the server."), { statusCode: 409 });
        const now = new Date().toISOString();
        return { ...current, membersLeaveAllRequestedAt: current.membersLeaveAllRequestedAt ?? now, membersLeaveJob: {
          id: runId, status: "running", processed: 0, total: userIds.length, left: 0, alreadyLeft: 0, failed: 0, startedAt: now, updatedAt: now
        } };
      });
      started = true;
      const guildId = String(initial.serverId);
      const stock = await pool.query("SELECT discord_user_id, encrypted_account_token FROM community_oauth_joins WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])", [guildId, userIds]);
      const stockByUserId = new Map(stock.rows.map((member) => [String(member.discord_user_id), member]));
      const config = await getConfig();
      let persistenceError;
      await forEachWithConcurrency(userIds, 6, async (id) => {
        if (persistenceError) return;
        let outcome;
        try { outcome = await leaveMember(guildId, id, stockByUserId, config); }
        catch (error) { outcome = { state: "failed", details: error instanceof Error ? error.message : "Member could not leave." }; }
        try { await transaction((current) => {
          if (current.membersLeaveJob?.id !== runId) throw new Error("Leave all attempt changed before the member result was saved.");
          const now = new Date().toISOString();
          const failed = outcome.state === "failed";
          const communityResults = current.communityResults.map((item) => String(item?.discordUserId) !== id ? item : {
            ...item, leaveAllStatus: outcome.state, membershipDetails: outcome.details, membershipCheckedAt: now,
            ...(!failed ? { membershipStatus: "removed", membershipLeaveSource: source === "customer" ? "customer" : "admin", leftServerAt: now } : {})
          });
          const previous = current.membersLeaveJob;
          const processed = previous.processed + 1;
          const failedCount = previous.failed + (failed ? 1 : 0);
          const finished = processed >= previous.total;
          return { ...current, communityResults, membersLeaveJob: {
            ...previous, processed, left: previous.left + (outcome.state === "left" ? 1 : 0), alreadyLeft: previous.alreadyLeft + (outcome.state === "already_left" ? 1 : 0),
            failed: failedCount, status: finished ? failedCount ? "completed_with_errors" : "completed" : "running", updatedAt: now,
            ...(finished ? { completedAt: now } : {})
          }, ...(finished && failedCount === 0 && !expiredOnly ? { membersLeftAt: now } : {}) };
        }); } catch (error) {
          // Drain already-running requests before releasing the active attempt.
          persistenceError ??= error;
          return;
        }
        if (outcome.state !== "failed") updateMembershipCache(id, guildId, false);
      });
      if (persistenceError) throw persistenceError;
      const final = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1", [orderId]);
      const saved = final.rows[0].payload;
      const job = saved.membersLeaveJob;
      return { order: saved, summary: { total: job.total, left: job.left, alreadyLeft: job.alreadyLeft, failed: job.failed } };
    } catch (error) {
      if (started) await transaction((current) => current.membersLeaveJob?.id === runId ? {
        ...current, membersLeaveJob: { ...current.membersLeaveJob, status: "failed", updatedAt: new Date().toISOString(), completedAt: new Date().toISOString() }
      } : current).catch(() => {});
      throw error;
    } finally { active.delete(orderId); }
  };
}
