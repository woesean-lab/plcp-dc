export type DiscordOnlinerStatus = "online" | "idle" | "dnd";
export type DiscordOnlinerActivityType = "playing" | "listening" | "watching" | "none";
export type DiscordOnlinerConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export type DiscordOnlinerSnapshot = {
  configured: boolean;
  hasBotToken: boolean;
  enabled: boolean;
  status: DiscordOnlinerStatus;
  activityType: DiscordOnlinerActivityType;
  activityText: string;
  connectionState: DiscordOnlinerConnectionState;
  bot: { id: string; username: string; tag: string; avatarUrl: string | null } | null;
  guildCount: number;
  connectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
};

export type DiscordOnlinerInput = {
  botToken?: string;
  enabled: boolean;
  status: DiscordOnlinerStatus;
  activityType: DiscordOnlinerActivityType;
  activityText: string;
};

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message ?? `Request failed with ${response.status}`);
  return payload as DiscordOnlinerSnapshot;
}

export function getDiscordOnliner() {
  return fetch("/api/onliner", { cache: "no-store", credentials: "same-origin" }).then(parseResponse);
}

export function saveDiscordOnliner(input: DiscordOnlinerInput) {
  return fetch("/api/onliner", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse);
}

export function reconnectDiscordOnliner() {
  return fetch("/api/onliner/reconnect", { method: "POST", credentials: "same-origin" }).then(parseResponse);
}

export function clearDiscordOnliner() {
  return fetch("/api/onliner", { method: "DELETE", credentials: "same-origin" }).then(parseResponse);
}
