import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ListChecks, Plus, Search, ShieldCheck } from "lucide-react";
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
    }, 480);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="app-shell min-h-screen text-slate-100">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />

      {booting ? (
        <div className="app-overlay" role="status" aria-live="polite">
          <div className="app-preloader">
            <span className="brand-mark brand-mark-loader" aria-hidden="true">
              <span className="brand-letter">P</span>
            </span>
            <div>
              <p className="app-kicker">Pulcip Members</p>
              <p className="mt-2 text-sm text-slate-300">Preparing your workspace</p>
            </div>
            <div className="app-progress" aria-hidden="true">
              <span />
            </div>
          </div>
        </div>
      ) : null}

      <div className="app-frame mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-5 px-3 py-3 sm:px-5 sm:py-5 lg:px-8">
        <header className="app-header sticky top-3 z-30">
          <div className="app-header-inner">
            <button className="app-brand" type="button" onClick={() => navigate("/admin?tab=create")} aria-label="Pulcip Members home">
              <span className="brand-mark" aria-hidden="true">
                <span className="brand-letter">P</span>
              </span>
              <span className="min-w-0 text-left">
                <span className="brand-eyebrow">Pulcip</span>
                <span className="brand-title">Members Console</span>
              </span>
            </button>

            <nav className="app-nav" aria-label="Primary navigation">
              <button
                type="button"
                className={`app-nav-button ${isAdmin && tab === "create" ? "is-active" : ""}`}
                aria-current={isAdmin && tab === "create" ? "page" : undefined}
                onClick={() => navigate("/admin?tab=create")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Create</span>
              </button>
              <button
                type="button"
                className={`app-nav-button ${isAdmin && tab === "manage" ? "is-active" : ""}`}
                aria-current={isAdmin && tab === "manage" ? "page" : undefined}
                onClick={() => navigate("/admin?tab=manage")}
              >
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                <span>Manage</span>
              </button>
              <button
                type="button"
                className={`app-nav-button ${isOrders ? "is-active" : ""}`}
                aria-current={isOrders ? "page" : undefined}
                onClick={() => navigate("/orders")}
              >
                <Search className="h-4 w-4" aria-hidden="true" />
                <span>Lookup</span>
              </button>
            </nav>

            <div className="app-security" aria-label="Security status: local vault protected">
              <span className="status-indicator" aria-hidden="true">
                <span />
              </span>
              <span className="min-w-0">
                <span className="brand-eyebrow">Local vault</span>
                <strong>Protected session</strong>
              </span>
              <ShieldCheck className="h-[18px] w-[18px] text-emerald-300" aria-hidden="true" />
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1">
          <Routes>
            <Route path="/" element={<Navigate to="/admin?tab=create" replace />} />
            <Route path="/admin" element={<HomePage />} />
            <Route path="/orders" element={<OrderPage />} />
            <Route path="/manage" element={<ManagePage />} />
            <Route path="*" element={<Navigate to="/admin?tab=create" replace />} />
          </Routes>
        </main>

        <footer className="app-footer">
          <span>Pulcip Members</span>
          <span className="app-footer-divider" aria-hidden="true" />
          <span>Private operations console</span>
        </footer>
      </div>
    </div>
  );
}

export default Shell;
