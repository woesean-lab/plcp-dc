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
      "inline-flex items-center rounded-[4px] border px-4 py-2.5 text-[15px] font-semibold tracking-tight transition",
      active
        ? "border-slate-500/70 bg-[#253148] text-slate-50 shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
        : "border-slate-800 bg-[#0b1020] text-slate-300 hover:border-slate-600 hover:bg-[#101826]"
    ].join(" ");

  return (
    <div className="min-h-screen text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="border border-slate-800/80 bg-[#070b15]/95 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.24)] backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex items-center gap-3 text-[15px] font-semibold tracking-tight text-slate-100">
              <span className="h-6 w-1 rounded-full bg-gradient-to-b from-cyan-300 to-blue-600" />
              Pulcip Members
            </div>

            <nav className="flex flex-wrap items-center gap-2">
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
