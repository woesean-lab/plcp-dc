import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { clearApiKey, getApiKey, setApiKey } from "../lib/auth";
import { checkAvailableAmount, createOrder, getBalance } from "../lib/tokenu";
import { loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import type { ServiceType, TrackedOrder } from "../types";
import { CopyIcon, LinkIcon, PlusIcon, RefreshIcon, SearchIcon, SettingsIcon, SparkIcon, ShieldIcon } from "../components/Icons";

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
  if (["completed", "success"].includes(normalized)) return "inline-flex rounded-[3px] border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200";
  if (["process", "processing", "new"].includes(normalized)) return "inline-flex rounded-[3px] border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200";
  if (["error", "invalid", "terminated"].includes(normalized)) return "inline-flex rounded-[3px] border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-200";
  return "inline-flex rounded-[3px] border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200";
}

const inputClass =
  "w-full rounded-[3px] border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-sky-400/60 focus:ring-4 focus:ring-sky-400/10";

const labelClass = "text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500";

const actionButtonBase =
  "inline-flex items-center justify-center gap-2 rounded-[3px] border px-3 py-2 text-sm font-medium transition";

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "manage" ? "manage" : "create";

  const [apiKey, setApiKeyValue] = useState(getApiKey());
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [message, setMessage] = useState("");
  const [availability, setAvailability] = useState("");
  const [orders, setOrders] = useState<TrackedOrder[]>(() => loadTrackedOrders());
  const [form, setForm] = useState(EMPTY_FORM);
  const [orderIdToTrack, setOrderIdToTrack] = useState("");

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

  const card = "border border-slate-700/70 bg-slate-900/70 shadow-2xl shadow-slate-950/30";
  const accentCard =
    "border border-sky-400/20 bg-[linear-gradient(180deg,rgba(30,64,175,0.16),rgba(15,23,42,0.86))] shadow-2xl shadow-slate-950/30";

  return (
    <div className="space-y-4">
      <section className={`${accentCard} relative overflow-hidden p-5`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.10),transparent_24%)]" />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="relative">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              <ShieldIcon className="h-3.5 w-3.5 text-sky-300" />
              Admin
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">Orders and settings</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Create orders, sync balance, and keep track of the queue.
            </p>
          </div>

          <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-slate-700 bg-slate-950/60 px-4 py-3">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                <SparkIcon className="h-3.5 w-3.5 text-sky-300" />
                Balance
              </span>
              <strong className="mt-2 block text-lg text-slate-50">
                {loadingBalance ? "Syncing..." : balance === null ? "-" : `$${formatNumber(balance)}`}
              </strong>
            </div>
            <div className="border border-slate-700 bg-slate-950/60 px-4 py-3">
              <span className={labelClass}>Tracked</span>
              <strong className="mt-2 block text-lg text-slate-50">{orders.length}</strong>
            </div>
            <div className="border border-slate-700 bg-slate-950/60 px-4 py-3">
              <span className={labelClass}>Active</span>
              <strong className="mt-2 block text-lg text-slate-50">{activeOrders.length}</strong>
            </div>
            <div className="border border-slate-700 bg-slate-950/60 px-4 py-3">
              <span className={labelClass}>API key</span>
              <strong className="mt-2 block text-lg text-slate-50">{storedApiKey ? "Ready" : "Missing"}</strong>
            </div>
          </div>
        </div>
      </section>

      {message ? (
        <div className="border border-sky-400/25 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">{message}</div>
      ) : null}

      {activeTab === "create" ? (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className={`${card} p-5`}>
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  <PlusIcon className="h-3.5 w-3.5 text-sky-300" />
                  Order
                </p>
                <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-100">Create</h3>
              </div>
              <span className="inline-flex items-center gap-2 rounded-[3px] border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs uppercase tracking-[0.28em] text-sky-100">
                <SparkIcon className="h-3.5 w-3.5" />
                Live
              </span>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className={labelClass}>Service</span>
                  <select
                    className={inputClass}
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

                <label className="space-y-2">
                  <span className={labelClass}>Server ID</span>
                  <input
                    className={inputClass}
                    value={form.serverId}
                    onChange={(event) => setForm((current) => ({ ...current, serverId: event.target.value }))}
                    placeholder="Discord server ID"
                  />
                </label>

                <label className="space-y-2">
                  <span className={labelClass}>Amount</span>
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    value={form.amount}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))
                    }
                  />
                </label>

                <label className="space-y-2">
                  <span className={labelClass}>Delay</span>
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={1200}
                    value={form.delay}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, delay: Number(event.target.value) || 1 }))
                    }
                  />
                </label>

                <label className="space-y-2 md:col-span-2">
                  <span className={labelClass}>Billing cycle</span>
                  <input
                    className={inputClass}
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

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  className={`${actionButtonBase} border-sky-400/60 bg-sky-400 px-4 py-2.5 font-semibold text-slate-950 hover:bg-sky-300`}
                  type="submit"
                >
                  <PlusIcon className="h-4 w-4" />
                  Create order
                </button>
                <button
                  className={`${actionButtonBase} border-slate-700 bg-slate-950/60 text-slate-200 hover:border-sky-400/40 hover:bg-slate-800`}
                  type="button"
                  onClick={refreshBalance}
                >
                  <RefreshIcon className="h-4 w-4" />
                  Refresh balance
                </button>
              </div>

              {availability ? (
                <div className="border border-sky-400/20 bg-sky-400/8 px-4 py-3 text-sm text-sky-100">
                  {availability}
                </div>
              ) : null}
            </form>
          </div>

          <div className="space-y-4">
            <div className={`${card} p-5`}>
              <p className={labelClass}>Key</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-100">Tokenu API</h3>
              <form onSubmit={handleSaveApiKey} className="mt-4 space-y-4">
                <label className="space-y-2">
                  <span className={labelClass}>Local key</span>
                  <input
                    className={inputClass}
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKeyValue(event.target.value)}
                    placeholder="Paste API key"
                    autoComplete="off"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    className={`${actionButtonBase} border-sky-400/60 bg-sky-400 px-4 py-2.5 font-semibold text-slate-950 hover:bg-sky-300`}
                    type="submit"
                    disabled={saving}
                  >
                    <ShieldIcon className="h-4 w-4" />
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    className={`${actionButtonBase} border-slate-700 bg-slate-950/60 text-slate-200 hover:border-sky-400/40 hover:bg-slate-800`}
                    type="button"
                    onClick={() => {
                      clearApiKey();
                      setApiKeyValue("");
                      setBalance(null);
                      setMessage("API key cleared.");
                    }}
                  >
                    <SettingsIcon className="h-4 w-4" />
                    Clear
                  </button>
                </div>
              </form>
            </div>

            <div className={`${card} p-5`}>
              <p className={labelClass}>Track</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-100">Order ID</h3>
              <div className="mt-4 space-y-4">
                <label className="space-y-2">
                  <span className={labelClass}>Manual add</span>
                  <input
                    className={inputClass}
                    value={orderIdToTrack}
                    onChange={(event) => setOrderIdToTrack(event.target.value)}
                    placeholder="Enter order ID"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={`${actionButtonBase} border-sky-400/60 bg-sky-400 px-4 py-2.5 font-semibold text-slate-950 hover:bg-sky-300`}
                    type="button"
                    onClick={trackOrderManually}
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add
                  </button>
                  <Link
                    className={`${actionButtonBase} border-slate-700 bg-slate-950/60 px-4 py-2.5 text-slate-200 hover:border-sky-400/40 hover:bg-slate-800`}
                    to="/orders"
                  >
                    <SearchIcon className="h-4 w-4" />
                    Lookup
                  </Link>
                </div>
              </div>
            </div>

            <div className={`${card} p-5`}>
              <p className={labelClass}>Services</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SERVICE_OPTIONS.map((service) => (
                  <span
                    key={service.value}
                    className="inline-flex rounded-[3px] border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-300"
                  >
                    {service.title}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className={`${card} overflow-hidden`}>
          <div className="border-b border-slate-700/70 px-5 py-4">
            <p className={labelClass}>Management</p>
            <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-100">Queue</h3>
          </div>

          <div className="overflow-auto">
            <table className="min-w-[860px] w-full border-collapse">
              <thead className="bg-slate-950/40">
                <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  <th className="px-5 py-4 font-semibold">Order</th>
                  <th className="px-5 py-4 font-semibold">Service</th>
                  <th className="px-5 py-4 font-semibold">Amount</th>
                  <th className="px-5 py-4 font-semibold">Status</th>
                  <th className="px-5 py-4 font-semibold">Cost</th>
                  <th className="px-5 py-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.length ? (
                  orders.map((order) => (
                    <tr key={order.uniqid} className="border-t border-slate-800/80">
                      <td className="px-5 py-4 align-top">
                        <strong className="block text-sm font-semibold text-slate-100">{order.uniqid}</strong>
                        <span className="mt-1 block text-sm text-slate-500">{order.serverId || "No server ID"}</span>
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">{order.service}</td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">{order.amount}</td>
                      <td className="px-5 py-4 align-top">
                        <span className={badgeClass(order.status)}>{order.status ?? "NEW"}</span>
                        {order.details ? <div className="mt-2 text-sm text-slate-500">{order.details}</div> : null}
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">
                        {typeof order.cost === "number" ? `$${formatNumber(order.cost)}` : "-"}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            className={`${actionButtonBase} border-slate-700 bg-slate-950/60 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-200 hover:border-sky-400/40 hover:bg-slate-800`}
                            to={`/orders?uniqid=${encodeURIComponent(order.uniqid)}`}
                          >
                            <LinkIcon className="h-3.5 w-3.5" />
                            Open
                          </Link>
                          <button
                            className={`${actionButtonBase} border-slate-700 bg-slate-950/60 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-200 hover:border-sky-400/40 hover:bg-slate-800`}
                            type="button"
                            onClick={() => navigator.clipboard.writeText(order.uniqid)}
                          >
                            <CopyIcon className="h-3.5 w-3.5" />
                            Copy
                          </button>
                          <button
                            className={`${actionButtonBase} border-slate-700 bg-slate-950/60 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-200 hover:border-sky-400/40 hover:bg-slate-800`}
                            type="button"
                            onClick={() => persistOrders(orders.filter((item) => item.uniqid !== order.uniqid))}
                          >
                            <PlusIcon className="h-3.5 w-3.5 rotate-45" />
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                      No tracked orders yet.
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
