import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ListChecks, Plus, Search, Settings2, ShieldCheck } from "lucide-react";
import { Toaster } from "react-hot-toast";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import OrderPage from "./pages/OrderPage";
import PublicOrderPage from "./pages/PublicOrderPage";
import { normalizeAdminTab } from "./lib/navigation";
import { isAuthenticated, signOut } from "./lib/session-auth";

function ProtectedShell() {
  const location = useLocation();
  const navigate = useNavigate();

  if (!isAuthenticated()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const search = new URLSearchParams(location.search);
  const tab = normalizeAdminTab(search.get("tab"));
  const isOrders = location.pathname.startsWith("/orders");
  const isManage = location.pathname.startsWith("/manage") || location.pathname.startsWith("/admin");

  return (
    <div className="app-shell min-h-screen text-[var(--app-text)]">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />

      <div className="app-frame mx-auto flex min-h-screen w-full max-w-[1520px] flex-col gap-6 px-3 py-3 sm:px-5 sm:py-5 lg:px-8">
        <header className="app-header sticky top-3 z-30">
          <div className="app-header-inner">
            <button className="app-brand" type="button" onClick={() => navigate("/manage?tab=create")} aria-label="Pulcip Members home">
              <span className="brand-mark" aria-hidden="true">
                <span className="brand-letter">P</span>
              </span>
              <span className="min-w-0 text-left">
                <span className="brand-eyebrow">Pulcip</span>
                <span className="brand-title">Members Console</span>
              </span>
            </button>

            <div className="app-nav-cluster">
              <nav className="app-nav" aria-label="Primary navigation">
                <button
                  type="button"
                  aria-label="Create order"
                  title="Create order"
                  className={`app-nav-button ${isManage && tab === "create" ? "is-active" : ""}`}
                  aria-current={isManage && tab === "create" ? "page" : undefined}
                  onClick={() => navigate("/manage?tab=create")}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Create</span>
                </button>
                <button
                  type="button"
                  aria-label="Manage orders"
                  title="Manage orders"
                  className={`app-nav-button ${isManage && tab === "manage" ? "is-active" : ""}`}
                  aria-current={isManage && tab === "manage" ? "page" : undefined}
                  onClick={() => navigate("/manage?tab=manage")}
                >
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  <span>Manage</span>
                </button>
                <button
                  type="button"
                  aria-label="Order lookup"
                  title="Order lookup"
                  className={`app-nav-button ${isOrders ? "is-active" : ""}`}
                  aria-current={isOrders ? "page" : undefined}
                  onClick={() => navigate("/orders")}
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  <span>Lookup</span>
                </button>
                <button
                  type="button"
                  aria-label="Settings"
                  title="Settings"
                  className={`app-nav-button ${isManage && tab === "settings" ? "is-active" : ""}`}
                  aria-current={isManage && tab === "settings" ? "page" : undefined}
                  onClick={() => navigate("/manage?tab=settings")}
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                  <span>Settings</span>
                </button>
              </nav>
            </div>

            <div className="app-security" aria-label="Security status: local vault protected">
              <span className="status-indicator" aria-hidden="true">
                <span />
              </span>
              <span className="min-w-0">
                <span className="brand-eyebrow">Local vault</span>
                <strong>Protected session</strong>
              </span>
              <button
                type="button"
                className="session-logout"
                onClick={() => {
                  signOut();
                  navigate("/login", { replace: true });
                }}
              >
                Logout
              </button>
              <ShieldCheck className="h-[18px] w-[18px] text-[var(--app-success)]" aria-hidden="true" />
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1">
          <Routes>
            <Route path="/orders" element={<OrderPage />} />
            <Route path="/manage" element={<HomePage />} />
            <Route path="/admin" element={<HomePage />} />
            <Route path="/" element={<Navigate to="/manage?tab=create" replace />} />
            <Route path="*" element={<Navigate to="/manage?tab=create" replace />} />
          </Routes>
        </main>

        <footer className="app-footer">
          <span>Pulcip Members</span>
          <span className="app-footer-divider" aria-hidden="true" />
          <span>Private operations suite</span>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/public/order/:uniqid" element={<PublicOrderPage />} />
        <Route path="*" element={<ProtectedShell />} />
      </Routes>

      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3500,
          style: {
            borderRadius: "14px",
            border: "1px solid var(--app-border)",
            background: "var(--app-surface)",
            color: "var(--app-text)",
            boxShadow: "0 16px 38px rgba(0, 0, 0, 0.22)"
          },
          success: {
            iconTheme: {
              primary: "var(--app-success)",
              secondary: "var(--app-surface)"
            }
          },
          error: {
            iconTheme: {
              primary: "var(--app-danger)",
              secondary: "var(--app-surface)"
            }
          }
        }}
      />
    </>
  );
}
