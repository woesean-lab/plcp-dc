export type CommunityGuild = {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
};

export type CommunityJoinSummary = {
  configured: boolean;
  missing?: string[];
  guild?: CommunityGuild;
  goal: number;
  joined: number;
  remaining: number;
  authorized?: number;
  ready?: number;
  alreadyMember?: number;
  failed?: number;
  syncing?: boolean;
};

export type CommunityJoinRecord = {
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

export async function addAuthorizedCommunityMembers() {
  const response = await fetch("/api/community/add-members", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin"
  });
  return parseResponse<{ started: true; count: number }>(response);
}
