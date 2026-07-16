import { Link } from "react-router-dom";

export default function ManagePage() {
  return (
    <section className="panel section">
      <span className="eyebrow">Management lane</span>
      <h2 className="section-title">Operational shortcuts</h2>
      <p className="intro-copy">
        This route is kept as a lightweight handoff page. Use it when you want a narrow entry point
        into the admin workspace or the public tracker.
      </p>

      <div className="summary-row" style={{ marginTop: 18 }}>
        <div className="summary-card">
          <span className="label">Admin</span>
          <strong>Orders + settings</strong>
          <p>Open the composer, balance refresh, and queue manager.</p>
        </div>
        <div className="summary-card">
          <span className="label">Orders</span>
          <strong>/orders</strong>
          <p>Public lookup without any admin credentials.</p>
        </div>
        <div className="summary-card">
          <span className="label">State</span>
          <strong>Local-first</strong>
          <p>Browser storage keeps drafts and tracked IDs available.</p>
        </div>
      </div>

      <div className="intro-actions" style={{ marginTop: 18 }}>
        <Link className="primary-button" to="/admin">
          Go to admin workspace
        </Link>
        <Link className="ghost-button" to="/orders">
          Open public orders page
        </Link>
      </div>
    </section>
  );
}
