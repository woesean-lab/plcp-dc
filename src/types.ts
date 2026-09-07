export type MemberServiceType = "OAUTH-OFFLINE" | "OAUTH-ONLINE" | "OAUTH-PREMIUM" | "OAUTH-NFT";
export type CommunityServiceType = "COMMUNITY-OFFLINE" | "COMMUNITY-ONLINE";
export type BoostServiceType = "DCORD-BOOSTS";
export type ServiceType = MemberServiceType | CommunityServiceType | BoostServiceType;
export type OrderProvider = "tokenu" | "community" | "dcord";
export type BoostDuration = 1 | 3;

export type OrderStatus =
  | "NEW"
  | "PROCESS"
  | "COMPLETED"
  | "TERMINATED"
  | "INVALID"
  | "ERROR"
  | string;

export interface CreateOrderPayload {
  service: ServiceType;
  id: string;
  amount: number;
  delay?: number;
  billingCycle?: number;
  duration?: BoostDuration;
  useProxy?: boolean;
  concurrency?: number;
  allowMembershipScreening?: boolean;
  categoryId?: string;
}

export interface CreateOrderResponse {
  uniqid: string;
  bot_invite?: string;
  cost?: number;
  categoryId?: string;
  categoryName?: string;
  categoryIsPeriodic?: boolean;
  durationMonths?: number | null;
  createdAt?: string;
  expiredAt?: string | null;
}

export interface BalanceResponse {
  balance: number;
}

export interface OrderStatusResponse {
  uniqid: string;
  status?: OrderStatus;
  details?: string;
  added?: number;
  amount?: number;
  quantity?: number;
  delay?: string | number;
  createdAt?: string | number;
  created_at?: string | number;
  expiredAt?: string | number | null;
  expired_at?: string | number | null;
  type?: string;
  serverId?: string;
  serverName?: string;
  serverInvite?: string;
  serverMemberCount?: number;
  categoryId?: string;
  categoryName?: string;
  categoryIsPeriodic?: boolean;
  durationMonths?: number | null;
  error?: string;
  canManageDcordTokens?: boolean;
  canManageCommunityMembers?: boolean;
  delayUpdateCooldownSeconds?: number;
  restartCooldownSeconds?: number;
  liveBoostStock?: {
    oneMonth: number;
    threeMonth: number;
  };
  [key: string]: unknown;
}

export interface TrackedOrder {
  uniqid: string;
  provider?: OrderProvider;
  service?: ServiceType;
  serverId?: string;
  serverName?: string;
  serverInvite?: string;
  serverMemberCount?: number;
  amount?: number;
  added?: number;
  delay?: number;
  statusDelay?: number;
  billingCycle?: number;
  duration?: BoostDuration;
  useProxy?: boolean;
  concurrency?: number;
  cost?: number;
  botInvite?: string;
  createdAt: string;
  status?: string;
  details?: string;
  categoryId?: string;
  categoryName?: string;
  categoryIsPeriodic?: boolean;
  durationMonths?: number | null;
  expiredAt?: string | null;
}

export interface BoostStock {
  oneMonth: number;
  threeMonth: number;
}

export interface BoostTokenStockInput {
  oneMonthTokens: string;
  threeMonthTokens: string;
}

export interface BoostTokenStockSnapshot {
  stock: BoostStock;
  oneMonthTokens: string[];
  threeMonthTokens: string[];
  usedTokens: BoostUsedToken[];
}

export interface BoostUsedToken {
  id: string;
  token: string;
  redactedToken?: string;
  duration: BoostDuration;
  orderId?: string;
  serverId?: string;
  serverName?: string;
  usedAt: string;
  resultAt?: string;
  status?: string;
  success?: boolean;
  boosted?: boolean;
  boostCount?: number;
  boostMessage?: string;
  replacementFor?: string;
}
