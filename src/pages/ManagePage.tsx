import { Link } from "react-router-dom";

export default function ManagePage() {
  return (
    <section className="panel section">
      <h2 className="section-title">Manage route</h2>
      <p className="muted">
        This route is kept as a dedicated entry point. The main management workspace lives under Admin.
      </p>
      <div className="inline-actions" style={{ marginTop: 14 }}>
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
