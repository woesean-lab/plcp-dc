// A pool can contain several portions of one order with different support dates.
// Category IDs select stock; allocation IDs identify the purchased portion.
export function getCommunityResultAllocation(order, member) {
  const allocations = Array.isArray(order?.categoryAllocations) ? order.categoryAllocations : [];
  if (member?.allocationId) return allocations.find((allocation) => allocation?.allocationId === member.allocationId);
  const categoryId = member?.categoryId || order?.categoryId || order?.stockType || (order?.service === "COMMUNITY-ONLINE" ? "online" : "offline");
  const matches = allocations.filter((allocation) => allocation?.categoryId === categoryId);
  return matches.length === 1 ? matches[0] : undefined;
}

export function communityResultMatchesAllocation(order, member, allocation) {
  return getCommunityResultAllocation(order, member) === allocation;
}

export function getCommunityCategoryName(allocations, fallback) {
  const categories = new Map(allocations.map((allocation) => [allocation.categoryId, allocation.categoryName || allocation.categoryId]));
  return categories.size > 1 ? `${categories.size} categories` : categories.values().next().value || fallback;
}
