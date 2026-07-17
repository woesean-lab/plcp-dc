import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import ManagePage from "./pages/ManagePage";

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();

  const search = new URLSearchParams(location.search);
  const activeTab = search.get("tab") ?? "create";
  const isOrders = location.pathname.startsWith("/orders");
  const isAdmin = location.pathname.startsWith("/admin") || location.pathname === "/";

  return (
    <div className="app-shell">
      <div className="shell-frame">
        <main className="page-frame">
          <div className="route-tabs" aria-label="Primary">
            <div className="route-title">Tokenu panel</div>

            <nav className="topnav" aria-label="Primary">
              <button className={isAdmin && activeTab === "create" ? "nav-link active" : "nav-link"} onClick={() => navigate("/admin?tab=create")}>
                Sipariş oluştur
              </button>
              <button className={isAdmin && activeTab === "manage" ? "nav-link active" : "nav-link"} onClick={() => navigate("/admin?tab=manage")}>
                Siparişleri yönet
              </button>
              <button className={isOrders ? "nav-link active" : "nav-link"} onClick={() => navigate("/orders")}>
                Orders
              </button>
            </nav>
          </div>

          <Routes>
            <Route path="/" element={<Navigate to="/admin" replace />} />
            <Route path="/admin" element={<HomePage />} />
            <Route path="/orders" element={<OrderPage />} />
            <Route path="/manage" element={<ManagePage />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default Shell;
