interface AllocationReference {
  allocationId?: unknown;
  categoryId?: unknown;
}
interface AllocationOrder<T extends AllocationReference> {
  categoryId?: unknown;
  stockType?: unknown;
  service?: unknown;
  categoryAllocations?: T[];
}
export function getCommunityResultAllocation<T extends AllocationReference>(order: AllocationOrder<T>, member: AllocationReference): T | undefined;
export function communityResultMatchesAllocation<T extends AllocationReference>(order: AllocationOrder<T>, member: AllocationReference, allocation: T): boolean;
export function getCommunityCategoryName(allocations: Array<{ categoryId: string; categoryName?: string }>, fallback?: string): string | undefined;
