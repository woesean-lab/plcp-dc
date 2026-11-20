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
    if (/^autoLeave/i.test(key) || key === "membersLeftAt" || key === "membersLeaveAllRequestedAt" || key === "publicLeaveAllRequestedAt") delete sanitized[key];
  }
  sanitized.publicLeaveAllUsed = hasCommunityLeaveAllStarted(order);
  if (Array.isArray(order.communityResults)) {
    sanitized.communityResults = order.communityResults.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      return Object.fromEntries(Object.entries(item).filter(([key]) => !/^autoLeave/i.test(key) && key !== "leftServerAt"));
    });
  }
  return sanitized;
}

export function canPublicLeaveAll(order) {
  return order?.provider === "community"
    && order.publicLeaveAllEnabled === true
    && !hasCommunityLeaveAllStarted(order)
    && ["COMPLETED", "PARTIAL", "ERROR", "TERMINATED", "CANCELLED", "CANCELED"].includes(String(order.status ?? "").toUpperCase())
    && /^\d{16,22}$/.test(String(order.serverId ?? ""))
    && Array.isArray(order.communityResults)
    && !order.communityResults.some((item) => ["joining", "replacing", "queued"].includes(String(item?.state ?? "").toLowerCase()))
    && order.communityResults.some((item) => item?.state === "joined" && item.membershipStatus !== "removed" && /^\d{16,22}$/.test(String(item.discordUserId ?? "")));
}

// Commit the single-use claim before sending any Discord requests. A failed or
// interrupted operation stays consumed; only an administrator can retry it.
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
      throw Object.assign(new Error(hasCommunityLeaveAllStarted(order)
        ? "Leave all has already been used for this order."
        : "Leave all is unavailable. Wait for member delivery and other member operations to finish."), { statusCode: 409 });
    }
    const claimed = { ...order, publicLeaveAllRequestedAt: new Date().toISOString() };
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
