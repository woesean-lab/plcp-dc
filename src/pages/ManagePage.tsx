import { type FormEvent, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAdminPassword, isAdminAuthenticated, setAdminAuthenticated } from '../lib/auth'
import { initialOrders } from '../data/orders'
import type { OrderRecord, ServiceType } from '../types'

type PanelTab = 'create' | 'status' | 'orders'

const serviceOptions: ServiceType[] = [
  'OAUTH-OFFLINE',
  'OAUTH-ONLINE',
  'OAUTH-PREMIUM',
  'OAUTH-NFT',
]

export function ManagePage() {
  const [authenticated, setAuthenticatedState] = useState(isAdminAuthenticated)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<PanelTab>('create')
  const [orders, setOrders] = useState<OrderRecord[]>(initialOrders)
  const [lookupId, setLookupId] = useState(initialOrders[0]?.uniqid ?? '')
  const [newOrder, setNewOrder] = useState({
    service: 'OAUTH-ONLINE' as ServiceType,
    id: '',
    amount: 100,
    delay: 1,
    billingCycle: 1,
  })

  const activeOrder = useMemo(
    () => orders.find((order) => order.uniqid === lookupId) ?? null,
    [lookupId, orders],
  )

  const handleLogin = (event: FormEvent) => {
    event.preventDefault()

    if (password === getAdminPassword()) {
      setAdminAuthenticated(true)
      setAuthenticatedState(true)
      setError('')
      return
    }

    setError('Şifre hatalı.')
  }

  const handleCreateOrder = (event: FormEvent) => {
    event.preventDefault()

    const createdOrder: OrderRecord = {
      uniqid: `TOK-${Math.random().toString(36).slice(2, 7).toUpperCase()}-${Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()}`,
      service: newOrder.service,
      serverId: newOrder.id,
      serverName: 'New server',
      amount: newOrder.amount,
      added: 0,
      delay: newOrder.delay,
      status: 'NEW',
      details: 'Order prepared locally. API hook will be connected next.',
      cost: Number((newOrder.amount * 0.025).toFixed(2)),
      botInvite: 'https://discord.com/oauth2/authorize',
    }

    setOrders((current) => [createdOrder, ...current])
    setLookupId(createdOrder.uniqid)
    setActiveTab('status')
  }

  const updateDelay = (uniqid: string, delay: number) => {
    setOrders((current) =>
      current.map((order) =>
        order.uniqid === uniqid ? { ...order, delay } : order,
      ),
    )
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/30 backdrop-blur-xl"
        >
          <p className="text-xs uppercase tracking-[0.32em] text-amber-300/80">
            /manage
          </p>
          <h1 className="mt-3 text-3xl font-semibold text-white">Admin giriş</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Yönetim paneline erişmek için sadece şifre yeterli.
          </p>

          <label className="mt-6 block text-sm text-slate-300">
            Şifre
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-amber-300/40"
              placeholder="Admin şifresi"
            />
          </label>

          {error ? (
            <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-6 w-full rounded-2xl bg-amber-300 px-4 py-3 font-medium text-slate-950 transition hover:bg-amber-200"
          >
            Paneli aç
          </button>

          <p className="mt-4 text-xs leading-6 text-slate-500">
            Varsayılan şifre `VITE_ADMIN_PASSWORD` ile belirlenir.
          </p>
        </form>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#08101f_0%,_#0f172a_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-6 sm:px-10 lg:px-12">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-amber-300/80">
              Admin panel
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Manage</h1>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`rounded-full px-4 py-2 text-sm transition ${
                activeTab === 'create'
                  ? 'bg-amber-300 text-slate-950'
                  : 'border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
              }`}
            >
              Create order
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('status')}
              className={`rounded-full px-4 py-2 text-sm transition ${
                activeTab === 'status'
                  ? 'bg-amber-300 text-slate-950'
                  : 'border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
              }`}
            >
              Order status
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('orders')}
              className={`rounded-full px-4 py-2 text-sm transition ${
                activeTab === 'orders'
                  ? 'bg-amber-300 text-slate-950'
                  : 'border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10'
              }`}
            >
              Existing orders
            </button>
            <Link
              to="/"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 transition hover:bg-white/10"
            >
              Home
            </Link>
          </div>
        </header>

        <section className="grid gap-6 py-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">Dashboard</p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">
                    {activeTab === 'create'
                      ? 'Sipariş oluştur'
                      : activeTab === 'status'
                        ? 'Sipariş durumu'
                        : 'Mevcut siparişler'}
                  </h2>
                </div>
                <p className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-emerald-200">
                  live scaffold
                </p>
              </div>

              {activeTab === 'create' ? (
                <form className="mt-6 grid gap-4" onSubmit={handleCreateOrder}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block text-sm text-slate-300">
                      Service
                      <select
                        value={newOrder.service}
                        onChange={(event) =>
                          setNewOrder((current) => ({
                            ...current,
                            service: event.target.value as ServiceType,
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
                      >
                        {serviceOptions.map((service) => (
                          <option key={service} value={service}>
                            {service}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm text-slate-300">
                      Discord Server ID
                      <input
                        value={newOrder.id}
                        onChange={(event) =>
                          setNewOrder((current) => ({
                            ...current,
                            id: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
                        placeholder="000000000000000000"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <label className="block text-sm text-slate-300">
                      Amount
                      <input
                        type="number"
                        min={1}
                        value={newOrder.amount}
                        onChange={(event) =>
                          setNewOrder((current) => ({
                            ...current,
                            amount: Number(event.target.value),
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
                      />
                    </label>

                    <label className="block text-sm text-slate-300">
                      Delay
                      <input
                        type="number"
                        min={1}
                        max={1200}
                        value={newOrder.delay}
                        onChange={(event) =>
                          setNewOrder((current) => ({
                            ...current,
                            delay: Number(event.target.value),
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
                      />
                    </label>

                    <label className="block text-sm text-slate-300">
                      Billing cycle
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={newOrder.billingCycle}
                        onChange={(event) =>
                          setNewOrder((current) => ({
                            ...current,
                            billingCycle: Number(event.target.value),
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
                      />
                    </label>
                  </div>

                  <button
                    type="submit"
                    className="rounded-2xl bg-amber-300 px-4 py-3 font-medium text-slate-950 transition hover:bg-amber-200"
                  >
                    Create order draft
                  </button>
                </form>
              ) : null}

              {activeTab === 'status' ? (
                <div className="mt-6 space-y-4">
                  <label className="block text-sm text-slate-300">
                    Order ID
                    <input
                      value={lookupId}
                      onChange={(event) => setLookupId(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
                      placeholder="TOK-..."
                    />
                  </label>

                  {activeOrder ? (
                    <article className="rounded-3xl border border-white/10 bg-slate-950/50 p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-slate-400">Current order</p>
                          <h3 className="mt-1 text-xl font-semibold text-white">
                            {activeOrder.uniqid}
                          </h3>
                        </div>
                        <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-200">
                          {activeOrder.status}
                        </span>
                      </div>

                      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                        <div>
                          <dt className="text-sm text-slate-400">Server</dt>
                          <dd className="mt-1 text-slate-100">
                            {activeOrder.serverName}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-sm text-slate-400">Delay</dt>
                          <dd className="mt-1 text-slate-100">
                            {activeOrder.delay} sec
                          </dd>
                        </div>
                        <div>
                          <dt className="text-sm text-slate-400">Added</dt>
                          <dd className="mt-1 text-slate-100">
                            {activeOrder.added} / {activeOrder.amount}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-sm text-slate-400">Details</dt>
                          <dd className="mt-1 text-slate-100">
                            {activeOrder.details}
                          </dd>
                        </div>
                      </dl>
                    </article>
                  ) : (
                    <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                      Sipariş bulunamadı.
                    </p>
                  )}
                </div>
              ) : null}

              {activeTab === 'orders' ? (
                <div className="mt-6 space-y-4">
                  {orders.map((order) => (
                    <article
                      key={order.uniqid}
                      className="rounded-3xl border border-white/10 bg-slate-950/50 p-5"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm text-slate-400">
                            {order.serverName}
                          </p>
                          <h3 className="mt-1 text-lg font-semibold text-white">
                            {order.uniqid}
                          </h3>
                          <p className="mt-2 text-sm text-slate-300">
                            {order.service} · {order.amount} items · {order.cost} USD
                          </p>
                        </div>

                        <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">
                          {order.status}
                        </span>
                      </div>

                      <div className="mt-5 flex flex-wrap items-end gap-4">
                        <label className="block text-sm text-slate-300">
                          Delay update
                          <input
                            type="number"
                            min={1}
                            max={1200}
                            value={order.delay}
                            onChange={(event) =>
                              updateDelay(order.uniqid, Number(event.target.value))
                            }
                            className="mt-2 w-40 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
                          />
                        </label>

                        <Link
                          to={`/${order.uniqid}`}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 transition hover:bg-white/10"
                        >
                          Open public order page
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <aside className="space-y-6">
            <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <p className="text-sm text-slate-400">Status</p>
              <h3 className="mt-1 text-2xl font-semibold text-white">
                Manage scaffold ready
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Bu alan sonra gerçek API endpoint’lerine bağlanacak. Şu an panel
                akışı, route yapısı ve delay düzenleme yüzeyi hazır.
              </p>
            </article>

            <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
              <p className="text-sm text-slate-400">Planned API hooks</p>
              <ul className="mt-4 space-y-3 text-sm text-slate-200">
                <li>Balance retrieval</li>
                <li>Create order</li>
                <li>Order status lookup</li>
                <li>Delay update hook</li>
              </ul>
            </article>
          </aside>
        </section>
      </div>
    </main>
  )
}
