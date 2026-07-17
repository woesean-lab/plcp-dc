import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { clearApiKey, getApiKey, setApiKey } from "../lib/auth";
import { checkAvailableAmount, createOrder, getBalance } from "../lib/tokenu";
import { loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import type { ServiceType, TrackedOrder } from "../types";

const SERVICE_OPTIONS: Array<{ value: ServiceType; title: string }> = [
  { value: "OAUTH-OFFLINE", title: "OAuth Offline" },
  { value: "OAUTH-ONLINE", title: "OAuth Online" },
  { value: "OAUTH-PREMIUM", title: "OAuth Premium" },
  { value: "OAUTH-NFT", title: "OAuth NFT" }
];

const EMPTY_FORM = {
  service: "OAUTH-ONLINE" as ServiceType,
  serverId: "",
  amount: 100,
  delay: 1,
  billingCycle: 1
};

function formatNumber(value?: number) {
  return typeof value === "number" && !Number.isNaN(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    : "-";
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
  const [message, setMessage] = useState("");
  const [availability, setAvailability] = useState("");
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
        setMessage("API key saved.");
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

    if (orders.some((order) => order.uniqid === uniqid)) {
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
    setMessage("Order added.");
  }

  return (
    <div className="dashboard-stack">
      <section className="overview-panel panel">
        <div className="overview-head">
          <div>
            <span className="eyebrow">Admin</span>
            <h2>Orders and settings</h2>
          </div>
          <div className="intro-actions">
            <button className="primary-button" type="button" onClick={() => setActiveTab("create")}>
              Create
            </button>
            <button className="ghost-button" type="button" onClick={() => setActiveTab("manage")}>
              Manage
            </button>
            <Link className="ghost-button" to="/orders">
              Orders
            </Link>
          </div>
        </div>

        <div className="overview-grid">
          <div className="summary-card">
            <span className="label">Balance</span>
            <strong>{loadingBalance ? "Syncing..." : balance === null ? "-" : `$${formatNumber(balance)}`}</strong>
          </div>
          <div className="summary-card">
            <span className="label">Tracked</span>
            <strong>{orders.length}</strong>
          </div>
          <div className="summary-card">
            <span className="label">Active</span>
            <strong>{activeOrders.length}</strong>
          </div>
          <div className="summary-card">
            <span className="label">API key</span>
            <strong>{storedApiKey ? "Ready" : "Missing"}</strong>
          </div>
        </div>
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
                <span className="eyebrow">Order</span>
                <h3 className="section-title">Fields</h3>
              </div>
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
                <span className="eyebrow">Control</span>
                <h3 className="section-title">Tools</h3>
              </div>
            </div>

            <div className="mini-stack">
              <div className="mini-card">
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
              </div>

              <div className="mini-card">
                <h3 className="title">Track order</h3>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Order ID</span>
                  <input
                    value={orderIdToTrack}
                    onChange={(event) => setOrderIdToTrack(event.target.value)}
                    placeholder="Enter order ID"
                  />
                </label>
                <div className="inline-actions" style={{ marginTop: 12 }}>
                  <button className="primary-button" type="button" onClick={trackOrderManually}>
                    Add
                  </button>
                  <Link className="ghost-button" to="/orders">
                    Lookup
                  </Link>
                </div>
              </div>

              <div className="mini-card">
                <h3 className="title">Services</h3>
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
              <h3 className="section-title">Queue</h3>
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
                      <div className="empty-state">No tracked orders yet.</div>
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
