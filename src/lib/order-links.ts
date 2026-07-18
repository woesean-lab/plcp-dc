import type { TrackedOrder } from "../types";

type GuestLinkSource = Pick<TrackedOrder, "uniqid" | "service" | "serverName" | "amount" | "delay" | "createdAt">;

export function buildGuestOrderLink(order: GuestLinkSource) {
  const url = new URL(`/public/order/${encodeURIComponent(order.uniqid)}`, window.location.origin);

  if (order.service) url.searchParams.set("service", order.service);
  if (order.serverName) url.searchParams.set("serverName", order.serverName);
  if (typeof order.amount === "number") url.searchParams.set("amount", String(order.amount));
  if (typeof order.delay === "number") url.searchParams.set("delay", String(order.delay));
  if (order.createdAt) url.searchParams.set("createdAt", order.createdAt);

  return url.toString();
}
