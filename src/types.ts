export type ServiceType = "OAUTH-OFFLINE" | "OAUTH-ONLINE" | "OAUTH-PREMIUM" | "OAUTH-NFT";

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
  error?: string;
  delayUpdateCooldownSeconds?: number;
  [key: string]: unknown;
}

export interface TrackedOrder {
  uniqid: string;
  service?: ServiceType;
  serverId?: string;
  serverName?: string;
  amount?: number;
  added?: number;
  delay?: number;
  statusDelay?: number;
  billingCycle?: number;
  cost?: number;
  botInvite?: string;
  createdAt: string;
  status?: string;
  details?: string;
}
