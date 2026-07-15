import type { OrderRecord } from '../types'

export const initialOrders: OrderRecord[] = [
  {
    uniqid: 'TOK-8F3A1-ADMIN',
    service: 'OAUTH-ONLINE',
    serverId: '125478963214587963',
    serverName: 'PLCP Community',
    amount: 1000,
    added: 864,
    delay: 4,
    status: 'PROCESS',
    details: 'Members are being processed in batches.',
    cost: 24.99,
    botInvite: 'https://discord.com/oauth2/authorize?client_id=demo',
  },
  {
    uniqid: 'TOK-2B7C4-CORE',
    service: 'OAUTH-OFFLINE',
    serverId: '774411223300998877',
    serverName: 'Core Team',
    amount: 500,
    added: 500,
    delay: 2,
    status: 'COMPLETED',
    details: 'Order completed successfully.',
    cost: 12.5,
    botInvite: 'https://discord.com/oauth2/authorize?client_id=demo',
  },
]
