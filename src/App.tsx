import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import ManagePage from "./pages/ManagePage";

function Shell() {
  const [booting, setBooting] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const search = new URLSearchParams(location.search);
  const tab = search.get("tab") ?? "create";
  const isOrders = location.pathname.startsWith("/orders");
  const isAdmin = location.pathname.startsWith("/admin") || location.pathname === "/";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBooting(false);
    }, 700);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen text-slate-100">
      {booting ? (
        <div className="app-overlay">
          <div className="app-preloader">
            <div className="app-spinner" />
            <p className="app-kicker">Loading</p>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="app-header px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex items-center gap-3 text-[15px] font-semibold tracking-tight text-slate-50">
              <span className="h-6 w-1 rounded-full bg-gradient-to-b from-slate-200 to-sky-400" />
              Pulcip Members
            </div>

            <nav className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className={`h-10 rounded-[3px] border-0 px-4 text-[14px] font-semibold shadow-none ${
                  isAdmin && tab === "create"
                    ? "bg-[#2b9fff33] text-white hover:bg-[#2b9fff44]"
                    : "bg-[#ffffff0d] text-slate-200 hover:bg-[#ffffff14] hover:text-slate-100"
                }`}
                onClick={() => navigate("/admin?tab=create")}
              >
                Create Order
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={`h-10 rounded-[3px] border-0 px-4 text-[14px] font-semibold shadow-none ${
                  isAdmin && tab === "manage"
                    ? "bg-[#2b9fff33] text-white hover:bg-[#2b9fff44]"
                    : "bg-[#ffffff0d] text-slate-200 hover:bg-[#ffffff14] hover:text-slate-100"
                }`}
                onClick={() => navigate("/admin?tab=manage")}
              >
                Manage Orders
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={`h-10 rounded-[3px] border-0 px-4 text-[14px] font-semibold shadow-none ${
                  isOrders
                    ? "bg-[#2b9fff33] text-white hover:bg-[#2b9fff44]"
                    : "bg-[#ffffff0d] text-slate-200 hover:bg-[#ffffff14] hover:text-slate-100"
                }`}
                onClick={() => navigate("/orders")}
              >
                Orders
              </Button>
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
