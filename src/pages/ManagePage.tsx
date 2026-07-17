import { Link } from "react-router-dom";
import { ArrowRight, LayoutDashboard, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const card = "app-panel";
const labelClass = "app-kicker";

export default function ManagePage() {
  return (
    <section className={`${card} hero-panel p-5 sm:p-7 lg:p-8`}>
      <div className="flex items-center gap-3">
        <span className="stat-icon" aria-hidden="true">
          <LayoutDashboard className="h-4 w-4" />
        </span>
        <p className={labelClass}>Management lane</p>
      </div>

      <h1 className="app-title mt-5 text-[clamp(2.25rem,5vw,3.75rem)] font-semibold leading-[1] tracking-[-0.05em]">
        Choose your workspace.
      </h1>
      <p className="app-copy mt-4 max-w-2xl text-[15px] leading-7">
        Jump into administration or open the public order tracker from this private control surface.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <div className="app-panel-soft p-5">
          <LayoutDashboard className="h-5 w-5 text-[#d8bd86]" aria-hidden="true" />
          <p className={`${labelClass} mt-5`}>Admin</p>
          <p className="app-copy mt-2 text-sm">Orders and settings</p>
        </div>
        <div className="app-panel-soft p-5">
          <Search className="h-5 w-5 text-[#d8bd86]" aria-hidden="true" />
          <p className={`${labelClass} mt-5`}>Orders</p>
          <p className="app-copy mt-2 text-sm">Public lookup</p>
        </div>
        <div className="app-panel-soft p-5">
          <ShieldCheck className="h-5 w-5 text-emerald-300" aria-hidden="true" />
          <p className={`${labelClass} mt-5`}>Mode</p>
          <p className="app-copy mt-2 text-sm">Local-first security</p>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/admin?tab=create">
            Open admin
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/orders">
            Order lookup
            <Search className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
