// Leaving members is only safe after delivery and replacement have settled.
export function isCommunityDeliverySettled(order) {
  if (!order || !["COMPLETED", "PARTIAL", "ERROR", "TERMINATED", "CANCELLED", "CANCELED"].includes(String(order.status ?? "").trim().toUpperCase())) return false;
  return !Array.isArray(order.communityResults) || !order.communityResults.some((member) =>
    ["queued", "pending", "joining", "replacing", "running", "processing"].includes(String(member?.state ?? "").trim().toLowerCase())
  );
}
