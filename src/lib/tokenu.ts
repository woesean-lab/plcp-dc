import type { OrderStatus, ServiceType } from '../types'

const API_PREFIX = '/api/v1/reseller'

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

export interface OrderCreatePayload {
  service: ServiceType
  id: string
  amount: number
  delay?: number
  billingCycle?: number
}

export interface OrderCreateResponse {
  uniqid: string
  bot_invite: string
  cost: number
}

export interface OrderStatusResponse {
  uniqid: string
  status?: OrderStatus | string
  details?: string
  type?: string
  serverId?: string
  serverName?: string
  added?: number
  amount?: number
  delay?: number | string
  createdAt?: number
  expiredAt?: number
}

export interface CheckAvailabilityResponse {
  available: number
  maximum: number
}

export interface BalanceResponse {
  balance: number
}

export async function getBalance() {
  return requestJson<BalanceResponse>('/balance')
}

export async function checkAvailability(service: ServiceType, id: string) {
  const query = new URLSearchParams({ service, id })
  return requestJson<CheckAvailabilityResponse>(`/check?${query.toString()}`)
}

export async function createOrder(payload: OrderCreatePayload) {
  return requestJson<OrderCreateResponse>('/order', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getOrderStatus(uniqid: string) {
  const query = new URLSearchParams({ uniqid })
  return requestJson<OrderStatusResponse>(`/status?${query.toString()}`)
}
