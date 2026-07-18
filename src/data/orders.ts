import type { TrackedOrder } from "../types";

const STORAGE_KEY = "tokenu.trackedOrders";

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const payload = await response.json().catch(() => ({})) as { message?: string };
  throw new Error(payload.message ?? `Request failed with ${response.status}`);
}

export async function loadTrackedOrders(): Promise<TrackedOrder[]> {
  const orders = await parseResponse<TrackedOrder[]>(await fetch("/api/orders", { credentials: "same-origin", cache: "no-store" }));
  if (orders.length || typeof window === "undefined") return orders;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const legacyOrders = raw ? (JSON.parse(raw) as TrackedOrder[]) : [];
    if (legacyOrders.length) {
      await saveTrackedOrders(legacyOrders);
      localStorage.removeItem(STORAGE_KEY);
      return legacyOrders;
    }
  } catch {
    // Ignore malformed legacy browser data.
  }

  return [];
}

export async function saveTrackedOrders(orders: TrackedOrder[]) {
  await parseResponse<{ saved: number }>(
    await fetch("/api/orders", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orders })
    })
  );
}
