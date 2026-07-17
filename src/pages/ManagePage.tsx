import { Link } from "react-router-dom";

const card = "app-panel";
const labelClass = "app-kicker";
const buttonClass = "app-button app-button-ghost";

export default function ManagePage() {
  return (
    <section className={`${card} p-5`}>
      <p className={labelClass}>Management lane</p>
      <h2 className="app-title mt-2 text-[2rem] font-semibold">Shortcuts</h2>
      <p className="app-copy mt-2 max-w-2xl text-sm leading-6">Short entry point. Main actions live in the header.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="app-panel-soft p-4">
          <p className={labelClass}>Admin</p>
          <p className="app-copy mt-2 text-sm">Orders + settings</p>
        </div>
        <div className="app-panel-soft p-4">
          <p className={labelClass}>Orders</p>
          <p className="app-copy mt-2 text-sm">/orders</p>
        </div>
        <div className="app-panel-soft p-4">
          <p className={labelClass}>Mode</p>
          <p className="app-copy mt-2 text-sm">Local-first</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link className={buttonClass} to="/admin?tab=create">
          Admin
        </Link>
        <Link className={buttonClass} to="/orders">
          Orders
        </Link>
      </div>
    </section>
  );
}
