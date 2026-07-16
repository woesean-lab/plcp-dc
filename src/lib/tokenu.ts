import type { BalanceResponse, CreateOrderPayload, CreateOrderResponse, OrderStatusResponse } from "../types";
import { getApiKey } from "./auth";

const API_BASE = "https://dev.tokenu.net/api/v1/reseller";

async function requestJson<T>(path: string, init: RequestInit = {}) {
  const apiKey = getApiKey();
  if (!apiKey && !path.includes("/status")) {
    throw new Error("API key missing. Open Admin settings and save your Tokenu key.");
  }

  const response = await fetch(`${API_BASE}${path}`, {
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
  return requestJson<BalanceResponse>("/balance");
}

export async function createOrder(payload: CreateOrderPayload) {
  return requestJson<CreateOrderResponse>("/order", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

export async function getOrderStatus(uniqid: string) {
  return requestJson<OrderStatusResponse>(`/status?uniqid=${encodeURIComponent(uniqid)}`);
}

export async function checkAvailableAmount(service: string, id: string) {
  return requestJson<{ available: number; maximum: number }>(
    `/check?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}`
  );
}
