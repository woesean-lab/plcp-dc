import { isCommunityDeliverySettled } from "../shared/community-delivery-state.mjs";
import crypto from "node:crypto";

export function remainingCommunityLeaveMembers(order) {
  return [...new Set((Array.isArray(order?.communityResults) ? order.communityResults : [])
    .filter((item) => String(item?.state ?? "").toLowerCase() === "joined" && item.membershipStatus !== "removed" && item.leaveAllStatus !== "failed" && item.autoLeaveStatus !== "failed")
    .map((item) => String(item?.discordUserId ?? ""))
    .filter((id) => /^\d{16,22}$/.test(id)))];
}

export function communityLeaveRunning(order) {
  const job = order?.membersLeaveJob;
  // A crashed process must not permanently prevent a retry of the remaining members.
  const updatedAt = Date.parse(job?.updatedAt ?? job?.startedAt ?? "");
  return ["starting", "running"].includes(job?.status)
    && (!Number.isFinite(updatedAt) || updatedAt > Date.now() - 5 * 60_000);
}

export function publicLeaveAllCategoryIds(order) {
  const primary = order?.categoryId || order?.stockType || (order?.service === "COMMUNITY-ONLINE" ? "online" : "offline");
  return [...new Set([primary,
    ...(Array.isArray(order?.categoryAllocations) ? order.categoryAllocations.map((item) => item?.categoryId) : []),
    ...(Array.isArray(order?.communityResults) ? order.communityResults.map((item) => item?.categoryId) : [])
  ].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

export function publicLeaveAllAllowedByCategories(order, categories) {
  const byId = categories instanceof Map ? categories : new Map(categories.map((category) => [category.id, category]));
  return publicLeaveAllCategoryIds(order).every((id) => byId.get(id)?.public_leave_all_enabled === true);
}

export function hasCommunityLeaveAllStarted(order) {
  return Boolean(order?.publicLeaveAllRequestedAt || order?.membersLeaveAllRequestedAt || order?.membersLeftAt || order?.autoLeaveJob
    || (Array.isArray(order?.communityResults) && order.communityResults.some((item) => item?.leftServerAt || item?.autoLeaveJobId || item?.autoLeaveStatus)));
}

export function hideCommunityLeaveInformation(order) {
  const sanitized = { ...order };
  for (const key of Object.keys(sanitized)) {
    if (/^autoLeave/i.test(key) || key === "membersLeaveJob" || key === "membersLeftAt" || key === "membersLeaveAllRequestedAt" || key === "publicLeaveAllRequestedAt") delete sanitized[key];
  }
  sanitized.publicLeaveAllUsed = hasCommunityLeaveAllStarted(order) && !order.communityResults?.some((item) => String(item?.state).toLowerCase() === "joined" && item.membershipStatus !== "removed");
  const manual = order.membersLeaveJob;
  const job = communityLeaveRunning(order) ? manual : order.autoLeaveJob?.status === "running" ? order.autoLeaveJob : manual;
  if (job) sanitized.memberLeaveProgress = {
    status: ["starting", "running"].includes(job.status) && job === manual && !communityLeaveRunning(order) ? "failed" : job.status,
    processed: Math.max(0, Number(job.processed) || 0), total: Math.max(0, Number(job.total) || 0),
    failed: Math.max(0, Number(job.failed) || 0), startedAt: job.startedAt
  };
  if (Array.isArray(order.communityResults)) {
    sanitized.communityResults = order.communityResults.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const safe = Object.fromEntries(Object.entries(item).filter(([key]) => !/^autoLeave/i.test(key) && key !== "leftServerAt"));
      if (item.autoLeaveStatus === "failed") safe.leaveAllStatus = "failed";
      delete safe.membershipLeaveSource;
      if (item.membershipStatus === "removed") {
        safe.membershipDetails = "Member is no longer in the server.";
        const source = ["customer", "admin", "automatic"].includes(item.membershipLeaveSource)
          ? item.membershipLeaveSource
          : ["left", "already_left"].includes(item.autoLeaveStatus) ? "automatic" : "unknown";
        safe.membershipLeaveSource = source;
      }
      return safe;
    });
  }
  return sanitized;
}

export function canPublicLeaveAll(order) {
  return order?.provider === "community"
    && order.publicLeaveAllEnabled === true
    && !communityLeaveRunning(order)
    && order.autoLeaveJob?.status !== "running"
    && isCommunityDeliverySettled(order)
    && /^\d{16,22}$/.test(String(order.serverId ?? ""))
    && remainingCommunityLeaveMembers(order).length > 0;
}

// Reserve this attempt before Discord work. Completed/failed attempts can retry
// only the members still present; concurrent sessions cannot reserve the same run.
export async function claimPublicLeaveAll(pool, orderId, guildId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [orderId]);
    let order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") {
      throw Object.assign(new Error("Members order could not be found."), { statusCode: 404 });
    }
    // Check live settings inside the claim transaction; a saved order snapshot
    // must never grant access after a category's permission has been disabled.
    const categories = await client.query(
      "SELECT id, public_leave_all_enabled FROM community_stock_categories WHERE guild_id = $1 AND id = ANY($2::text[])",
      [guildId, publicLeaveAllCategoryIds(order)]
    );
    if (!guildId || !publicLeaveAllAllowedByCategories(order, categories.rows)) {
      throw Object.assign(new Error("Leave all is not enabled for every category in this order."), { statusCode: 403 });
    }
    order = { ...order, publicLeaveAllEnabled: true };
    if (!canPublicLeaveAll(order)) {
      throw Object.assign(new Error(communityLeaveRunning(order) || order.autoLeaveJob?.status === "running"
        ? "Leave all is already running for this order."
        : "Leave all is unavailable. Wait for member delivery and other member operations to finish."), { statusCode: 409 });
    }
    const startedAt = new Date().toISOString();
    const claimed = { ...order, publicLeaveAllRequestedAt: startedAt, membersLeaveJob: {
      id: crypto.randomUUID(), status: "starting", processed: 0, total: remainingCommunityLeaveMembers(order).length,
      left: 0, alreadyLeft: 0, failed: 0, startedAt, updatedAt: startedAt
    } };
    await client.query("UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [orderId, JSON.stringify(claimed)]);
    await client.query("COMMIT");
    return claimed;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
