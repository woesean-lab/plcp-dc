import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import ManagePage from "./pages/ManagePage";

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();

  const search = new URLSearchParams(location.search);
  const tab = search.get("tab") ?? "create";
  const isOrders = location.pathname.startsWith("/orders");
  const isAdmin = location.pathname.startsWith("/admin") || location.pathname === "/";

  const navButton = (active: boolean) =>
    [
      "rounded-[3px] border px-3 py-2 text-sm font-medium tracking-tight transition",
      active
        ? "border-amber-300 bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/15"
        : "border-slate-700 bg-slate-900/60 text-slate-200 hover:border-amber-300/40 hover:bg-slate-800"
    ].join(" ");

  return (
    <div className="min-h-screen text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="border border-slate-700/70 bg-slate-900/70 px-4 py-3 shadow-2xl shadow-slate-950/30 backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500">Tokenu panel</p>
              <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-100">Orders workspace</h1>
            </div>

            <nav className="flex flex-wrap gap-2">
              <button
                type="button"
                className={navButton(isAdmin && tab === "create")}
                onClick={() => navigate("/admin?tab=create")}
              >
                Create Order
              </button>
              <button
                type="button"
                className={navButton(isAdmin && tab === "manage")}
                onClick={() => navigate("/admin?tab=manage")}
              >
                Manage Orders
              </button>
              <button
                type="button"
                className={navButton(isOrders)}
                onClick={() => navigate("/orders")}
              >
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
