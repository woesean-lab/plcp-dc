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
    'reactionEnabledAt', tracked_orders.payload->'reactionEnabledAt',
    'reactionDisabled', tracked_orders.payload->'reactionDisabled',
    'reactionDisabledAt', tracked_orders.payload->'reactionDisabledAt',
    'reactionFirstDayLimit', tracked_orders.payload->'reactionFirstDayLimit',
    'reactionLimitUpdates', tracked_orders.payload->'reactionLimitUpdates',
    'reactionSettingsRevision', tracked_orders.payload->'reactionSettingsRevision',
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
  const enabledAt = order?.reactionEnabledAt || order?.createdAt;
  const firstDay = limit > 0 && customerReactionDay(new Date(enabledAt).getTime()) === day;
  const firstDayLimit = Number.isSafeInteger(order?.reactionFirstDayLimit) && order.reactionFirstDayLimit > 0
    ? order.reactionFirstDayLimit : Number.isSafeInteger(order?.amount) && order.amount > 0 ? order.amount : limit;
  const todayLimit = firstDay ? firstDayLimit : limit;
  const allRequests = (Array.isArray(order?.reactionRequests) ? order.reactionRequests : []).filter((request) => request?.source === "customer");
  const totalUsed = allRequests.reduce((total, request) => total + (Array.isArray(request.assignments) && request.assignments.length
    ? request.assignments.filter((assignment) => !["failed", "cancelled"].includes(assignment.reactionState)).length : Math.max(0, Number(request.assignedCount) || 0)), 0);
  const requests = allRequests
    .filter((request) => (request.quotaDay || customerReactionDay(new Date(request.createdAt).getTime())) === day)
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
  const disabled = order?.reactionDisabled === true;
  const enabled = order?.provider === "community" && !disabled && limit > 0 && active.length > 0;
  return {
    enabled, disabled,
    settingsRevision: Number.isSafeInteger(order?.reactionSettingsRevision) && order.reactionSettingsRevision >= 0 ? order.reactionSettingsRevision : 0,
    canConfigure: order?.provider === "community" && active.length > 0,
    ready: ["PARTIAL", "COMPLETED"].includes(String(order?.status).toUpperCase()),
    dailyLimit: limit, todayLimit, firstDay, firstDayLimit, enabledAt: enabledAt || null, totalUsed,
    used, remaining: enabled ? Math.max(0, todayLimit - used) : 0,
    completed: requests.reduce((total, request) => total + request.completedCount, 0),
    failed: requests.reduce((total, request) => total + request.failedCount, 0),
    eligibleMembers: (Array.isArray(order?.communityResults) ? order.communityResults : []).filter((member) => customerReactionMemberEligible(order, member, now)).length,
    expiresAt: active.length ? new Date(Math.max(...active.map((portion) => new Date(portion.expiredAt).getTime()))).toISOString() : null,
    quotaDay: day, resetsAt: new Date(Date.parse(`${day}T00:00:00+03:00`) + dayMs).toISOString(), requests
  };
}

export function getCustomerReactionOverview(order, now = Date.now()) {
  const { requests, ...overview } = getCustomerReactionSummary(order, now);
  return overview;
}

export function planCustomerReactionSettings(order, dailyLimit, now = Date.now(), { enabled = true } = {}) {
  if (order?.provider !== "community") throw Object.assign(new Error("Members order could not be found."), { statusCode: 404 });
  if (typeof enabled !== "boolean") throw Object.assign(new Error("Choose whether customer reactions are enabled."), { statusCode: 400 });
  const revision = (Number.isSafeInteger(order.reactionSettingsRevision) && order.reactionSettingsRevision >= 0 ? order.reactionSettingsRevision : 0) + 1;
  if (!enabled) return { ...order, reactionSettingsRevision: revision, reactionDisabled: true, reactionDisabledAt: order.reactionDisabled === true && order.reactionDisabledAt ? order.reactionDisabledAt : new Date(now).toISOString() };
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1) throw Object.assign(new Error("Enter a positive whole number for the daily limit."), { statusCode: 400 });
  const summary = getCustomerReactionSummary(order, now);
  if (!summary.canConfigure) throw Object.assign(new Error("Reactions require an enabled category with active support."), { statusCode: 409 });
  const updatedAt = new Date(now).toISOString();
  const previousStart = order.reactionEnabledAt || (summary.dailyLimit > 0 ? order.createdAt : null);
  const enabledAt = previousStart && Number.isFinite(new Date(previousStart).getTime()) ? new Date(previousStart).toISOString() : updatedAt;
  const firstDayLimit = summary.enabled && summary.firstDay ? dailyLimit
    : order.reactionFirstDayLimit || (Number.isSafeInteger(order.amount) && order.amount > 0 ? order.amount : dailyLimit);
  return { ...order, reactionSettingsRevision: revision, reactionDailyLimit: dailyLimit, reactionCapacity: dailyLimit, reactionDisabled: false,
    reactionEnabledAt: enabledAt, reactionFirstDayLimit: firstDayLimit,
    reactionLimitUpdates: [...(Array.isArray(order.reactionLimitUpdates) ? order.reactionLimitUpdates : []),
      ...(dailyLimit !== summary.dailyLimit || firstDayLimit !== summary.firstDayLimit ? [{ dailyLimit, firstDayLimit, updatedAt }] : [])]
  };
}

// The caller holds the order row lock and commits only after this succeeds.
export async function saveCustomerReactionSettings(client, order, dailyLimit, now = Date.now(), options = {}) {
  const planned = planCustomerReactionSettings(order, dailyLimit, now, options);
  const result = await client.query(
    "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1 RETURNING payload",
    [order.uniqid, JSON.stringify(planned)]
  );
  const saved = result.rows[0]?.payload;
  if (!saved || saved.reactionSettingsRevision !== planned.reactionSettingsRevision
    || saved.reactionDailyLimit !== planned.reactionDailyLimit || saved.reactionDisabled !== planned.reactionDisabled
    || getCustomerReactionSummary(saved, now).todayLimit !== getCustomerReactionSummary(planned, now).todayLimit) {
    throw Object.assign(new Error("Reaction settings were not saved. Refresh the order and try again."), { statusCode: 409 });
  }
  return saved;
}
