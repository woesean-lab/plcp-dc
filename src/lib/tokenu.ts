import type { BalanceResponse, CreateOrderPayload, CreateOrderResponse, OrderStatusResponse } from "../types";
import { getApiKey } from "./auth";
import { readRuntimeEnv } from "./runtime-env";

const API_BASE = readRuntimeEnv("VITE_TOKENU_API_BASE_URL") ?? "https://dev.tokenu.net/api/v1/reseller";
const OAUTH_API_BASE = readRuntimeEnv("VITE_TOKENU_OAUTH_API_BASE_URL") ?? "https://api.tokenu.net/api/oauth2";

async function requestJson<T>(baseUrl: string, path: string, init: RequestInit = {}) {
  const apiKey = getApiKey();
  if (!apiKey && !path.includes("/status")) {
    throw new Error("API key missing. Open Admin settings and save your Tokenu key.");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: apiKey,
      ...(init.headers ?? {})
    }
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

export async function getBalance() {
  return requestJson<BalanceResponse>(API_BASE, "/balance");
}

export async function createOrder(payload: CreateOrderPayload) {
  return requestJson<CreateOrderResponse>(API_BASE, "/order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function getOrderStatus(uniqid: string) {
  const cacheBuster = Date.now();
  return requestJson<OrderStatusResponse>(
    API_BASE,
    `/status?uniqid=${encodeURIComponent(uniqid)}&_=${cacheBuster}`,
    { cache: "no-store" }
  );
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
    API_BASE,
    `/check?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}`
  );
}

export async function updateOrderDelay(uniqid: string, delay: number) {
  return requestJson<unknown>(OAUTH_API_BASE, "/delay", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ uniqid, delay })
  });
}
