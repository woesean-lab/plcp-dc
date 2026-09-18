import type { TrackedOrder } from "../types";

type GuestLinkSource = Pick<TrackedOrder, "uniqid" | "isEldoradoSale">;

export function buildGuestOrderLink(order: GuestLinkSource) {
  const url = new URL(`/monitor/${encodeURIComponent(order.uniqid)}`, window.location.origin);
  url.searchParams.set("eldorado", order.isEldoradoSale === false ? "0" : "1");
  return url.toString();
}
