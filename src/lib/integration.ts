import type { BalanceResponse, BoostStock, BoostTokenStockInput, BoostTokenStockSnapshot, CreateOrderPayload, CreateOrderResponse, OrderProvider, OrderStatusResponse } from "../types";
import { isBoostService, isCommunityService } from "./services";

async function requestJson<T>(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      ...init,
    });
  } catch {
    throw new Error("The server could not be reached. Please try again.");
  }

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

export function getIntegrationConfig() {
  return requestJson<{ tokenuConfigured: boolean; dcordConfigured: boolean; configured: boolean; boostStock: BoostStock }>("/api/integration/config");
}

export function saveIntegrationApiKey(apiKey: string) {
  return requestJson<{ configured: true; balance?: number }>("/api/integration/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey })
  });
}

export async function clearIntegrationApiKey() {
  const response = await fetch("/api/integration/config", { method: "DELETE", cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Request failed with ${response.status}`);
  }
}

export async function getBalance() {
  return requestJson<BalanceResponse>("/api/integration/balance");
}

export async function createOrder(payload: CreateOrderPayload) {
  if (isCommunityService(payload.service)) {
    return requestJson<CreateOrderResponse>("/api/community/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  if (isBoostService(payload.service)) {
    return requestJson<CreateOrderResponse>("/api/dcord/boost-orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  return requestJson<CreateOrderResponse>("/api/integration/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function getOrderStatus(uniqid: string, provider: OrderProvider = "tokenu") {
  const prefix = provider === "dcord"
    ? "/api/dcord/boost-orders"
    : provider === "community"
      ? "/api/community/orders"
      : "/api/integration/orders";
  return requestJson<OrderStatusResponse>(`${prefix}/${encodeURIComponent(uniqid)}/status`);
}

export async function restartOrder(uniqid: string) {
  return requestJson<unknown>(`/api/integration/orders/${encodeURIComponent(uniqid)}/restart`, { method: "POST" });
}

async function requestPublicOrderApi<T>(uniqid: string, action: "status" | "delay" | "restart", init?: RequestInit) {
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

export function restartPublicOrder(uniqid: string) {
  return requestPublicOrderApi<unknown>(uniqid, "restart", { method: "POST" });
}

export function replaceDcordBoostToken(uniqid: string, resultIndex: number) {
  return requestJson<{ order: OrderStatusResponse; stock: BoostStock }>(
    `/api/dcord/boost-orders/${encodeURIComponent(uniqid)}/replace-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultIndex })
    }
  );
}

export function retryDcordBoostToken(uniqid: string, resultIndex: number) {
  return requestJson<OrderStatusResponse>(
    `/api/dcord/boost-orders/${encodeURIComponent(uniqid)}/retry-token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultIndex })
    }
  );
}

export function resumeDcordBoostOrder(uniqid: string) {
  return requestJson<OrderStatusResponse>(
    `/api/dcord/boost-orders/${encodeURIComponent(uniqid)}/resume`,
    { method: "POST" }
  );
}

export function cancelDcordBoostOrder(uniqid: string) {
  return requestJson<OrderStatusResponse>(
    `/api/dcord/boost-orders/${encodeURIComponent(uniqid)}/cancel`,
    { method: "POST" }
  );
}

export function replaceCommunityMember(uniqid: string, resultIndex: number) {
  return requestJson<OrderStatusResponse>(
    `/api/community/orders/${encodeURIComponent(uniqid)}/replace-member`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultIndex })
    }
  );
}

export async function checkAvailableAmount(service: string, id: string, duration = 1) {
  if (isCommunityService(service)) {
    return requestJson<{ available: number; maximum: number }>(
      `/api/community/availability?invite=${encodeURIComponent(id)}`
    );
  }
  if (isBoostService(service)) {
    return requestJson<{ available: number; maximum: number }>(
      `/api/dcord/boost-stock?duration=${encodeURIComponent(duration)}`
    );
  }

  return requestJson<{ available: number; maximum: number }>(
    `/api/integration/check?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}`
  );
}

export async function updateOrderDelay(uniqid: string, delay: number, provider: OrderProvider = "tokenu") {
  const prefix = provider === "community" ? "/api/community/orders" : "/api/integration/orders";
  return requestJson<unknown>(`${prefix}/${encodeURIComponent(uniqid)}/delay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ delay })
  });
}

export function saveDcordApiKey(apiKey: string) {
  return requestJson<{ configured: true }>("/api/dcord/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey })
  });
}

export async function clearDcordApiKey() {
  const response = await fetch("/api/dcord/config", { method: "DELETE", cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Request failed with ${response.status}`);
  }
}

export function checkDcordConnection() {
  return requestJson<{ connected: boolean; status: string; message: string; httpStatus?: number; taskId?: string }>("/api/dcord/check", {
    method: "POST"
  });
}

export function saveBoostStock(stock: BoostTokenStockInput) {
  return requestJson<{ stock: BoostStock }>("/api/dcord/boost-stock", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(stock)
  });
}

export function getBoostStockTokens() {
  return requestJson<BoostTokenStockSnapshot>("/api/dcord/boost-stock?includeTokens=true");
}

export function deleteBoostStockTokens(payload: { duration: 1 | 3; tokens: string[] }) {
  return requestJson<BoostTokenStockSnapshot>("/api/dcord/boost-stock/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function markBoostStockTokensUsed(payload: { duration: 1 | 3; tokens: string[] }) {
  return requestJson<BoostTokenStockSnapshot>("/api/dcord/boost-stock/mark-used", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export function returnUsedBoostToken(ids: string | string[]) {
  return requestJson<BoostTokenStockSnapshot>("/api/dcord/boost-stock/return-used", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [ids] })
  });
}

export function deleteUsedBoostTokens(ids: string[]) {
  return requestJson<BoostTokenStockSnapshot>("/api/dcord/boost-stock/delete-used", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  });
}
