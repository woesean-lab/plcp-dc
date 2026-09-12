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

export type CommunityStockType = string;

export type CommunityStockSummary = {
  joined: number;
  authorized: number;
  ready: number;
  alreadyMember: number;
  failed: number;
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
  categories?: Record<string, CommunityStockSummary>;
  stockCategories?: CommunityStockCategory[];
};

export type CommunityStockCategory = {
  id: string;
  name: string;
  isPeriodic: boolean;
  iconName: string;
  colorKey: CommunityCategoryColorKey;
  createdAt: string;
  updatedAt: string;
  summary: CommunityStockSummary;
};

export type CommunityCategoryColorKey = "violet" | "cyan" | "emerald" | "amber" | "rose" | "black";

export type CommunityStockCategoryInput = {
  name: string;
  isPeriodic: boolean;
  iconName: string;
  colorKey: CommunityCategoryColorKey;
};

export type CommunityJoinRecord = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: "authorized" | "joined" | "already_member" | "failed";
  details: string | null;
  reservedOrderId?: string | null;
  sortPosition: number;
  authorizedAt: string;
  joinedAt: string | null;
  stockType: CommunityStockType;
};

export type CommunityAdminStatus = CommunityJoinSummary & {
  recent: CommunityJoinRecord[];
};

export type CommunityConfig = {
  configured: boolean;
  stored: boolean;
  clientId: string;
  guildId: string;
  hasClientSecret: boolean;
  hasBotToken: boolean;
  guildName?: string;
};

export type CommunityConfigInput = {
  clientId: string;
  clientSecret: string;
  botToken: string;
  guildId: string;
};

export type CommunityOAuthImportResult = {
  total: number;
  imported: number;
  failed: number;
  skipped: number;
  errors: Array<{ record: string; message: string }>;
  categoryId?: string;
  categoryName?: string;
};

export type CommunityOAuthExportRecord = {
  user_id: string;
  access_token: string;
  authed_timestamp: number;
  expires_in: number;
};

async function parseResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `Request failed with ${response.status}`);
  return payload;
}

export function getCommunityAdminStatus() {
  return fetch("/api/community/status", { cache: "no-store", credentials: "same-origin" }).then(parseResponse<CommunityAdminStatus>);
}

export function syncCommunityAuthorizations() {
  return fetch("/api/community/sync", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin"
  }).then(parseResponse<{ checked: number; inactive?: number; removed: number; errors: number }>);
}

export function removeCommunityAuthorization(discordUserId: string) {
  return fetch(`/api/community/members/${encodeURIComponent(discordUserId)}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin"
  }).then(parseResponse<{ removed: boolean; username: string; revoked: boolean }>);
}

export function removeCommunityAuthorizations(ids: string[]) {
  return fetch("/api/community/members/bulk-delete", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids })
  }).then(parseResponse<{ removed: number; skippedReserved: number }>);
}

export function reorderCommunityAuthorizations(ids: string[], categoryId: CommunityStockType, direction: "top" | "up" | "down" | "bottom") {
  return fetch("/api/community/members/reorder", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, categoryId, direction })
  }).then(parseResponse<{ moved: number; direction: string }>);
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

export function importCommunityOAuthStock(records: unknown[], categoryId: CommunityStockType) {
  return fetch("/api/community/import-oauth-stock", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ records, categoryId })
  }).then(parseResponse<CommunityOAuthImportResult>);
}

export function exportCommunityOAuthStock(categoryId: CommunityStockType) {
  return fetch(`/api/community/export-oauth-stock?categoryId=${encodeURIComponent(categoryId)}`, {
    cache: "no-store",
    credentials: "same-origin"
  }).then(parseResponse<CommunityOAuthExportRecord[]>);
}

export function createCommunityStockCategory(input: CommunityStockCategoryInput) {
  return fetch("/api/community/categories", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse<unknown>);
}

export function updateCommunityStockCategory(categoryId: string, input: CommunityStockCategoryInput) {
  return fetch(`/api/community/categories/${encodeURIComponent(categoryId)}`, {
    method: "PATCH",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse<unknown>);
}

export async function deleteCommunityStockCategory(categoryId: string) {
  const response = await fetch(`/api/community/categories/${encodeURIComponent(categoryId)}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin"
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Request failed with ${response.status}`);
  }
}
