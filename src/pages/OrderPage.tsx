import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { initialOrders } from '../data/orders'
import { getOrderStatus, type OrderStatusResponse } from '../lib/tokenu'

export function OrderPage() {
  const { orderId } = useParams()
  const [delay, setDelay] = useState(() => {
    const found = initialOrders.find((order) => order.uniqid === orderId)
    return found?.delay ?? 1
  })
  const [status, setStatus] = useState<OrderStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const order = useMemo(
    () => initialOrders.find((item) => item.uniqid === orderId) ?? null,
    [orderId],
  )

  useEffect(() => {
    let active = true

    async function load() {
      if (!orderId) {
        return
      }

      setLoading(true)
      setError('')

      try {
        const result = await getOrderStatus(orderId)
        if (active) {
          setStatus(result)
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Failed to load order.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [orderId])

  const handleSave = (event: FormEvent) => {
    event.preventDefault()
    // Delay update endpoint will be connected when the API exposes one.
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#08101f_0%,_#0f172a_100%)] text-slate-100">
      <div className="mx-auto min-h-screen w-full max-w-5xl px-6 py-8 sm:px-10 lg:px-12">
        <div className="mb-8 flex items-center justify-between border-b border-white/10 pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-amber-300/80">
              Public order view
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white">
              {orderId ?? 'Order'}
            </h1>
          </div>

          <Link
            to="/manage"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 transition hover:bg-white/10"
          >
            Manage
          </Link>
        </div>

        {order ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <section className="space-y-6">
              <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Order summary</p>
                    <h2 className="mt-1 text-2xl font-semibold text-white">
                      {order.serverName}
                    </h2>
                  </div>
                  <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-200">
                    {order.status}
                  </span>
                </div>

                <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-sm text-slate-400">Service</dt>
                    <dd className="mt-1 text-slate-100">{order.service}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-400">Server ID</dt>
                    <dd className="mt-1 text-slate-100">{order.serverId}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-400">Amount</dt>
                    <dd className="mt-1 text-slate-100">
                      {order.added} / {order.amount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-slate-400">Current delay</dt>
                    <dd className="mt-1 text-slate-100">{delay} sec</dd>
                  </div>
                </dl>
              </article>

              <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <p className="text-sm text-slate-400">Live API status</p>
                {loading ? (
                  <p className="mt-4 text-sm text-slate-300">Loading...</p>
                ) : error ? (
                  <p className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
                    {error}
                  </p>
                ) : status ? (
                  <pre className="mt-4 overflow-auto rounded-2xl bg-slate-950/80 p-4 text-xs leading-6 text-slate-200">
{JSON.stringify(status, null, 2)}
                  </pre>
                ) : (
                  <p className="mt-4 text-sm text-slate-300">No status loaded.</p>
                )}
              </article>
            </section>

            <aside className="space-y-6">
              <form
                onSubmit={handleSave}
                className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl"
              >
                <p className="text-sm text-slate-400">Manage delay</p>
                <h3 className="mt-1 text-2xl font-semibold text-white">
                  Editable delay
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  This control is ready. It will be wired to the real update endpoint
                  once it is confirmed by the API provider.
                </p>

                <label className="mt-6 block text-sm text-slate-300">
                  Delay (sec)
                  <input
                    type="number"
                    min={1}
                    max={1200}
                    value={delay}
                    onChange={(event) => setDelay(Number(event.target.value))}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none"
                  />
                </label>

                <button
                  type="submit"
                  className="mt-6 w-full rounded-2xl bg-amber-300 px-4 py-3 font-medium text-slate-950 transition hover:bg-amber-200"
                >
                  Save delay
                </button>
              </form>

              <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <p className="text-sm text-slate-400">External access</p>
                <p className="mt-2 text-lg font-medium text-white">
                  Public page: /{order.uniqid}
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  This route uses the live API for status, while delay editing is
                  still waiting for the update endpoint.
                </p>
              </article>
            </aside>
          </div>
        ) : (
          <article className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur">
            <h2 className="text-2xl font-semibold text-white">Order not found</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              There is no local record for this order ID yet.
            </p>
          </article>
        )}
      </div>
    </main>
  )
}
