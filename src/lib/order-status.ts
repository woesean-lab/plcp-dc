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
  if (["joining", "process"].some((value) => status.includes(value))) return 1;
  return 0;
}

function mergeTokenResult(current: unknown, incoming: unknown) {
  if (!isTokenResult(incoming)) return current;
  if (!isTokenResult(current)) return incoming;

  const currentIdentity = getTokenIdentity(current);
  const incomingIdentity = getTokenIdentity(incoming);
  if (currentIdentity && incomingIdentity && currentIdentity !== incomingIdentity) {
    return incoming;
  }

  return getTokenProgress(current) > getTokenProgress(incoming)
    ? { ...incoming, ...current }
    : { ...current, ...incoming };
}

export function mergeOrderStatus(
  current: OrderStatusResponse | null,
  incoming: OrderStatusResponse
): OrderStatusResponse {
  if (!current) return incoming;

  const currentResults = Array.isArray(current.dcordResults) ? current.dcordResults : [];
  const incomingResults = Array.isArray(incoming.dcordResults) ? incoming.dcordResults : [];
  if (!currentResults.length) return incoming;
  if (!incomingResults.length) {
    return { ...current, ...incoming, dcordResults: currentResults };
  }

  const resultCount = Math.max(currentResults.length, incomingResults.length);
  const dcordResults = Array.from({ length: resultCount }, (_, index) =>
    mergeTokenResult(currentResults[index], incomingResults[index])
  ).filter(isTokenResult);

  return { ...current, ...incoming, dcordResults };
}
