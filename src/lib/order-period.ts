import type { TrackedOrder } from "../types";
import { getOrderSupportExpiration } from "./order-status";

export function getOrderPeriod(order: TrackedOrder, now: number) {
  const expiration = getOrderSupportExpiration(order);
  const expiresAt = expiration === null ? Number.NaN : new Date(expiration).getTime();
  const state = !Number.isFinite(expiresAt) ? "none" : expiresAt <= now ? "expired" : expiresAt <= now + 7 * 86400_000 ? "soon" : "active";
  return { state, expiresAt };
}
