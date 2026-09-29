export type DiscordOnlinerStatus = "online" | "idle" | "dnd";
export type DiscordOnlinerActivityType = "playing" | "listening" | "watching" | "none";
export type DiscordOnlinerConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
export type DiscordOnlinerLogLevel = "info" | "success" | "warn" | "error";

export type DiscordOnlinerLogEntry = {
  id: number;
  timestamp: string;
  level: DiscordOnlinerLogLevel;
  accountId: string | null;
  message: string;
};

export type DiscordOnlinerAccount = {
  id: string;
  hasBotToken: boolean;
  hasProxy: boolean;
  currentActivity: string | null;
  connectionState: DiscordOnlinerConnectionState;
  bot: { id: string; username: string; tag: string; avatarUrl: string | null } | null;
  guildCount: number;
  connectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
};

export type DiscordOnlinerSnapshot = {
  configured: boolean;
  hasBotToken: boolean;
  hasProxy: boolean;
  accounts: DiscordOnlinerAccount[];
  connectedCount: number;
  enabled: boolean;
  status: DiscordOnlinerStatus;
  activityType: DiscordOnlinerActivityType;
  activityText: string;
  rotationEnabled: boolean;
  rotationItems: string[];
  rotationMinMinutes: number;
  rotationMaxMinutes: number;
  currentActivity: string | null;
  connectionState: DiscordOnlinerConnectionState;
  bot: { id: string; username: string; tag: string; avatarUrl: string | null } | null;
  guildCount: number;
  connectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
  logs: DiscordOnlinerLogEntry[];
};

export type DiscordOnlinerInput = {
  enabled: boolean;
  status: DiscordOnlinerStatus;
  activityType: DiscordOnlinerActivityType;
  activityText: string;
  rotationEnabled: boolean;
  rotationItems: string[];
  rotationMinMinutes: number;
  rotationMaxMinutes: number;
};

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return payload as DiscordOnlinerSnapshot;
}

export function getDiscordOnliner() {
  return fetch("/api/onliner", { cache: "no-store", credentials: "same-origin" }).then(parseResponse);
}

export async function getDiscordOnlinerLogs(after = 0) {
  const response = await fetch(`/api/onliner/logs?after=${encodeURIComponent(String(after))}`, { cache: "no-store", credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return (Array.isArray(payload?.logs) ? payload.logs : []) as DiscordOnlinerLogEntry[];
}

export function saveDiscordOnliner(input: DiscordOnlinerInput) {
  return fetch("/api/onliner", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse);
}

export function addDiscordOnlinerAccount(input: { botToken: string; proxyUrl?: string }) {
  return fetch("/api/onliner/accounts", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse);
}

export function addDiscordOnlinerAccountsBulk(accounts: Array<{ botToken: string; proxyUrl?: string; lineNumber: number }>) {
  return fetch("/api/onliner/accounts/bulk", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accounts })
  }).then(parseResponse);
}

export function removeDiscordOnlinerAccount(accountId: string) {
  return fetch(`/api/onliner/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    credentials: "same-origin"
  }).then(parseResponse);
}

export function reconnectDiscordOnliner() {
  return fetch("/api/onliner/reconnect", { method: "POST", credentials: "same-origin" }).then(parseResponse);
}

export function clearDiscordOnliner() {
  return fetch("/api/onliner", { method: "DELETE", credentials: "same-origin" }).then(parseResponse);
}

export async function clearDiscordOnlinerLogs() {
  const response = await fetch("/api/onliner/logs", { method: "DELETE", credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  }
}
