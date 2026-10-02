import type { OrderStatusResponse } from "../types";

type TokenResult = Record<string, unknown>;

function isTokenResult(value: unknown): value is TokenResult {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getTokenIdentity(result: TokenResult) {
  const usedTokenId = typeof result.usedTokenId === "string" ? result.usedTokenId.trim() : "";
  const token = typeof result.token === "string" ? result.token.trim() : "";
  return usedTokenId || token;
}

function getTokenProgress(result: TokenResult) {
  const status = [result.status, result.joinStatus, result.boostStatus]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (result.boosted === true || status.includes("boosted")) return 4;
  if (["failed", "error", "skipped"].some((value) => status.includes(value))) return 3;
  if (result.success === true || status.includes("joined")) return 2;
  if (["joining", "process", "verifying"].some((value) => status.includes(value))) return 1;
  return 0;
}

function isProviderBlockedResult(result: TokenResult) {
  const message = [result.boostMessage, result.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return result.providerBlocked === true
    || message.includes("html challenge/block page")
    || message.includes("upstream verification");
}

function mergeTokenResult(current: unknown, incoming: unknown) {
  if (!isTokenResult(incoming)) return current;
  if (!isTokenResult(current)) return incoming;

  const currentIdentity = getTokenIdentity(current);
  const incomingIdentity = getTokenIdentity(incoming);
  if (currentIdentity && incomingIdentity && currentIdentity !== incomingIdentity) {
    return incoming;
  }

  if (isProviderBlockedResult(incoming)) {
    return incoming;
  }

  return getTokenProgress(current) > getTokenProgress(incoming)
    ? { ...incoming, ...current }
    : { ...current, ...incoming };
}

const communityCheckFields = [
  "authorizationStatus",
  "authorizationDetails",
  "authorizationCheckedAt",
  "membershipStatus",
  "membershipDetails",
  "onlinerLive",
  "onlinerConnectionState",
  "onlinerDetails",
  "onlinerCheckedAt"
] as const;

function getCommunityCheckTimestamp(result: TokenResult) {
  return Math.max(
    Date.parse(typeof result.authorizationCheckedAt === "string" ? result.authorizationCheckedAt : "") || 0,
    Date.parse(typeof result.onlinerCheckedAt === "string" ? result.onlinerCheckedAt : "") || 0
  );
}

function mergeCommunityResult(current: unknown, incoming: unknown) {
  if (!isTokenResult(incoming)) return current;
  if (!isTokenResult(current)) return incoming;
  const sameMember = String(current.discordUserId ?? current.username ?? "") === String(incoming.discordUserId ?? incoming.username ?? "");
  const sameState = String(current.state ?? "") === String(incoming.state ?? "");
  if (!sameMember || !sameState || getCommunityCheckTimestamp(current) <= getCommunityCheckTimestamp(incoming)) {
    return incoming;
  }
  const merged = { ...incoming };
  for (const field of communityCheckFields) {
    if (field in current) merged[field] = current[field];
  }
  return merged;
}

export function mergeOrderStatus(
  current: OrderStatusResponse | null,
  incoming: OrderStatusResponse
): OrderStatusResponse {
  if (!current) return incoming;

  const currentCommunityResults = Array.isArray(current.communityResults) ? current.communityResults : [];
  const incomingCommunityResults = Array.isArray(incoming.communityResults) ? incoming.communityResults : [];
  const mergedOrder: OrderStatusResponse = { ...current, ...incoming };
  if (currentCommunityResults.length && incomingCommunityResults.length) {
    const resultCount = Math.max(currentCommunityResults.length, incomingCommunityResults.length);
    mergedOrder.communityResults = Array.from({ length: resultCount }, (_, index) =>
      mergeCommunityResult(currentCommunityResults[index], incomingCommunityResults[index])
    ).filter(isTokenResult);
  } else if (currentCommunityResults.length && !incomingCommunityResults.length) {
    mergedOrder.communityResults = currentCommunityResults;
  }
  const incomingAllocations = Array.isArray(incoming.categoryAllocations) ? incoming.categoryAllocations : [];
  const disabledCategoryIds = new Set(incomingAllocations
    .filter((allocation) => allocation.checkReplacementEnabled === false)
    .map((allocation) => allocation.categoryId));
  const allOnlinerChecksDisabled = !incomingAllocations.length && incoming.categoryCheckReplacementEnabled === false;
  if ((disabledCategoryIds.size || allOnlinerChecksDisabled) && Array.isArray(mergedOrder.communityResults)) {
    mergedOrder.communityResults = mergedOrder.communityResults.map((result) => {
      if (!isTokenResult(result)) return result;
      const categoryId = String(result.categoryId ?? incoming.categoryId ?? "");
      if (!allOnlinerChecksDisabled && !disabledCategoryIds.has(categoryId)) return result;
      const next = { ...result };
      delete next.onlinerLive;
      delete next.onlinerConnectionState;
      delete next.onlinerDetails;
      delete next.onlinerCheckedAt;
      return next;
    });
  }

  const currentResults = Array.isArray(current.dcordResults) ? current.dcordResults : [];
  const incomingResults = Array.isArray(incoming.dcordResults) ? incoming.dcordResults : [];
  if (!currentResults.length) return mergedOrder;
  if (!incomingResults.length) {
    return { ...mergedOrder, dcordResults: currentResults };
  }

  const resultCount = Math.max(currentResults.length, incomingResults.length);
  const dcordResults = Array.from({ length: resultCount }, (_, index) =>
    mergeTokenResult(currentResults[index], incomingResults[index])
  ).filter(isTokenResult);

  return { ...mergedOrder, dcordResults };
}
