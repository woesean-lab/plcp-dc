import crypto from "node:crypto";
import { getCustomerReactionSummary, customerReactionMemberEligible } from "./customer-order-reactions.mjs";

export function createCommunityReactionMessageHandler({ pool, parseDiscordMessageLink, communityReactionEmojiLimit, isCommunityReactionEmoji, isCommunityCustomReactionSelector, createNaturalCommunityReactionAssignments, sanitizePublicCommunityOrder, hydrateCommunityOrderCategories }) {
  return async function updateCommunityReactionMessage(req, res, next) {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const isPublicRequest = req.path.startsWith("/api/public/");
    const reactionMessage = parseDiscordMessageLink(req.body?.messageLink);
    const requestedCount = Number.parseInt(req.body?.reactionCount, 10);
    const requestedEmojis = [...new Set((Array.isArray(req.body?.emojis) ? req.body.emojis : [])
      .map((emoji) => String(emoji ?? "").trim())
      .filter(Boolean))];
    const mixedEmojiMode = requestedEmojis.length === 1 && requestedEmojis[0] === "mixed";
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });
    if (!reactionMessage) return res.status(400).json({ message: "Enter a valid Discord message link." });

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const storedOrder = tracked.rows[0]?.payload;
    const order = isPublicRequest && storedOrder ? await hydrateCommunityOrderCategories(storedOrder) : storedOrder;
    if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }
    if (!["PARTIAL", "COMPLETED"].includes(String(order.status ?? "").toUpperCase())) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Reaction requests become available after member delivery is completed or partial." });
    }
    if (reactionMessage.guildId !== String(order.serverId ?? "")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "The reaction message must belong to this order's Discord server." });
    }
    const customerSummary = isPublicRequest ? getCustomerReactionSummary(order) : null;
    if (isPublicRequest && !customerSummary.enabled) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Reactions are available only for enabled orders during their support period." });
    }
    const hasExplicitReactionCapacity = Number.isInteger(Number(order.reactionCapacity));
    const reactionCapacity = isPublicRequest ? customerSummary.dailyLimit : hasExplicitReactionCapacity
      ? Math.max(0, Number(order.reactionCapacity))
      : order.communityResults.filter((item) => item?.reactionAvailable === true).length;
    const existingRequests = Array.isArray(order.reactionRequests) ? order.reactionRequests : [];
    const assignedCount = existingRequests.reduce((total, request) => {
      const assignments = Array.isArray(request?.assignments) ? request.assignments : [];
      if (assignments.length) {
        return total + assignments.filter((assignment) => !["failed", "cancelled"].includes(String(assignment?.reactionState ?? "pending").toLowerCase())).length;
      }
      return total + Math.max(0, Number(request?.assignedCount) || 0);
    }, 0);
    const remainingCount = isPublicRequest ? customerSummary.remaining : Math.max(0, reactionCapacity - assignedCount);
    if (!reactionCapacity) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Reaction use is not enabled for this order." });
    }
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > remainingCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: remainingCount > 0
        ? `Choose a reaction amount between 1 and ${remainingCount}.`
        : isPublicRequest ? "Today's reaction limit has been used. It resets at midnight (Türkiye time)." : "This order's reaction limit has been used." });
    }
    if (!requestedEmojis.length || (!mixedEmojiMode && requestedEmojis.length > Math.min(communityReactionEmojiLimit, requestedCount)) || requestedEmojis.some((emoji) => emoji !== "mixed" && !isCommunityReactionEmoji(emoji) && !isCommunityCustomReactionSelector(emoji)) || requestedEmojis.includes("mixed") && !mixedEmojiMode) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: `Choose Mixed or between 1 and ${Math.min(communityReactionEmojiLimit, requestedCount)} supported emojis.` });
    }

    let assignmentEmojis = requestedEmojis;
    const deliveredMembers = order.communityResults.filter((item) =>
      isPublicRequest ? customerReactionMemberEligible(order, item) : item?.discordUserId && ["joined", "already_member"].includes(String(item?.state ?? "").toLowerCase())
    );
    const customEmojiSelectors = requestedEmojis.filter(isCommunityCustomReactionSelector);
    if (customEmojiSelectors.length) {
      assignmentEmojis = requestedEmojis.map((emoji) => {
        if (!isCommunityCustomReactionSelector(emoji)) return emoji;
        const match = emoji.match(/^<a?:([\w~]{1,64}):(\d{16,22})>$/);
        return `${match[1]}:${match[2]}`;
      });
    }

    const maximumRequestSize = deliveredMembers.length * (mixedEmojiMode ? communityReactionEmojiLimit : assignmentEmojis.length);
    if (!deliveredMembers.length || requestedCount > maximumRequestSize) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: deliveredMembers.length
        ? `With ${mixedEmojiMode ? "Mixed" : requestedEmojis.length} emojis, this delivered member pool can add at most ${maximumRequestSize} reactions to one message.`
        : "No delivered members are available for reactions yet." });
    }

    const requestId = crypto.randomUUID();
    const usedPairs = new Set(existingRequests
      .filter((request) => request?.messageLink === reactionMessage.url)
      .flatMap((request) => Array.isArray(request?.assignments) ? request.assignments : [])
      .filter((assignment) => !["failed", "cancelled"].includes(String(assignment?.reactionState ?? "pending").toLowerCase()))
      .map((assignment) => `${assignment?.discordUserId}:${assignment?.reactionEmoji}`));
    const assignments = createNaturalCommunityReactionAssignments(deliveredMembers, requestedCount, usedPairs, mixedEmojiMode ? null : assignmentEmojis);
    if (assignments.length !== requestedCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This delivered member pool does not have enough unused member and emoji combinations for that message." });
    }
    for (const assignment of assignments) {
      await client.query(
        `INSERT INTO community_reaction_jobs (order_id, request_id, discord_user_id, channel_id, message_id, emoji)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [uniqid, requestId, assignment.discordUserId, reactionMessage.channelId, reactionMessage.messageId, assignment.reactionEmoji]
      );
    }
    const updatedOrder = {
      ...order,
      reactionCapacity,
      reactionMessageLink: reactionMessage.url,
      reactionMessage: { channelId: reactionMessage.channelId, messageId: reactionMessage.messageId },
      reactionRequests: [...existingRequests, {
        id: requestId,
        ...(isPublicRequest ? { source: "customer", quotaDay: customerSummary.quotaDay } : {}),
        messageLink: reactionMessage.url,
        requestedCount,
        emojiCount: new Set(assignments.map((assignment) => assignment.reactionEmoji)).size,
        emojis: requestedEmojis,
        assignedCount: assignments.length,
        assignments,
        createdAt: new Date().toISOString()
      }],
      communityResults: order.communityResults
    };
    await client.query("UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [uniqid, JSON.stringify(updatedOrder)]);
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store").json(isPublicRequest ? sanitizePublicCommunityOrder(updatedOrder) : updatedOrder);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
};
}
