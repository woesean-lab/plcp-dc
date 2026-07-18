import type { TrackedOrder } from "../types";

type GuestLinkSource = Pick<TrackedOrder, "uniqid">;

export function buildGuestOrderLink(order: GuestLinkSource) {
  return new URL(`/monitor/${encodeURIComponent(order.uniqid)}`, window.location.origin).toString();
}
