import type { BalanceResponse, CreateOrderPayload, CreateOrderResponse, OrderStatusResponse } from "../types";

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
  });

  const text = await response.text();
  let payload: unknown = text;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : typeof payload === "string"
          ? payload
          : `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export function getTokenuConfig() {
  return requestJson<{ configured: boolean }>("/api/tokenu/config");
}

export function saveTokenuApiKey(apiKey: string) {
  return requestJson<{ configured: true; balance?: number }>("/api/tokenu/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey })
  });
}

export async function clearTokenuApiKey() {
  const response = await fetch("/api/tokenu/config", { method: "DELETE", cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Request failed with ${response.status}`);
  }
}

export async function getBalance() {
  return requestJson<BalanceResponse>("/api/tokenu/balance");
}

export async function createOrder(payload: CreateOrderPayload) {
  return requestJson<CreateOrderResponse>("/api/tokenu/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function getOrderStatus(uniqid: string) {
  return requestJson<OrderStatusResponse>(`/api/tokenu/orders/${encodeURIComponent(uniqid)}/status`);
}

async function requestPublicOrderApi<T>(uniqid: string, action: "status" | "delay", init?: RequestInit) {
  const response = await fetch(`/api/public/orders/${encodeURIComponent(uniqid)}/${action}`, {
    cache: "no-store",
    ...init
  });
  const payload = (await response.json().catch(() => ({}))) as { message?: string } & T;

  if (!response.ok) {
    throw new Error(payload.message ?? `Request failed with ${response.status}`);
  }

  return payload;
}

export function getPublicOrderStatus(uniqid: string) {
  return requestPublicOrderApi<OrderStatusResponse>(uniqid, "status");
}

export function updatePublicOrderDelay(uniqid: string, delay: number) {
  return requestPublicOrderApi<unknown>(uniqid, "delay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delay })
  });
}

export async function checkAvailableAmount(service: string, id: string) {
  return requestJson<{ available: number; maximum: number }>(
    `/api/tokenu/check?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}`
  );
}

export async function updateOrderDelay(uniqid: string, delay: number) {
  return requestJson<unknown>(`/api/tokenu/orders/${encodeURIComponent(uniqid)}/delay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ delay })
  });
}
