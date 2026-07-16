import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import OrderPage from "./pages/OrderPage";
import ManagePage from "./pages/ManagePage";

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();

  const isOrders = location.pathname.startsWith("/orders");
  const isAdmin = location.pathname.startsWith("/admin") || location.pathname === "/";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Tokenu reseller panel</span>
          <h1>Members operations console</h1>
        </div>
        <nav className="topnav" aria-label="Primary">
          <button className={isAdmin ? "nav-link active" : "nav-link"} onClick={() => navigate("/admin")}>
            Admin
          </button>
          <button className={isOrders ? "nav-link active" : "nav-link"} onClick={() => navigate("/orders")}>
            Orders
          </button>
        </nav>
      </header>

      <main className="page-frame">
        <Routes>
          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="/admin" element={<HomePage />} />
          <Route path="/orders" element={<OrderPage />} />
          <Route path="/manage" element={<ManagePage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default Shell;
