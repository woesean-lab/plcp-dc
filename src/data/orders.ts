import type { TrackedOrder } from "../types";

const STORAGE_KEY = "tokenu.trackedOrders";

export function loadTrackedOrders(): TrackedOrder[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TrackedOrder[]) : [];
  } catch {
    return [];
  }
}

export function saveTrackedOrders(orders: TrackedOrder[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}
