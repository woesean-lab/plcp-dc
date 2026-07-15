const stack = [
  'React 19',
  'Vite',
  'Tailwind CSS 4',
  'TypeScript',
]

const checklist = [
  'Temiz React + Vite başlangıcı kuruldu.',
  'Tailwind entegrasyonu aktif edildi.',
  'GitHub push ve Easypanel deploy için temel iskelet hazırlandı.',
]

function App() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(244,114,182,0.16),_transparent_28%),linear-gradient(180deg,_#0b1020_0%,_#111827_100%)] text-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:32px_32px] opacity-30" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-12">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-amber-300/80">
              Project bootstrap
            </p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              PLCP DC
            </h1>
          </div>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
            Ready for push
          </span>
        </header>

        <section className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-12">
          <div className="space-y-8">
            <div className="max-w-3xl space-y-5">
              <p className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 backdrop-blur">
                React + Vite + Tailwind başlangıç iskeleti
              </p>
              <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-6xl">
                Senaryo öncesi temiz temel hazır.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Bu aşamada sadece altyapı kuruldu. Sonraki adımda iş senaryosunu,
                sayfa akışını ve içerik katmanını bunun üzerine işleyeceğiz.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {stack.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]"
                >
                  {item}
                </span>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                <p className="text-sm text-slate-400">Durum</p>
                <p className="mt-2 text-lg font-medium text-white">
                  Hazırlık tamam
                </p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                <p className="text-sm text-slate-400">Dağıtım</p>
                <p className="mt-2 text-lg font-medium text-white">
                  GitHub + Easypanel
                </p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
                <p className="text-sm text-slate-400">Sonraki adım</p>
                <p className="mt-2 text-lg font-medium text-white">
                  Senaryo yazımı
                </p>
              </article>
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-sm text-slate-400">Boot checklist</p>
                <p className="mt-1 text-lg font-medium text-white">Hazırlandı</p>
              </div>
              <div className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(74,222,128,0.8)]" />
            </div>

            <ul className="mt-5 space-y-3">
              {checklist.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-slate-200"
                >
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-300" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-2xl border border-dashed border-amber-300/30 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100">
              Senaryo kararı verilmeden önce bu proje, kurumsal deploy
              standardına uygun şekilde temiz tutuldu.
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}

export default App
