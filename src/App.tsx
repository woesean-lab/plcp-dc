import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ListChecks, Moon, Plus, Search, Settings2, ShieldCheck, Sun } from "lucide-react";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import { normalizeAdminTab } from "./lib/navigation";

type Theme = "dark" | "light";
const THEME_APPLY_DELAY = 140;
const THEME_PRELOADER_DURATION = 480;

function getInitialTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function Shell() {
  const [booting, setBooting] = useState(true);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [pendingTheme, setPendingTheme] = useState<Theme | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const search = new URLSearchParams(location.search);
  const tab = normalizeAdminTab(search.get("tab"));
  const isOrders = location.pathname.startsWith("/orders");
  const isAdmin = location.pathname.startsWith("/admin") || location.pathname === "/";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBooting(false);
    }, 480);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f3f6fa" : "#070910");

    try {
      window.localStorage.setItem("pulcip.theme", theme);
    } catch {
      // The visual preference still works when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    if (!pendingTheme) return;

    const applyTimer = window.setTimeout(() => {
      setTheme(pendingTheme);
    }, THEME_APPLY_DELAY);
    const finishTimer = window.setTimeout(() => {
      setPendingTheme(null);
    }, THEME_PRELOADER_DURATION);

    return () => {
      window.clearTimeout(applyTimer);
      window.clearTimeout(finishTimer);
    };
  }, [pendingTheme]);

  function handleThemeToggle() {
    if (pendingTheme) return;
    setPendingTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <div className="app-shell min-h-screen text-[var(--app-text)]">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />

      {booting || pendingTheme ? (
        <div className="app-overlay" role="status" aria-live="polite" aria-atomic="true">
          <div className="app-preloader">
            <span className="brand-mark brand-mark-loader" aria-hidden="true">
              <span className="brand-letter">P</span>
            </span>
            <div>
              <p className="app-kicker">{booting ? "Pulcip Members" : "Theme update"}</p>
              <p className="mt-2 text-sm text-[var(--app-muted)]">
                {booting ? "Preparing your workspace" : `Switching to ${pendingTheme} mode`}
              </p>
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

            <div className="app-nav-cluster">
              <nav className="app-nav" aria-label="Primary navigation">
                <button
                  type="button"
                  aria-label="Create order"
                  title="Create order"
                  className={`app-nav-button ${isAdmin && tab === "create" ? "is-active" : ""}`}
                  aria-current={isAdmin && tab === "create" ? "page" : undefined}
                  onClick={() => navigate("/admin?tab=create")}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Create</span>
                </button>
                <button
                  type="button"
                  aria-label="Manage orders"
                  title="Manage orders"
                  className={`app-nav-button ${isAdmin && tab === "manage" ? "is-active" : ""}`}
                  aria-current={isAdmin && tab === "manage" ? "page" : undefined}
                  onClick={() => navigate("/admin?tab=manage")}
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
                  className={`app-nav-button ${isAdmin && tab === "settings" ? "is-active" : ""}`}
                  aria-current={isAdmin && tab === "settings" ? "page" : undefined}
                  onClick={() => navigate("/admin?tab=settings")}
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                  <span>Settings</span>
                </button>
              </nav>

              <span className="app-nav-divider" aria-hidden="true" />
              <button
                className="theme-toggle"
                type="button"
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                aria-busy={pendingTheme !== null}
                aria-disabled={pendingTheme !== null}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                onClick={handleThemeToggle}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
                <span>{theme === "dark" ? "Light" : "Dark"}</span>
              </button>
            </div>

            <div className="app-security" aria-label="Security status: local vault protected">
              <span className="status-indicator" aria-hidden="true">
                <span />
              </span>
              <span className="min-w-0">
                <span className="brand-eyebrow">Local vault</span>
                <strong>Protected session</strong>
              </span>
              <ShieldCheck className="h-[18px] w-[18px] text-[var(--app-success)]" aria-hidden="true" />
            </div>
          </div>
        </header>

        <main id="main-content" className="flex-1">
          <Routes>
            <Route path="/" element={<Navigate to="/admin?tab=create" replace />} />
            <Route path="/admin" element={<HomePage />} />
            <Route path="/orders" element={<OrderPage />} />
            <Route path="/manage" element={<Navigate to="/admin?tab=manage" replace />} />
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
