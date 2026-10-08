export type CommunityServiceType = "COMMUNITY-OFFLINE" | "COMMUNITY-ONLINE";
export type BoostServiceType = "DCORD-BOOSTS";
export type ServiceType = CommunityServiceType | BoostServiceType;
export type OrderProvider = "community" | "dcord";
export type BoostDuration = 1 | 3;
export type CommunityJoinMethod = "create_invite" | "experimental_join" | "directly";

export interface CommunityCategoryAllocation {
  categoryId: string;
  categoryName?: string;
  colorKey?: string;
  amount: number;
  added?: number;
  isPeriodic?: boolean;
  checkReplacementEnabled?: boolean;
  reactionUseEnabled?: boolean;
  durationMonths?: number | null;
  expiredAt?: string | null;
}

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
  duration?: BoostDuration;
  useProxy?: boolean;
  concurrency?: number;
  allowMembershipScreening?: boolean;
  categoryId?: string;
  categoryAllocations?: CommunityCategoryAllocation[];
  durationMonths?: number;
  speedProfile?: "safe" | "balanced" | "fast" | "custom";
  joinMethod?: CommunityJoinMethod;
  isEldoradoSale?: boolean;
  reactionLimit?: number;
  humanizerPackageId?: string;
}

export interface CreateOrderResponse {
  uniqid: string;
  bot_invite?: string;
  cost?: number;
  categoryId?: string;
  categoryName?: string;
  categoryAllocations?: CommunityCategoryAllocation[];
  categoryIsPeriodic?: boolean;
  categoryCheckReplacementEnabled?: boolean;
  reactionMessageLink?: string;
  reactionCapacity?: number;
  durationMonths?: number | null;
  joinMethod?: CommunityJoinMethod;
  createdAt?: string;
  expiredAt?: string | null;
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
  categoryAllocations?: CommunityCategoryAllocation[];
  categoryIsPeriodic?: boolean;
  categoryCheckReplacementEnabled?: boolean;
  reactionMessageLink?: string;
  reactionCapacity?: number;
  reactionRequests?: Array<{
    id: string;
    messageLink: string;
    requestedCount: number;
    assignedCount: number;
    emojiCount?: number;
    emojis?: string[];
    createdAt: string;
    autoStopReason?: string;
    autoStoppedAt?: string;
    assignments?: Array<{
      discordUserId: string;
      reactionState?: string;
      reactionEmoji?: string;
      reactionDetails?: string;
      reactionCompletedAt?: string;
    }>;
  }>;
  durationMonths?: number | null;
  error?: string;
  canManageDcordTokens?: boolean;
  dcordRejoinJob?: {
    status: "running" | "completed" | "partial" | "failed" | string;
    total: number;
    completed: number;
    succeeded: number;
    failed: number;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    results?: Array<{
      index: number;
      token: string;
      state: "waiting" | "running" | "success" | "failed" | string;
      joinStatus?: string;
      message?: string;
      dcordTaskId?: string;
    }>;
  };
  canManageCommunityMembers?: boolean;
  delayUpdateCooldownSeconds?: number;
  restartCooldownSeconds?: number;
  speedProfile?: "safe" | "balanced" | "fast" | "custom";
  joinMethod?: CommunityJoinMethod;
  activeDelay?: number | null;
  nextMemberAt?: string | null;
  isEldoradoSale?: boolean;
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
  speedProfile?: "safe" | "balanced" | "fast" | "custom";
  joinMethod?: CommunityJoinMethod;
  activeDelay?: number | null;
  nextMemberAt?: string | null;
  statusDelay?: number;
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
  categoryAllocations?: CommunityCategoryAllocation[];
  categoryIsPeriodic?: boolean;
  durationMonths?: number | null;
  expiredAt?: string | null;
  isEldoradoSale?: boolean;
  reactionMessageLink?: string;
  reactionCapacity?: number;
  reactionRequests?: OrderStatusResponse["reactionRequests"];
}

export interface BoostStock {
  oneMonth: number;
  threeMonth: number;
}

export interface BoostTokenStockInput {
  oneMonthTokens: string;
  threeMonthTokens: string;
  removeTwoFactor?: boolean;
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
