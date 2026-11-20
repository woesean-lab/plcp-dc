import { getCommunityResultAllocation } from "../shared/community-order-allocations.mjs";
import { CUSTOMER_REACTION_LIMITS } from "../shared/reaction-limits.mjs";

// Member checks/reconciliation save older snapshots through the generic upsert.
// Reaction handlers and workers already update fresh rows under FOR UPDATE.
export const CUSTOMER_REACTION_SAVE_FIELDS_SQL = `CASE
  WHEN jsonb_typeof(tracked_orders.payload->'reactionDailyLimit') = 'number'
    AND (tracked_orders.payload->>'reactionDailyLimit')::numeric > 0
  THEN jsonb_strip_nulls(jsonb_build_object(
    'reactionDailyLimit', tracked_orders.payload->'reactionDailyLimit',
    'reactionCapacity', tracked_orders.payload->'reactionCapacity',
    'reactionRequests', tracked_orders.payload->'reactionRequests'
  )) ELSE '{}'::jsonb END`;

const dayMs = 86_400_000;
const turkeyOffset = 3 * 60 * 60_000;
export function customerReactionDay(now = Date.now()) {
  return Number.isFinite(Number(now)) ? new Date(Number(now) + turkeyOffset).toISOString().slice(0, 10) : "";
}

export function validateCustomerReactionLimit(categories, value) {
  if (value === undefined || value === null || value === 0) return 0;
  if (!CUSTOMER_REACTION_LIMITS.includes(value)) throw Object.assign(new Error("Choose a daily reaction limit of 50, 100, 200 or 500."), { statusCode: 400 });
  if (!categories.some((category) => category.reaction_use_enabled === true && category.is_periodic === true)) {
    throw Object.assign(new Error("Customer reactions require a reaction-enabled category with a support period."), { statusCode: 400 });
  }
  return value;
}

function portions(order) {
  return Array.isArray(order?.categoryAllocations) && order.categoryAllocations.length ? order.categoryAllocations : [{
    categoryId: order?.categoryId, reactionUseEnabled: order?.categoryReactionUseEnabled,
    isPeriodic: Boolean(order?.expiredAt), expiredAt: order?.expiredAt
  }];
}

function activePortion(portion, now) {
  return portion?.reactionUseEnabled === true && portion.isPeriodic === true
    && Number.isFinite(new Date(portion.expiredAt).getTime()) && new Date(portion.expiredAt).getTime() > now;
}

export function customerReactionMemberEligible(order, member, now = Date.now()) {
  if (!member?.discordUserId || !["joined", "already_member"].includes(String(member.state).toLowerCase()) || member.membershipStatus === "removed") return false;
  const allocation = Array.isArray(order?.categoryAllocations) && order.categoryAllocations.length
    ? getCommunityResultAllocation(order, member) : portions(order)[0];
  return activePortion(allocation, now);
}

export function getCustomerReactionSummary(order, now = Date.now()) {
  const limit = Number.isSafeInteger(order?.reactionDailyLimit) && order.reactionDailyLimit > 0 ? order.reactionDailyLimit : 0;
  const active = portions(order).filter((portion) => activePortion(portion, now));
  const day = customerReactionDay(now);
  const requests = (Array.isArray(order?.reactionRequests) ? order.reactionRequests : [])
    .filter((request) => request?.source === "customer" && (request.quotaDay || customerReactionDay(new Date(request.createdAt).getTime())) === day)
    .map((request) => {
      const assignments = Array.isArray(request.assignments) ? request.assignments : [];
      const completedCount = assignments.filter((assignment) => assignment.reactionState === "completed").length;
      const failedCount = assignments.filter((assignment) => assignment.reactionState === "failed").length;
      const cancelledCount = assignments.filter((assignment) => assignment.reactionState === "cancelled").length;
      return { id: request.id, messageLink: request.messageLink, requestedCount: request.requestedCount,
        assignedCount: assignments.length || Math.max(0, Number(request.assignedCount) || 0),
        emojiCount: request.emojiCount, emojis: request.emojis, createdAt: request.createdAt,
        completedCount, failedCount, cancelledCount };
    });
  const used = requests.reduce((total, request) => total + request.assignedCount - request.failedCount - request.cancelledCount, 0);
  return {
    enabled: order?.provider === "community" && limit > 0 && active.length > 0,
    ready: ["PARTIAL", "COMPLETED"].includes(String(order?.status).toUpperCase()),
    dailyLimit: limit, used, remaining: Math.max(0, limit - used),
    completed: requests.reduce((total, request) => total + request.completedCount, 0),
    failed: requests.reduce((total, request) => total + request.failedCount, 0),
    eligibleMembers: (Array.isArray(order?.communityResults) ? order.communityResults : []).filter((member) => customerReactionMemberEligible(order, member, now)).length,
    expiresAt: active.length ? new Date(Math.max(...active.map((portion) => new Date(portion.expiredAt).getTime()))).toISOString() : null,
    quotaDay: day, resetsAt: new Date(Date.parse(`${day}T00:00:00+03:00`) + dayMs).toISOString(), requests
  };
}
