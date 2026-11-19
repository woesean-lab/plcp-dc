import crypto from "node:crypto";

function primaryCategory(order) {
  return order.categoryId || order.stockType || (order.service === "COMMUNITY-ONLINE" ? "online" : "offline");
}

export function planCommunityOrderCategoryTransfer(order, source, target, transferredAt) {
  if (order?.provider !== "community") return { matched: false };
  const primary = primaryCategory(order);
  const allocations = Array.isArray(order.categoryAllocations) ? order.categoryAllocations : [];
  const members = Array.isArray(order.communityResults) ? order.communityResults : [];
  const categoryIds = [primary, ...allocations.map((item) => item?.categoryId), ...members.map((item) => item?.categoryId || primary)];
  if (!categoryIds.includes(source.id)) return { matched: false };
  if (categoryIds.includes(target.id)) return { matched: true, blocked: "This order already contains both categories. Its separate support periods need to be kept." };
  if (!["COMPLETED", "PARTIAL", "ERROR", "FAILED", "CANCELLED", "CANCELED", "TERMINATED", "INVALID"].includes(String(order.status ?? "").toUpperCase())) {
    return { matched: true, blocked: "Finish or cancel delivery before moving this order." };
  }
  if (order.autoLeaveJob?.status === "running"
      || members.some((member) => ["joining", "replacing"].includes(String(member?.state ?? "").toLowerCase()))) {
    return { matched: true, blocked: "An operation is still running for this order. Try again when it finishes." };
  }
  const display = { categoryId: target.id, categoryName: target.name, colorKey: target.color_key };
  const nextAllocations = allocations.map((allocation) => allocation?.categoryId === source.id ? {
    ...allocation, ...display,
    checkReplacementEnabled: target.check_replacement_enabled !== false,
    reactionUseEnabled: target.reaction_use_enabled === true
  } : allocation);
  return { matched: true, order: {
    ...order,
    ...(primary === source.id ? {
      categoryId: target.id, stockType: target.id,
      categoryName: allocations.length > 1 ? `${allocations.length} categories` : target.name,
      categoryColorKey: target.color_key,
      categoryCheckReplacementEnabled: allocations.length > 1
        ? nextAllocations.some((allocation) => allocation.checkReplacementEnabled !== false)
        : target.check_replacement_enabled !== false,
      categoryReactionUseEnabled: target.reaction_use_enabled === true
    } : {}),
    ...(Array.isArray(order.categoryAllocations) ? { categoryAllocations: nextAllocations } : {}),
    ...(Array.isArray(order.communityResults) ? { communityResults: members.map((member) =>
      member && typeof member === "object" && !Array.isArray(member) && (member.categoryId || primary) === source.id ? { ...member, ...display, reactionUseEnabled: target.reaction_use_enabled === true } : member) } : {}),
    categoryTransferHistory: [...(Array.isArray(order.categoryTransferHistory) ? order.categoryTransferHistory : []), {
      fromCategoryId: source.id, fromCategoryName: source.name,
      toCategoryId: target.id, toCategoryName: target.name, transferredAt
    }]
  } };
}

export function createCommunityOrderCategoryTransferHandler({ pool, getConfig, transfers, isBusy = () => false }) {
  const parseCategoryId = (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null;
  };
  return async (req, res, next) => {
  const client = await pool.connect();
  const lockedIds = [];
  try {
    const config = await getConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members integration before moving orders." });
    const sourceId = parseCategoryId(req.params.categoryId);
    const targetId = parseCategoryId(req.body?.targetCategoryId);
    const apply = req.body?.apply === true;
    if (!sourceId || !targetId || sourceId === targetId) return res.status(400).json({ message: "Choose a different destination category." });
    await client.query("BEGIN");
    const categories = await client.query(
      "SELECT id, name, color_key, check_replacement_enabled, reaction_use_enabled, updated_at FROM community_stock_categories WHERE guild_id = $1 AND id = ANY($2::text[]) ORDER BY id FOR UPDATE",
      [config.guildId, [sourceId, targetId]]
    );
    const source = categories.rows.find((category) => category.id === sourceId);
    const target = categories.rows.find((category) => category.id === targetId);
    if (!source || !target) { await client.query("ROLLBACK"); return res.status(404).json({ message: "The source or destination category no longer exists." }); }
    const tracked = await client.query(
      `SELECT uniqid, payload, updated_at FROM tracked_orders
       WHERE payload->>'provider' = 'community'
         AND (payload->>'botApplicationId' IS NULL OR payload->>'botApplicationId' = $2)
         AND (payload->>'categoryId' = $1 OR payload->>'stockType' = $1
           OR payload->'categoryAllocations' @> jsonb_build_array(jsonb_build_object('categoryId', $1::text))
           OR payload->'communityResults' @> jsonb_build_array(jsonb_build_object('categoryId', $1::text))
           OR (NOT (payload ? 'categoryId') AND NOT (payload ? 'stockType') AND $1 IN ('online', 'offline')
             AND CASE WHEN payload->>'service' = 'COMMUNITY-ONLINE' THEN 'online' ELSE 'offline' END = $1))
       ORDER BY uniqid FOR UPDATE`, [sourceId, config.clientId]
    );
    if (apply) for (const row of tracked.rows) {
      if (transfers.has(row.uniqid)) throw Object.assign(new Error("An order category transfer is already running."), { statusCode: 409 });
      transfers.add(row.uniqid); lockedIds.push(row.uniqid);
    }
    const leases = tracked.rowCount ? await client.query("SELECT order_id FROM community_order_worker_leases WHERE order_id = ANY($1::text[]) AND expires_at > NOW() UNION SELECT order_id FROM community_reaction_jobs WHERE order_id = ANY($1::text[]) AND status IN ('pending', 'processing', 'running')", [tracked.rows.map((row) => row.uniqid)]) : { rows: [] };
    const busy = new Set(leases.rows.map((row) => row.order_id));
    const now = new Date().toISOString();
    const patches = [];
    const blocked = [];
    for (const row of tracked.rows) {
      const plan = planCommunityOrderCategoryTransfer(row.payload, source, target, now);
      if (!plan.matched) continue;
      const active = busy.has(row.uniqid) || isBusy(row.uniqid);
      if (plan.blocked || active) blocked.push({ uniqid: row.uniqid, reason: plan.blocked || "A member operation is still running. Try again when it finishes." });
      else patches.push({ uniqid: row.uniqid, payload: plan.order });
    }
    const previewToken = crypto.createHash("sha256").update(JSON.stringify([categories.rows, tracked.rows.map((row) => [row.uniqid, row.updated_at]), blocked])).digest("hex");
    if (apply && req.body?.previewToken !== previewToken) {
      await client.query("ROLLBACK"); return res.status(409).json({ message: "Orders changed since the preview. Preview the transfer again." });
    }
    if (apply && patches.length) await client.query(
      `UPDATE tracked_orders AS orders SET payload = patch.payload, updated_at = NOW()
       FROM jsonb_to_recordset($1::jsonb) AS patch(uniqid text, payload jsonb)
       WHERE orders.uniqid = patch.uniqid`, [JSON.stringify(patches)]
    );
    await client.query("COMMIT");
    res.json({ sourceName: source.name, targetName: target.name, matched: patches.length + blocked.length, transferable: patches.length, moved: apply ? patches.length : 0, blocked: blocked.slice(0, 10), blockedCount: blocked.length, previewToken });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {}); next(error);
  } finally {
    lockedIds.forEach((id) => transfers.delete(id)); client.release();
  }
};
}
