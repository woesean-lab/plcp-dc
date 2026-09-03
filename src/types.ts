export type MemberServiceType = "OAUTH-OFFLINE" | "OAUTH-ONLINE" | "OAUTH-PREMIUM" | "OAUTH-NFT";
export type CommunityServiceType = "COMMUNITY-OFFLINE";
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
}

export interface CreateOrderResponse {
  uniqid: string;
  bot_invite?: string;
  cost?: number;
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
  createdAt?: number;
  created_at?: number;
  expiredAt?: number;
  expired_at?: number;
  type?: string;
  serverId?: string;
  serverName?: string;
  serverInvite?: string;
  serverMemberCount?: number;
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
  boostMessage?: string;
  replacementFor?: string;
}
