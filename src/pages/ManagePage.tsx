import { Link } from "react-router-dom";

export default function ManagePage() {
  return (
    <section className="panel section">
      <span className="eyebrow">Management lane</span>
      <h2 className="section-title">Shortcuts</h2>

      <div className="summary-row" style={{ marginTop: 18 }}>
        <div className="summary-card">
          <span className="label">Admin</span>
          <strong>Orders + settings</strong>
        </div>
        <div className="summary-card">
          <span className="label">Orders</span>
          <strong>/orders</strong>
        </div>
        <div className="summary-card">
          <span className="label">Mode</span>
          <strong>Local-first</strong>
        </div>
      </div>

      <div className="intro-actions" style={{ marginTop: 18 }}>
        <Link className="primary-button" to="/admin">
          Admin
        </Link>
        <Link className="ghost-button" to="/orders">
          Orders
        </Link>
      </div>
    </section>
  );
}
