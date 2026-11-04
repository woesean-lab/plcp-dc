import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useLayoutEffect, useState } from "react";
import { Bot, Boxes, ListChecks, LoaderCircle, LogOut, Plus, RadioTower, Settings2, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import BrandPage from "./pages/BrandPage";
import LandingPage from "./pages/LandingPage";
import OrderPage from "./pages/OrderPage";
import PublicOrderPage from "./pages/PublicOrderPage";
import HumanizerPage from "./pages/HumanizerPage";
import ReactionsPage from "./pages/ReactionsPage";
import { normalizeAdminTab } from "./lib/navigation";
import { refreshSession, signOut } from "./lib/session-auth";
import { getCommunityConfig, runCommunityAutoLeaveCheck } from "./lib/community";
import { checkDcordConnection, getAdminConfig } from "./lib/integration";

function ScrollToRouteTop() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return null;
}

function ProtectedShell({ onSignedOut }: { onSignedOut: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [dcordConfigured, setDcordConfigured] = useState(false);
  const [checkingDcord, setCheckingDcord] = useState(false);
  const [checkingAutoLeave, setCheckingAutoLeave] = useState(false);
  const [membersBotServers, setMembersBotServers] = useState<{ count: number | null; exact: boolean; limit: number | null }>({ count: null, exact: true, limit: null });

  useEffect(() => {
    let active = true;
    const loadHeaderOperations = async () => {
      const [adminResult, communityResult] = await Promise.allSettled([getAdminConfig(), getCommunityConfig()]);
      if (!active) return;
      if (adminResult.status === "fulfilled") setDcordConfigured(adminResult.value.dcordConfigured);
      if (communityResult.status === "fulfilled") {
        setMembersBotServers({
          count: communityResult.value.activeGuildCount,
          exact: communityResult.value.activeGuildCountExact,
          limit: communityResult.value.serverLimit
        });
      }
    };
    void loadHeaderOperations();
    const timer = window.setInterval(() => void loadHeaderOperations(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function handleHeaderDcordCheck() {
    try {
      setCheckingDcord(true);
      const result = await checkDcordConnection();
      if (!result.connected) throw new Error(result.message || "Dcord account is disabled.");
      toast.success(result.message || "Dcord connection is healthy.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dcord connection check failed.");
    } finally {
      setCheckingDcord(false);
    }
  }

  async function handleHeaderAutoLeaveCheck() {
    try {
      setCheckingAutoLeave(true);
      const result = await runCommunityAutoLeaveCheck();
      if (result.scheduledOrders > 0) {
        toast.success(`${result.scheduledMembers} members scheduled across ${result.scheduledOrders} expired orders.`);
        window.dispatchEvent(new Event("community-auto-leave-scheduled"));
      } else {
        toast.success("No expired orders are waiting for Auto Leave.");
      }
      if (result.failed.length) toast.error(`${result.failed.length} orders could not be scheduled.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Auto Leave check failed.");
    } finally {
      setCheckingAutoLeave(false);
    }
  }

  const search = new URLSearchParams(location.search);
  const tab = normalizeAdminTab(search.get("tab"));
  const isOrders = location.pathname.startsWith("/orders");
  const isHumanizer = location.pathname.startsWith("/humanizer");
  const isReactions = location.pathname.startsWith("/reactions");
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
            <button className="app-brand" type="button" onClick={() => navigate("/manage?tab=create")} aria-label="Pulcip Discord Console home">
              <span className="brand-mark" aria-hidden="true">
                <span className="brand-letter">P</span>
              </span>
              <span className="min-w-0 text-left">
                <span className="brand-eyebrow">Pulcip</span>
                <span className="brand-title">Discord Console</span>
              </span>
            </button>

            <div className="app-nav-cluster">
              <nav className="app-nav" aria-label="Primary navigation">
                <Link
                  to="/manage?tab=create"
                  aria-label="Create order"
                  title="Create order"
                  className={`app-nav-button ${isManage && tab === "create" ? "is-active" : ""}`}
                  aria-current={isManage && tab === "create" ? "page" : undefined}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>Create</span>
                </Link>
                <Link
                  to="/manage?tab=manage"
                  aria-label="Orders"
                  title="Orders"
                  className={`app-nav-button ${(isManage && tab === "manage") || isOrders ? "is-active" : ""}`}
                  aria-current={(isManage && tab === "manage") || isOrders ? "page" : undefined}
                >
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  <span>Orders</span>
                </Link>
                <Link
                  to="/reactions"
                  aria-label="Reactions"
                  title="Reactions"
                  className={`app-nav-button ${isReactions ? "is-active" : ""}`}
                  aria-current={isReactions ? "page" : undefined}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span>Reactions</span>
                </Link>
                <Link
                  to="/manage?tab=stock"
                  aria-label="Stock"
                  title="Stock"
                  className={`app-nav-button ${isManage && tab === "stock" ? "is-active" : ""}`}
                  aria-current={isManage && tab === "stock" ? "page" : undefined}
                >
                  <Boxes className="h-4 w-4" aria-hidden="true" />
                  <span>Stock</span>
                </Link>
                <Link
                  to="/manage?tab=onliner"
                  aria-label="Onliner"
                  title="Onliner"
                  className={`app-nav-button ${isManage && tab === "onliner" ? "is-active" : ""}`}
                  aria-current={isManage && tab === "onliner" ? "page" : undefined}
                >
                  <RadioTower className="h-4 w-4" aria-hidden="true" />
                  <span>Onliner</span>
                </Link>
                <Link
                  to="/humanizer"
                  aria-label="Humanizer"
                  title="Humanizer"
                  className={`app-nav-button ${isHumanizer ? "is-active" : ""}`}
                  aria-current={isHumanizer ? "page" : undefined}
                >
                  <WandSparkles className="h-4 w-4" aria-hidden="true" />
                  <span>Humanizer</span>
                </Link>
                <Link
                  to="/manage?tab=settings"
                  aria-label="Settings"
                  title="Settings"
                  className={`app-nav-button ${isManage && tab === "settings" ? "is-active" : ""}`}
                  aria-current={isManage && tab === "settings" ? "page" : undefined}
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                  <span>Settings</span>
                </Link>
              </nav>
            </div>

            <div className="app-security app-header-operations" aria-label="Service operations">
              <button type="button" className="header-dcord-check" disabled={!dcordConfigured || checkingDcord} onClick={() => void handleHeaderDcordCheck()}>
                {checkingDcord ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{checkingDcord ? "Checking" : "Dcord check"}</span>
              </button>
              <button type="button" className="header-dcord-check" disabled={checkingAutoLeave} onClick={() => void handleHeaderAutoLeaveCheck()}>
                {checkingAutoLeave ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <LogOut className="h-3.5 w-3.5" aria-hidden="true" />}
                <span>{checkingAutoLeave ? "Checking" : "Auto Leave check"}</span>
              </button>
              <span className="header-members-count" title="Servers currently connected to the Members bot">
                <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  <small>Members bot</small>
                  <strong>
                    {membersBotServers.count === null
                      ? "— servers"
                      : `${membersBotServers.exact ? "" : "≥"}${membersBotServers.count}${membersBotServers.limit ? ` / ${membersBotServers.limit}` : ""} servers`}
                  </strong>
                </span>
              </span>
              <button
                type="button"
                className="session-logout"
                onClick={() => {
                  void signOut().finally(() => {
                    onSignedOut();
                    navigate("/manage", { replace: true });
                  });
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        <main id="main-content" className="min-w-0 flex-1">
          <Routes>
            <Route path="/orders" element={<OrderPage />} />
            <Route path="/manage" element={<HomePage />} />
            <Route path="/admin" element={<HomePage />} />
            <Route path="/humanizer" element={<HumanizerPage />} />
            <Route path="/reactions" element={<ReactionsPage />} />
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

function ProtectedGate() {
  const location = useLocation();
  const [authState, setAuthState] = useState<"loading" | "authenticated" | "anonymous">("loading");

  useEffect(() => {
    let active = true;
    void refreshSession().then((ok) => {
      if (active) setAuthState(ok ? "authenticated" : "anonymous");
    });
    return () => {
      active = false;
    };
  }, []);

  if (authState === "loading") {
    return (
      <div className="session-loading-screen app-shell min-h-screen" role="status" aria-live="polite">
        <span className="brand-mark" aria-hidden="true"><span className="brand-letter">P</span></span>
        <span>
          <span className="brand-eyebrow">Pulcip</span>
          <strong>Loading secure session…</strong>
        </span>
      </div>
    );
  }
  if (authState === "anonymous") {
    if (location.pathname !== "/manage") {
      return <Navigate to="/manage" replace state={{ from: location }} />;
    }
    return <LoginPage onAuthenticated={() => setAuthState("authenticated")} />;
  }

  return <ProtectedShell onSignedOut={() => setAuthState("anonymous")} />;
}

function LegacyPublicOrderRedirect() {
  const { uniqid = "" } = useParams();
  const location = useLocation();
  return <Navigate to={`/monitor/${encodeURIComponent(uniqid)}${location.search}`} replace />;
}

export default function App() {
  return (
    <>
      <ScrollToRouteTop />
      <Routes>
        <Route path="/" element={<BrandPage />} />
        <Route path="/home" element={<LandingPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/monitor" element={<PublicOrderPage />} />
        <Route path="/monitor/:uniqid" element={<PublicOrderPage />} />
        <Route path="/monitor/*" element={<PublicOrderPage />} />
        <Route path="/public/order/:uniqid" element={<LegacyPublicOrderRedirect />} />
        <Route path="*" element={<ProtectedGate />} />
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
