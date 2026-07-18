import type { BalanceResponse, CreateOrderPayload, CreateOrderResponse, OrderStatusResponse } from "../types";
import { getApiKey } from "./auth";

const API_BASE = "https://dev.tokenu.net/api/v1/reseller";
const OAUTH_API_BASE = "https://api.tokenu.net/api/oauth2";

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
  return requestJson<OrderStatusResponse>(API_BASE, `/status?uniqid=${encodeURIComponent(uniqid)}`);
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
