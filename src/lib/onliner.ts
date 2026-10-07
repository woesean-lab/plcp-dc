export type DiscordOnlinerStatus = "online" | "idle" | "dnd" | "mixed";
export type DiscordOnlinerActivityType = "playing" | "listening" | "watching" | "none" | "mixed";
export type DiscordOnlinerConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
export type DiscordOnlinerLogLevel = "info" | "success" | "warn" | "error";
export type DiscordOnlinerActivityChances = { playing: number; streaming: number; listening: number; watching: number };

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
  richPresenceEnabled: boolean;
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
  nextConnectionAt: string | null;
  enabled: boolean;
  status: DiscordOnlinerStatus;
  activityType: DiscordOnlinerActivityType;
  activityText: string;
  rotationEnabled: boolean;
  rotationItems: string[];
  rotationMinMinutes: number;
  rotationMaxMinutes: number;
  connectionDelaySeconds: number;
  statuses: Array<"online" | "idle" | "dnd">;
  activityChances: DiscordOnlinerActivityChances;
  randomizeEnabled: boolean;
  spotifyPlaylistId: string;
  youtubePlaylistId: string;
  games: string[];
  music: string[];
  streamingUsers: string[];
  streamingCategories: string[];
  streamingTitles: string[];
  watch: string[];
  currentActivity: string | null;
  connectionState: DiscordOnlinerConnectionState;
  bot: { id: string; username: string; tag: string; avatarUrl: string | null } | null;
  guildCount: number;
  connectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
  logs: DiscordOnlinerLogEntry[];
  applyResult?: {
    changed: boolean;
    presenceUpdated: boolean;
    connectionsRestarted: boolean;
  };
  worker?: {
    status: "online" | "offline" | "standby";
    workerId?: string | null;
    startedAt?: string | null;
    heartbeatAt: string | null;
    lastError?: string | null;
    connectionPaused: boolean;
  };
};

export type DiscordOnlinerInput = {
  enabled: boolean;
  statuses: Array<"online" | "idle" | "dnd">;
  activityChances: DiscordOnlinerActivityChances;
  randomizeEnabled: boolean;
  spotifyPlaylistId: string;
  youtubePlaylistId: string;
  games: string[];
  music: string[];
  streamingUsers: string[];
  streamingCategories: string[];
  streamingTitles: string[];
  watch: string[];
  rotationMinMinutes: number;
  rotationMaxMinutes: number;
  connectionDelaySeconds: number;
};

export type DiscordOnlinerAccountCredentials = {
  accountId: string;
  botToken: string;
  proxyUrl: string;
  richPresenceEnabled: boolean;
};

export type DiscordOnlinerProxyDetail = {
  proxy: string;
  countryCode: string | null;
  countryName: string | null;
  assignedAccounts: number;
  status: "available" | "cooling";
  failureCount: number;
  cooldownUntil: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
};

export type DiscordOnlinerProxyPool = {
  proxies: string[];
  details: DiscordOnlinerProxyDetail[];
  count: number;
  availableCount: number;
  coolingDownCount: number;
  assignedAccounts: number;
};

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return payload as DiscordOnlinerSnapshot;
}

export function getDiscordOnliner() {
  return fetch("/api/onliner", { cache: "no-store", credentials: "same-origin" }).then(parseResponse);
}

export async function getDiscordOnlinerProxies() {
  const response = await fetch("/api/onliner/proxies", { cache: "no-store", credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return payload as DiscordOnlinerProxyPool;
}

export async function saveDiscordOnlinerProxies(proxies: string[]) {
  const response = await fetch("/api/onliner/proxies", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proxies })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return payload as DiscordOnlinerProxyPool;
}

export async function addDiscordOnlinerProxies(proxies: string[]) {
  const response = await fetch("/api/onliner/proxies", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proxies })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return payload as DiscordOnlinerProxyPool & { addedCount: number; duplicateCount: number };
}

export async function removeDiscordOnlinerProxy(proxy: string) {
  const response = await fetch("/api/onliner/proxies", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proxy })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return payload as DiscordOnlinerProxyPool & { reassignedAccounts: number };
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

export function addDiscordOnlinerAccount(input: { botToken: string; richPresenceEnabled: boolean }) {
  return fetch("/api/onliner/accounts", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse);
}

export function addDiscordOnlinerAccountsBulk(accounts: Array<{ botToken: string; richPresenceEnabled: boolean; lineNumber: number }>) {
  return fetch("/api/onliner/accounts/bulk", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accounts })
  }).then(parseResponse);
}

export async function getDiscordOnlinerAccountCredentials(accountId: string) {
  const response = await fetch(`/api/onliner/accounts/${encodeURIComponent(accountId)}/credentials`, {
    cache: "no-store",
    credentials: "same-origin"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return payload as DiscordOnlinerAccountCredentials;
}

export function updateDiscordOnlinerAccount(accountId: string, input: { botToken: string; richPresenceEnabled: boolean }) {
  return fetch(`/api/onliner/accounts/${encodeURIComponent(accountId)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse);
}

export function removeDiscordOnlinerAccount(accountId: string) {
  return fetch(`/api/onliner/accounts/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    credentials: "same-origin"
  }).then(parseResponse);
}

export function reconnectDiscordOnlinerAccount(accountId: string) {
  return fetch(`/api/onliner/accounts/${encodeURIComponent(accountId)}/reconnect`, {
    method: "POST",
    credentials: "same-origin"
  }).then(parseResponse);
}

export function rotateDiscordOnlinerAccountProxy(accountId: string) {
  return fetch(`/api/onliner/accounts/${encodeURIComponent(accountId)}/rotate-proxy`, {
    method: "POST",
    credentials: "same-origin"
  }).then(parseResponse);
}

export function reconnectDiscordOnliner() {
  return fetch("/api/onliner/start", { method: "POST", credentials: "same-origin" }).then(parseResponse);
}

export function pauseDiscordOnlinerConnections() {
  return fetch("/api/onliner/stop", { method: "POST", credentials: "same-origin" }).then(parseResponse);
}

export function continueDiscordOnlinerConnections() {
  return fetch("/api/onliner/continue", { method: "POST", credentials: "same-origin" }).then(parseResponse);
}

export function stopDiscordOnlinerConnections() {
  return fetch("/api/onliner/disconnect", { method: "POST", credentials: "same-origin" }).then(parseResponse);
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
