export type ServiceType =
  | 'OAUTH-OFFLINE'
  | 'OAUTH-ONLINE'
  | 'OAUTH-PREMIUM'
  | 'OAUTH-NFT'

export type OrderStatus =
  | 'NEW'
  | 'PROCESS'
  | 'COMPLETED'
  | 'TERMINATED'
  | 'INVALID'
  | 'ERROR'

export interface OrderRecord {
  uniqid: string
  service: ServiceType
  serverId: string
  serverName: string
  amount: number
  added: number
  delay: number
  status: OrderStatus
  details: string
  cost: number
  botInvite: string
}
