import { Link } from 'react-router-dom'

export function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.16),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.16),_transparent_26%),linear-gradient(180deg,_#08101f_0%,_#0f172a_100%)] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-amber-300/80">
              PLCP DC
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Bootstrap started
            </h1>
          </div>

          <Link
            to="/manage"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100 transition hover:bg-white/10"
          >
            Admin panel
          </Link>
        </header>

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.2fr_0.8fr] lg:gap-12">
          <div className="space-y-8">
            <div className="max-w-3xl space-y-5">
              <p className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 backdrop-blur">
                React + Vite + Tailwind başlangıç paneli
              </p>
              <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                Yönetim, sipariş ve dış erişim akışı için temel hazır.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                `/manage` ile admin giriş yapılır. Buradan sipariş oluşturma,
                sipariş durumu takibi ve mevcut sipariş yönetimi yapılır.
                Her sipariş ayrıca `/:orderId` rotasıyla dışarıdan erişilebilir.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {['Admin login', 'Create order', 'Order status', 'Order detail'].map(
                (item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200"
                  >
                    {item}
                  </span>
                ),
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                <p className="text-sm text-slate-400">Route</p>
                <p className="mt-2 text-lg font-medium text-white">/manage</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                <p className="text-sm text-slate-400">Public order</p>
                <p className="mt-2 text-lg font-medium text-white">/order-id</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                <p className="text-sm text-slate-400">Deploy</p>
                <p className="mt-2 text-lg font-medium text-white">Easypanel ready</p>
              </article>
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-sm text-slate-400">Current scope</p>
                <p className="mt-1 text-lg font-medium text-white">
                  Admin-first foundation
                </p>
              </div>
              <div className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.8)]" />
            </div>

            <ul className="mt-5 space-y-3">
              {[
                'Manage sayfası şifre ile açılacak.',
                'Sipariş oluşturma ekranı ayrı bölüm olacak.',
                'Order status ve order yönetimi aynı panelde yer alacak.',
                'Sipariş detayında delay alanı düzenlenebilir olacak.',
              ].map((item) => (
                <li
                  key={item}
                  className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-slate-200"
                >
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </aside>
        </section>
      </div>
    </main>
  )
}
