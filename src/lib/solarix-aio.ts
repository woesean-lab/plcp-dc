export type SolarixConfig = { configured: boolean; slug: string; secretSuffix: string };
export type SolarixInput = { invite: string; amount: number; duration: "1m" | "3m" };
export type SolarixStock = { checkedAt: string; tiers: { duration: "1m" | "3m"; label: string; tokens: number; boosts: number }[] };
export type SolarixReceipt = {
  id: string; input: SolarixInput; status: "running" | "completed" | "failed" | "uncertain";
  startedAt: string; finishedAt?: string; message: string;
  result?: { orderId: string; guildId: string; guildName: string; boosted: number; failed: number; countUnit?: "boosts"; successfulAccounts?: number; failedAccounts?: number };
};
export class SolarixRequestError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}
async function request<T>(path: string, init: RequestInit = {}) {
  let response: Response;
  try { response = await fetch(`/api/solarix-aio${path}`, { cache: "no-store", ...init, signal: init.signal || AbortSignal.timeout(20000) }); }
  catch { throw new SolarixRequestError("The server could not be reached. Check the saved result before submitting again."); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new SolarixRequestError(payload?.message || "SolarixAIO is temporarily unavailable.", response.status);
  if (!payload && response.status !== 204) throw new SolarixRequestError("The server returned an unreadable SolarixAIO response.");
  return payload as T;
}
export const getSolarixConfig = (signal?: AbortSignal) => request<SolarixConfig>("/config", { signal });
export const saveSolarixConfig = (slug: string, secret: string) => request<SolarixConfig>("/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, secret }) });
export const removeSolarixConfig = () => request<void>("/config", { method: "DELETE" });
export const getSolarixStock = (signal?: AbortSignal) => request<SolarixStock>("/stock", { signal });
export const submitSolarixDelivery = (input: SolarixInput, requestId: string) => request<SolarixReceipt>("/deliveries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, requestId }) });
export const getSolarixDelivery = (id: string, signal?: AbortSignal) => request<SolarixReceipt>(`/deliveries/${encodeURIComponent(id)}`, { signal });

export const SOLARIX_PREVIEW_STOCK: SolarixStock = { checkedAt: "2026-11-26T09:00:00Z", tiers: [{ duration: "1m", label: "1 Month", tokens: 60, boosts: 120 }, { duration: "3m", label: "3 Months", tokens: 20, boosts: 40 }] };
