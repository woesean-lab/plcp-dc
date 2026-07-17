import { Link } from "react-router-dom";
import { GridIcon, SearchIcon, SettingsIcon, SparkIcon } from "../components/Icons";

const card = "border border-slate-700/70 bg-slate-900/70 shadow-2xl shadow-slate-950/30";
const labelClass = "text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500";
const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-[3px] border px-4 py-2.5 text-sm font-medium transition border-slate-700 bg-slate-950/60 text-slate-200 hover:border-amber-300/40 hover:bg-slate-800";

export default function ManagePage() {
  return (
    <section className={`${card} relative overflow-hidden p-5`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.12),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.08),transparent_22%)]" />
      <p className="relative flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
        <SparkIcon className="h-3.5 w-3.5 text-amber-300" />
        Management lane
      </p>
      <h2 className="relative mt-2 text-2xl font-semibold tracking-tight text-slate-50">Shortcuts</h2>
      <p className="relative mt-2 max-w-2xl text-sm leading-6 text-slate-400">Short entry point. Main actions live in the header.</p>

      <div className="relative mt-5 grid gap-3 sm:grid-cols-3">
        <div className="border border-slate-700 bg-slate-950/60 p-4">
          <p className={labelClass}>Admin</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
            <GridIcon className="h-4 w-4 text-amber-300" />
            Orders + settings
          </p>
        </div>
        <div className="border border-slate-700 bg-slate-950/60 p-4">
          <p className={labelClass}>Orders</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
            <SearchIcon className="h-4 w-4 text-amber-300" />
            /orders
          </p>
        </div>
        <div className="border border-slate-700 bg-slate-950/60 p-4">
          <p className={labelClass}>Mode</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
            <SettingsIcon className="h-4 w-4 text-amber-300" />
            Local-first
          </p>
        </div>
      </div>

      <div className="relative mt-5 flex flex-wrap gap-2">
        <Link className={buttonClass} to="/admin?tab=create">
          <GridIcon className="h-4 w-4" />
          Admin
        </Link>
        <Link className={buttonClass} to="/orders">
          <SearchIcon className="h-4 w-4" />
          Orders
        </Link>
      </div>
    </section>
  );
}
