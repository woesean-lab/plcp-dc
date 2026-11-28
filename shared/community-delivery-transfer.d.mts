export const COMMUNITY_DELIVERY_TRANSFER_STATUSES: readonly string[];
export const COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES: readonly string[];
export function getCommunityDeliveryTransfer(order: unknown, now?: number, allowedStatuses?: readonly string[]): { count: number; statusAllowed: boolean; allowed: boolean; reason: string };
