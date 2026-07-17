import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import ManagePage from "./pages/ManagePage";
import { GridIcon, SearchIcon, SettingsIcon, ShieldIcon, SparkIcon } from "./components/Icons";

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();

  const search = new URLSearchParams(location.search);
  const tab = search.get("tab") ?? "create";
  const isOrders = location.pathname.startsWith("/orders");
  const isAdmin = location.pathname.startsWith("/admin") || location.pathname === "/";

  const navButton = (active: boolean) =>
    [
      "inline-flex items-center gap-2 rounded-[3px] border px-4 py-2.5 text-sm font-medium tracking-tight transition",
      active
        ? "border-amber-300 bg-gradient-to-r from-amber-300 via-amber-400 to-orange-300 text-slate-950 shadow-lg shadow-amber-500/20"
        : "border-slate-700/80 bg-slate-900/70 text-slate-200 hover:border-amber-300/50 hover:bg-slate-800/90"
    ].join(" ");

  return (
    <div className="min-h-screen text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden border border-slate-700/70 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 px-4 py-4 shadow-[0_24px_80px_rgba(2,6,23,0.42)] backdrop-blur">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.14),transparent_26%)]" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center border border-amber-300/40 bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 shadow-lg shadow-amber-500/20">
                <ShieldIcon className="h-5 w-5" />
              </div>
              <div>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500">
                  <SparkIcon className="h-3.5 w-3.5 text-amber-300" />
                  Tokenu panel
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-50">Orders workspace</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Create, monitor, and inspect orders in one focused control surface.
                </p>
              </div>
            </div>

            <nav className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={navButton(isAdmin && tab === "create")}
                onClick={() => navigate("/admin?tab=create")}
              >
                <GridIcon className="h-4 w-4" />
                Create Order
              </button>
              <button
                type="button"
                className={navButton(isAdmin && tab === "manage")}
                onClick={() => navigate("/admin?tab=manage")}
              >
                <SettingsIcon className="h-4 w-4" />
                Manage Orders
              </button>
              <button
                type="button"
                className={navButton(isOrders)}
                onClick={() => navigate("/orders")}
              >
                <SearchIcon className="h-4 w-4" />
                Orders
              </button>
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Navigate to="/admin?tab=create" replace />} />
            <Route path="/admin" element={<HomePage />} />
            <Route path="/orders" element={<OrderPage />} />
            <Route path="/manage" element={<ManagePage />} />
            <Route path="*" element={<Navigate to="/admin?tab=create" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default Shell;
