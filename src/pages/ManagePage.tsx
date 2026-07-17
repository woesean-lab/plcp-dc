import { Link } from "react-router-dom";

const card = "border border-slate-700/70 bg-slate-900/70 shadow-2xl shadow-slate-950/30";
const labelClass = "text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500";
const buttonClass =
  "inline-flex items-center justify-center rounded-[3px] border px-4 py-2.5 text-sm font-medium transition border-slate-700 bg-slate-950/60 text-slate-200 hover:border-amber-300/40 hover:bg-slate-800";

export default function ManagePage() {
  return (
    <section className={`${card} p-5`}>
      <p className={labelClass}>Management lane</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">Shortcuts</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Short entry point. Main actions live in the header.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="border border-slate-700 bg-slate-950/60 p-4">
          <p className={labelClass}>Admin</p>
          <p className="mt-2 text-sm text-slate-300">Orders + settings</p>
        </div>
        <div className="border border-slate-700 bg-slate-950/60 p-4">
          <p className={labelClass}>Orders</p>
          <p className="mt-2 text-sm text-slate-300">/orders</p>
        </div>
        <div className="border border-slate-700 bg-slate-950/60 p-4">
          <p className={labelClass}>Mode</p>
          <p className="mt-2 text-sm text-slate-300">Local-first</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link className={buttonClass} to="/admin?tab=create">
          Admin
        </Link>
        <Link className={buttonClass} to="/orders">
          Orders
        </Link>
      </div>
    </section>
  );
}
