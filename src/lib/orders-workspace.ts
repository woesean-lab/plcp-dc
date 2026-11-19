import type { TrackedOrder } from "../types";
import { isBoostService } from "./services";
import { getOrderPeriod } from "./order-period";

export type OrdersFilters = { search: string; service: string; status: string; period: string; sort: string };
export const EMPTY_ORDERS_FILTERS: OrdersFilters = { search: "", service: "all", status: "all", period: "all", sort: "newest" };

export function orderIsBoost(order: TrackedOrder) {
  return order.provider === "dcord" || isBoostService(order.service);
}

export function orderStatus(status?: string) {
  const value = String(status ?? "NEW").trim().toUpperCase();
  if (value === "COMPLETED") return { label: "Completed", tone: "success" };
  if (["PROCESS", "RECOVERING"].includes(value)) return { label: value === "RECOVERING" ? "Recovering" : "In progress", tone: "live" };
  if (value.includes("INVITE") && value.includes("PAUSED")) return { label: "Invites paused", tone: "danger" };
  if (["ERROR", "INVALID", "TERMINATED", "FAILED"].includes(value)) return { label: value.charAt(0) + value.slice(1).toLowerCase(), tone: "danger" };
  if (["CANCELLED", "CANCELED"].includes(value)) return { label: "Cancelled", tone: "muted" };
  if (value === "PARTIAL") return { label: "Partial delivery", tone: "warning" };
  if (value === "PAUSED") return { label: "Paused", tone: "warning" };
  return { label: value === "NEW" ? "New order" : value.charAt(0) + value.slice(1).toLowerCase().replace(/[_-]/g, " "), tone: "muted" };
}

export function orderDelivery(order: TrackedOrder) {
  const total = typeof order.amount === "number" && Number.isFinite(order.amount) ? Math.max(0, order.amount) : null;
  const added = typeof order.added === "number" && Number.isFinite(order.added) ? order.added : String(order.status).toUpperCase() === "COMPLETED" ? total ?? 0 : 0;
  const delivered = Math.min(Math.max(0, added), total ?? Number.MAX_SAFE_INTEGER);
  return { total, delivered, remaining: total === null ? null : Math.max(0, total - delivered), percent: total ? Math.min(100, delivered / total * 100) : 0 };
}

export function hasFailedLeave(order: TrackedOrder) {
  return Boolean(order.autoLeaveJob && order.autoLeaveJob.status !== "running" && order.autoLeaveJob.failed > 0);
}

export function canStartOrderLeave(order: TrackedOrder, now: number) {
  if (order.provider !== "community" || order.autoLeaveJob || order.membersLeftAt) return false;
  if (typeof order.autoLeaveCandidateCount === "number") return order.autoLeaveCandidateCount > 0;
  const expiredCategories = new Set((order.categoryAllocations ?? [])
    .filter((category) => category.isPeriodic && category.expiredAt && new Date(category.expiredAt).getTime() <= now)
    .map((category) => category.categoryId));
  const expired = getOrderPeriod(order, now).state === "expired";
  if (!order.communityResults?.length) return expired && Number(order.added) > 0;
  return order.communityResults.some((member) => String(member.state).toLowerCase() === "joined" && member.membershipStatus !== "removed"
    && (expiredCategories.size ? expiredCategories.has(String(member.categoryId ?? order.categoryId ?? "")) : expired));
}

export function filterWorkspaceOrders(orders: TrackedOrder[], filters: OrdersFilters, now: number) {
  const query = filters.search.trim().toLowerCase();
  return orders.filter((order) => {
    const status = String(order.status ?? "NEW").trim().toUpperCase();
    const period = getOrderPeriod(order, now).state;
    const matchesQuery = !query || [order.uniqid, order.serverName, order.serverId, order.service, order.categoryName, order.status, order.details]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
    const matchesService = filters.service === "all" || (orderIsBoost(order) ? "boosts" : "members") === filters.service;
    const matchesStatus = filters.status === "all" || (filters.status === "live" ? ["PROCESS", "RECOVERING"].includes(status) : filters.status === "attention"
      ? ["danger", "warning"].includes(orderStatus(status).tone) || status === "WAITING" : status === filters.status);
    const matchesPeriod = filters.period === "all" || filters.period === period || (filters.period === "active" && period === "soon") || (filters.period === "leave_failed" && hasFailedLeave(order));
    return matchesQuery && matchesService && matchesStatus && matchesPeriod;
  }).sort((a, b) => {
    const periodSort = filters.sort.startsWith("expiry");
    const left = periodSort ? getOrderPeriod(a, now).expiresAt : new Date(a.createdAt).getTime();
    const right = periodSort ? getOrderPeriod(b, now).expiresAt : new Date(b.createdAt).getTime();
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : a.uniqid.localeCompare(b.uniqid);
    if (!Number.isFinite(right)) return -1;
    const direction = ["oldest", "expiry_asc"].includes(filters.sort) ? 1 : -1;
    return (left - right) * direction || a.uniqid.localeCompare(b.uniqid);
  });
}
