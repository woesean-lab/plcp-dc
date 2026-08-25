export type CommunityGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
};

export type CommunityBot = {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
};

export type CommunityJoinSummary = {
  configured: boolean;
  missing?: string[];
  bot?: CommunityBot;
  guild?: CommunityGuild;
  joined: number;
  authorized?: number;
  ready?: number;
  alreadyMember?: number;
  failed?: number;
  syncing?: boolean;
};

export type CommunityJoinRecord = {
  id: string;
  username: string;
  avatarUrl: string | null;
  status: "authorized" | "joined" | "already_member" | "failed";
  details: string | null;
  authorizedAt: string;
  joinedAt: string | null;
};

export type CommunityAdminStatus = CommunityJoinSummary & {
  recent: CommunityJoinRecord[];
};

export type CommunityConfig = {
  configured: boolean;
  stored: boolean;
  clientId: string;
  redirectUri: string;
  hasClientSecret: boolean;
  hasBotToken: boolean;
  guildName?: string;
};

export type CommunityConfigInput = {
  clientId: string;
  clientSecret: string;
  botToken: string;
  redirectUri: string;
};

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `Request failed with ${response.status}`);
  return payload;
}

export function getPublicCommunityStatus() {
  return fetch("/api/community/public", { cache: "no-store" }).then(parseResponse<CommunityJoinSummary>);
}

export function getCommunityAdminStatus() {
  return fetch("/api/community/status", { cache: "no-store", credentials: "same-origin" }).then(parseResponse<CommunityAdminStatus>);
}

export function syncCommunityAuthorizations() {
  return fetch("/api/community/sync", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin"
  }).then(parseResponse<{ checked: number; removed: number; errors: number }>);
}

export function removeCommunityAuthorization(discordUserId: string) {
  return fetch(`/api/community/members/${encodeURIComponent(discordUserId)}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin"
  }).then(parseResponse<{ removed: boolean; username: string; revoked: boolean }>);
}

export function getCommunityConfig() {
  return fetch("/api/community/config", { cache: "no-store", credentials: "same-origin" }).then(parseResponse<CommunityConfig>);
}

export function saveCommunityConfig(input: CommunityConfigInput) {
  return fetch("/api/community/config", {
    method: "PUT",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse<CommunityConfig>);
}

export async function clearCommunityConfig() {
  const response = await fetch("/api/community/config", {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Request failed with ${response.status}`);
  }
}
