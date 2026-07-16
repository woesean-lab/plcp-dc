import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { clearApiKey, getApiKey, setApiKey } from "../lib/auth";
import { checkAvailableAmount, createOrder, getBalance } from "../lib/tokenu";
import { loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import type { ServiceType, TrackedOrder } from "../types";

const SERVICE_OPTIONS: Array<{ value: ServiceType; title: string; description: string }> = [
  {
    value: "OAUTH-OFFLINE",
    title: "OAuth Offline",
    description: "Fast-start supply for standard member drops."
  },
  {
    value: "OAUTH-ONLINE",
    title: "OAuth Online",
    description: "Best for campaigns that need billing-cycle control."
  },
  {
    value: "OAUTH-PREMIUM",
    title: "OAuth Premium",
    description: "Premium delivery lane for higher-tier runs."
  },
  {
    value: "OAUTH-NFT",
    title: "OAuth NFT",
    description: "Specialized lane for NFT-focused communities."
  }
];

const EMPTY_FORM = {
  service: "OAUTH-ONLINE" as ServiceType,
  serverId: "",
  amount: 100,
  delay: 1,
  billingCycle: 1
};

function formatNumber(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function badgeClass(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  if (["completed", "success"].includes(normalized)) return "mini-badge completed";
  if (["process", "processing", "new"].includes(normalized)) return "mini-badge process";
  if (["error", "invalid", "terminated"].includes(normalized)) return "mini-badge error";
  return "mini-badge";
}

export default function HomePage() {
  const [apiKey, setApiKeyValue] = useState(getApiKey());
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [availability, setAvailability] = useState<string>("");
  const [orders, setOrders] = useState<TrackedOrder[]>(() => loadTrackedOrders());
  const [form, setForm] = useState(EMPTY_FORM);
  const [orderIdToTrack, setOrderIdToTrack] = useState("");
  const [activeTab, setActiveTab] = useState<"create" | "manage">("create");

  const storedApiKey = getApiKey();
  const activeOrders = orders.filter(
    (order) => !["COMPLETED", "TERMINATED", "INVALID", "ERROR"].includes(String(order.status ?? "").toUpperCase())
  );

  useEffect(() => {
    if (storedApiKey) {
      void refreshBalance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedApiKey]);

  useEffect(() => {
    if (!form.serverId.trim()) {
      setAvailability("");
      return;
    }

    const handle = window.setTimeout(() => {
      void refreshAvailability();
    }, 350);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.service, form.serverId]);

  async function refreshBalance() {
    try {
      setLoadingBalance(true);
      const data = await getBalance();
      setBalance(data.balance);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Balance could not be loaded.");
    } finally {
      setLoadingBalance(false);
    }
  }

  async function refreshAvailability() {
    try {
      const data = await checkAvailableAmount(form.service, form.serverId);
      setAvailability(`Available ${data.available} / max ${data.maximum}`);
    } catch {
      setAvailability("");
    }
  }

  function persistOrders(nextOrders: TrackedOrder[]) {
    setOrders(nextOrders);
    saveTrackedOrders(nextOrders);
  }

  async function handleSaveApiKey(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    try {
      const trimmed = apiKey.trim();
      if (trimmed) {
        setApiKey(trimmed);
        setApiKeyValue(trimmed);
        setMessage("API key saved locally.");
        await refreshBalance();
      } else {
        clearApiKey();
        setMessage("API key cleared.");
        setBalance(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save API key.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateOrder(event: FormEvent) {
    event.preventDefault();
    setMessage("");

    try {
      const created = await createOrder({
        service: form.service,
        id: form.serverId.trim(),
        amount: form.amount,
        delay: form.delay,
        billingCycle: form.service === "OAUTH-ONLINE" ? form.billingCycle : undefined
      });

      const nextOrder: TrackedOrder = {
        uniqid: created.uniqid,
        service: form.service,
        serverId: form.serverId.trim(),
        amount: form.amount,
        delay: form.delay,
        billingCycle: form.service === "OAUTH-ONLINE" ? form.billingCycle : undefined,
        cost: created.cost,
        botInvite: created.bot_invite,
        createdAt: new Date().toISOString(),
        status: "NEW"
      };

      persistOrders([nextOrder, ...orders]);
      setOrderIdToTrack(created.uniqid);
      setMessage(`Order created: ${created.uniqid}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order could not be created.");
    }
  }

  function trackOrderManually() {
    const uniqid = orderIdToTrack.trim();
    if (!uniqid) return;

    const exists = orders.some((order) => order.uniqid === uniqid);
    if (exists) {
      setMessage("Order is already tracked.");
      return;
    }

    persistOrders([
      {
        uniqid,
        service: form.service,
        serverId: form.serverId.trim(),
        amount: form.amount,
        delay: form.delay,
        billingCycle: form.billingCycle,
        createdAt: new Date().toISOString(),
        status: "NEW"
      },
      ...orders
    ]);
    setMessage("Order added to tracking list.");
  }

  return (
    <div className="dashboard-stack">
      <section className="dashboard-grid">
        <div className="panel intro-panel">
          <span className="intro-kicker">Admin workspace</span>
          <h2>One panel for order creation, monitoring, and service control.</h2>
          <p className="intro-copy">
            Members flowunu Tokenu reseller API ile tek ekrandan yonetin. API key localde kalir,
            public tracker ise sadece order ID ile calisir.
          </p>

          <div className="intro-actions">
            <button className="primary-button" type="button" onClick={() => setActiveTab("create")}>
              Create order
            </button>
            <button className="ghost-button" type="button" onClick={() => setActiveTab("manage")}>
              Open management
            </button>
            <span className="surface-note">Live panel / local storage</span>
          </div>

          <div className="summary-row">
            <div className="summary-card">
              <span className="label">Balance</span>
              <strong>{loadingBalance ? "Syncing..." : balance === null ? "-" : `$${formatNumber(balance)}`}</strong>
              <p>Checked against the reseller API when a valid key is saved.</p>
            </div>
            <div className="summary-card">
              <span className="label">Tracked orders</span>
              <strong>{orders.length}</strong>
              <p>Stored locally in this browser for fast admin follow-up.</p>
            </div>
            <div className="summary-card">
              <span className="label">Active</span>
              <strong>{activeOrders.length}</strong>
              <p>Orders that are still in flight and need attention.</p>
            </div>
          </div>
        </div>

        <aside className="panel sidebar-panel">
          <div className="status-pill">
            <span className="status-dot" />
            {storedApiKey ? "API key ready" : "API key missing"}
          </div>

          <div className="mini-stack">
            <div className="mini-card">
              <h3 className="title">Key vault</h3>
              <p>{storedApiKey ? "Stored locally only. You can refresh balance and create orders." : "Paste your Tokenu API key to enable live actions."}</p>
            </div>

            <div className="mini-card">
              <h3 className="title">Public route</h3>
              <p>
                `/orders` works without admin auth. Share order IDs with users to let them check
                progress.
              </p>
            </div>

            <div className="mini-card">
              <h3 className="title">Quick links</h3>
              <div className="inline-actions" style={{ marginTop: 10 }}>
                <Link className="ghost-button" to="/orders">
                  Open tracker
                </Link>
                <button className="ghost-button" type="button" onClick={refreshBalance}>
                  Refresh balance
                </button>
              </div>
            </div>
          </div>

          <div className="stat-strip">
            <div className="stat-item">
              <span>Default service</span>
              <strong>OAUTH-ONLINE</strong>
              <p>Billing-cycle aware service preset for members runs.</p>
            </div>
            <div className="stat-item">
              <span>Tracking mode</span>
              <strong>Local-first</strong>
              <p>Orders are mirrored in localStorage for quick management.</p>
            </div>
          </div>
        </aside>
      </section>

      <div className="tabs">
        <button className={activeTab === "create" ? "tab-button active" : "tab-button"} onClick={() => setActiveTab("create")}>
          Siparis olustur
        </button>
        <button className={activeTab === "manage" ? "tab-button active" : "tab-button"} onClick={() => setActiveTab("manage")}>
          Siparisleri yonet
        </button>
      </div>

      {message ? <div className="notice">{message}</div> : null}

      {activeTab === "create" ? (
        <section className="content-grid">
          <div className="panel section">
            <div className="section-head">
              <div>
                <span className="eyebrow">Order composer</span>
                <h3 className="section-title">Create a reseller order with intent.</h3>
                <p>
                  Choose the service lane, paste the Discord server ID, and tune the delivery pace.
                </p>
              </div>
              <div className="status-pill">Tokenu API connected</div>
            </div>

            <form onSubmit={handleCreateOrder}>
              <div className="form-grid">
                <label className="field">
                  <span>Service</span>
                  <select
                    value={form.service}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        service: event.target.value as ServiceType
                      }))
                    }
                  >
                    {SERVICE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.title}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Server ID</span>
                  <input
                    value={form.serverId}
                    onChange={(event) => setForm((current) => ({ ...current, serverId: event.target.value }))}
                    placeholder="Discord server ID"
                  />
                </label>

                <label className="field">
                  <span>Amount</span>
                  <input
                    type="number"
                    min={1}
                    value={form.amount}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Delay (sec)</span>
                  <input
                    type="number"
                    min={1}
                    max={1200}
                    value={form.delay}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, delay: Number(event.target.value) || 1 }))
                    }
                  />
                </label>

                <label className="field span-2">
                  <span>Billing cycle</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    disabled={form.service !== "OAUTH-ONLINE"}
                    value={form.billingCycle}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, billingCycle: Number(event.target.value) || 1 }))
                    }
                  />
                </label>
              </div>

              <div className="inline-actions" style={{ marginTop: 18 }}>
                <button className="primary-button" type="submit">
                  Create order
                </button>
                <button className="ghost-button" type="button" onClick={refreshBalance}>
                  Refresh balance
                </button>
              </div>
            </form>

            {availability ? <div className="warning" style={{ marginTop: 16 }}>{availability}</div> : null}
          </div>

          <div className="panel section">
            <div className="section-head">
              <div>
                <span className="eyebrow">Control rail</span>
                <h3 className="section-title">Settings and tracking shortcuts.</h3>
                <p>Save the API key, add existing orders, and keep the local queue tidy.</p>
              </div>
            </div>

            <form onSubmit={handleSaveApiKey}>
              <label className="field">
                <span>Tokenu API key</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKeyValue(event.target.value)}
                  placeholder="Paste API key"
                  autoComplete="off"
                />
              </label>
              <div className="inline-actions" style={{ marginTop: 14 }}>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save locally"}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    clearApiKey();
                    setApiKeyValue("");
                    setBalance(null);
                    setMessage("API key cleared.");
                  }}
                >
                  Clear
                </button>
              </div>
            </form>

            <div style={{ marginTop: 18 }} className="mini-stack">
              <div className="mini-card">
                <h3 className="title">Track existing order</h3>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Order ID</span>
                  <input
                    value={orderIdToTrack}
                    onChange={(event) => setOrderIdToTrack(event.target.value)}
                    placeholder="Enter an existing order ID"
                  />
                </label>
                <div className="inline-actions" style={{ marginTop: 12 }}>
                  <button className="primary-button" type="button" onClick={trackOrderManually}>
                    Add to tracking
                  </button>
                  <Link className="ghost-button" to="/orders">
                    Public lookup
                  </Link>
                </div>
              </div>

              <div className="mini-card">
                <h3 className="title">Service map</h3>
                <div className="inline-actions" style={{ marginTop: 10 }}>
                  {SERVICE_OPTIONS.map((service) => (
                    <span key={service.value} className="mini-badge">
                      {service.title}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel section">
          <div className="section-head">
            <div>
              <span className="eyebrow">Management table</span>
              <h3 className="section-title">Track the queue and jump into public lookup.</h3>
              <p>
                Orders are stored in this browser. Use the row actions to open, copy, or remove a
                record.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Service</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Cost</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.length ? (
                  orders.map((order) => (
                    <tr key={order.uniqid}>
                      <td>
                        <strong>{order.uniqid}</strong>
                        <div className="muted">{order.serverId || "No server ID"}</div>
                      </td>
                      <td>{order.service}</td>
                      <td>{order.amount}</td>
                      <td>
                        <span className={badgeClass(order.status)}>{order.status ?? "NEW"}</span>
                        <div className="muted" style={{ marginTop: 8 }}>
                          {order.details ?? ""}
                        </div>
                      </td>
                      <td>{typeof order.cost === "number" ? `$${formatNumber(order.cost)}` : "-"}</td>
                      <td>
                        <div className="row-actions">
                          <Link className="action-button" to={`/orders?uniqid=${encodeURIComponent(order.uniqid)}`}>
                            Open
                          </Link>
                          <button className="action-button" type="button" onClick={() => navigator.clipboard.writeText(order.uniqid)}>
                            Copy
                          </button>
                          <button
                            className="action-button"
                            type="button"
                            onClick={() => persistOrders(orders.filter((item) => item.uniqid !== order.uniqid))}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">No tracked orders yet. Switch back to Create order to start a queue.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
