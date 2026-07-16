import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { clearApiKey, getApiKey, setApiKey } from "../lib/auth";
import { checkAvailableAmount, createOrder, getBalance } from "../lib/tokenu";
import { loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import type { ServiceType, TrackedOrder } from "../types";

const SERVICE_OPTIONS: Array<{ value: ServiceType; title: string; description: string }> = [
  {
    value: "OAUTH-OFFLINE",
    title: "OAuth Offline",
    description: "Fastest entry point for standard member supply."
  },
  {
    value: "OAUTH-ONLINE",
    title: "OAuth Online",
    description: "Membership with billing cycle support."
  },
  {
    value: "OAUTH-PREMIUM",
    title: "OAuth Premium",
    description: "Higher tier member delivery flow."
  },
  {
    value: "OAUTH-NFT",
    title: "OAuth NFT",
    description: "Specialized member type for NFT audiences."
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

  const savedApiKey = useMemo(() => getApiKey(), [apiKey]);
  const activeOrders = orders.filter((order) => !["COMPLETED", "TERMINATED", "INVALID", "ERROR"].includes(String(order.status ?? "").toUpperCase()));

  useEffect(() => {
    if (savedApiKey) {
      void refreshBalance();
    }
  }, [savedApiKey]);

  useEffect(() => {
    if (!form.serverId.trim()) {
      setAvailability("");
      return;
    }

    const handle = window.setTimeout(() => {
      void refreshAvailability();
    }, 400);

    return () => window.clearTimeout(handle);
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
      setApiKey(apiKey);
      const trimmed = apiKey.trim();
      if (trimmed) {
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

  async function handleCreateOrder(event: React.FormEvent) {
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
    <div className="content-stack">
      <section className="hero-grid">
        <div className="panel panel-pad hero-copy">
          <span className="eyebrow">Admin area</span>
          <h2>Siparis olustur ve aktif siparisleri ayni panelde takip et</h2>
          <p>
            Bu panel, Tokenu reseller API ile members satisi icin gerekli temel akisi tek yerden
            yonetir. API anahtari localde saklanir; public sayfa sadece order ID ile sorgu yapar.
          </p>

          <div className="metrics">
            <div className="metric-card">
              <span className="label">Balance</span>
              <strong>{loadingBalance ? "Syncing..." : balance === null ? "-" : `$${formatNumber(balance)}`}</strong>
            </div>
            <div className="metric-card">
              <span className="label">Tracked orders</span>
              <strong>{orders.length}</strong>
            </div>
            <div className="metric-card">
              <span className="label">Active</span>
              <strong>{activeOrders.length}</strong>
            </div>
            <div className="metric-card">
              <span className="label">Public tracker</span>
              <strong>/orders</strong>
            </div>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <span className="status-pill">
              <span className="status-dot" />
              {apiKey ? "API key ready" : "API key missing"}
            </span>
            <Link className="ghost-button" to="/orders">
              Open public tracker
            </Link>
          </div>
          <div style={{ marginTop: 16 }}>
            <p className="muted">
              {apiKey
                ? "Key is stored locally only. You can refresh balance, create orders, and inspect order status."
                : "Paste your Tokenu API key once, then use the panel normally."}
            </p>
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
        <div className="workspace">
          <section className="panel section">
            <h3 className="section-title">Create order</h3>
            <p className="muted">Members service selection is aligned with the reseller API docs.</p>
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

              <div className="inline-actions" style={{ marginTop: 16 }}>
                <button className="primary-button" type="submit">
                  Create order
                </button>
                <button className="ghost-button" type="button" onClick={refreshBalance}>
                  Refresh balance
                </button>
              </div>
            </form>

            {availability ? <div className="warning" style={{ marginTop: 16 }}>{availability}</div> : null}

            <div style={{ marginTop: 18 }}>
              <h4 style={{ margin: "0 0 10px" }}>Service map</h4>
              <div className="inline-actions">
                {SERVICE_OPTIONS.map((service) => (
                  <span key={service.value} className="status-pill">
                    {service.title}
                  </span>
                ))}
              </div>
            </div>
          </section>

          <section className="panel section">
            <h3 className="section-title">Ayarlar</h3>
            <p className="muted">API key and quick tracking tools.</p>

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

            <div style={{ marginTop: 18 }}>
              <label className="field">
                <span>Track order ID</span>
                <input
                  value={orderIdToTrack}
                  onChange={(event) => setOrderIdToTrack(event.target.value)}
                  placeholder="Enter an existing order ID"
                />
              </label>
              <div className="inline-actions" style={{ marginTop: 14 }}>
                <button className="primary-button" type="button" onClick={trackOrderManually}>
                  Add to tracking
                </button>
                <Link className="ghost-button" to="/orders">
                  Public lookup
                </Link>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className="panel section">
          <h3 className="section-title">Siparis listesi</h3>
          <p className="muted">Tracked orders are stored in this browser. Refresh status to keep them current.</p>
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
                        <div className="muted">{order.details ?? ""}</div>
                      </td>
                      <td>{typeof order.cost === "number" ? `$${formatNumber(order.cost)}` : "-"}</td>
                      <td>
                        <div className="row-actions">
                          <Link className="action-button" to={`/orders?uniqid=${encodeURIComponent(order.uniqid)}`}>
                            Open
                          </Link>
                          <button
                            className="action-button"
                            type="button"
                            onClick={() => navigator.clipboard.writeText(order.uniqid)}
                          >
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
                      <div className="muted">No tracked orders yet.</div>
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
