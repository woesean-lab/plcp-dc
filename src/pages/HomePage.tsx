import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity,
  CircleDollarSign,
  Copy,
  ExternalLink,
  KeyRound,
  Layers3,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
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

const inputClass = "app-input";

const labelClass = "app-kicker";
const fieldLabelClass = "field-label";

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "manage" ? "manage" : "create";

  const [apiKey, setApiKeyValue] = useState(getApiKey());
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
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
    if (storedApiKey) void refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedApiKey]);

  useEffect(() => {
    if (!form.serverId.trim()) {
      setAvailability("");
      setCheckingAvailability(false);
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
      setCheckingAvailability(true);
      const data = await checkAvailableAmount(form.service, form.serverId);
      setAvailability(`Available ${data.available} / max ${data.maximum}`);
    } catch {
      setAvailability("");
    } finally {
      setCheckingAvailability(false);
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
    setCreating(true);

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
    } finally {
      setCreating(false);
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

  const shell = "app-panel";
  const showOverlay = saving || loadingBalance;

  return (
    <div className="relative space-y-5">
      {showOverlay ? (
        <div className="app-overlay" role="status" aria-live="polite">
          <div className="app-preloader">
            <div className="app-spinner" />
            <div>
              <p className="app-kicker">Secure sync</p>
              <p className="mt-2 text-sm text-slate-300">Refreshing your private workspace</p>
            </div>
            <div className="app-progress" aria-hidden="true"><span /></div>
          </div>
        </div>
      ) : null}

      <div key={activeTab} className="space-y-5 tab-slide-in">
        <section className={`${shell} hero-panel tab-slide-in p-5 sm:p-7 lg:p-8`}>
          <div className="grid gap-8 xl:grid-cols-[1.08fr_0.92fr] xl:items-stretch">
            <div className="hero-copy flex min-h-[280px] flex-col justify-between">
              <div>
                <span className="hero-status">System online</span>
                <p className={`${labelClass} mt-7`}>Member operations</p>
                <h1 className="app-title hero-title mt-3">Orders, refined.</h1>
                <p className="app-copy mt-5 max-w-xl text-[15px] leading-7">
                  Create, organize, and monitor every order from one private workspace designed for focused operations.
                </p>
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <span className="app-chip">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                  Local-first security
                </span>
                <span className="text-xs font-medium text-slate-500">Your API key stays in this browser.</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="app-stat flex flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <span className={labelClass}>Balance</span>
                  <span className="stat-icon" aria-hidden="true">
                    <CircleDollarSign className="h-4 w-4" />
                  </span>
                </div>
                <div>
                  <strong className="block text-[1.65rem] font-semibold tracking-[-0.04em] text-[#f7f5ef]">
                    {balance === null ? "—" : `$${formatNumber(balance)}`}
                  </strong>
                  <span className="mt-1 block text-xs text-slate-500">Available credit</span>
                </div>
              </div>
              <div className="app-stat flex flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <span className={labelClass}>Tracked</span>
                  <span className="stat-icon" aria-hidden="true">
                    <Layers3 className="h-4 w-4" />
                  </span>
                </div>
                <div>
                  <strong className="block text-[1.65rem] font-semibold tracking-[-0.04em] text-[#f7f5ef]">{orders.length}</strong>
                  <span className="mt-1 block text-xs text-slate-500">Saved orders</span>
                </div>
              </div>
              <div className="app-stat flex flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <span className={labelClass}>Active</span>
                  <span className="stat-icon" aria-hidden="true">
                    <Activity className="h-4 w-4" />
                  </span>
                </div>
                <div>
                  <strong className="block text-[1.65rem] font-semibold tracking-[-0.04em] text-[#f7f5ef]">{activeOrders.length}</strong>
                  <span className="mt-1 block text-xs text-slate-500">In progress</span>
                </div>
              </div>
              <div className="app-stat flex flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <span className={labelClass}>API key</span>
                  <span className="stat-icon" aria-hidden="true">
                    <KeyRound className="h-4 w-4" />
                  </span>
                </div>
                <div>
                  <strong className="block text-[1.35rem] font-semibold tracking-[-0.03em] text-[#f7f5ef]">
                    {storedApiKey ? "Connected" : "Missing"}
                  </strong>
                  <span className="mt-1 block text-xs text-slate-500">Local vault</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {message ? (
          <div className="app-panel-soft app-notice px-4 py-3 text-sm text-slate-300" role="status" aria-live="polite">
            {message}
          </div>
        ) : null}

        {activeTab === "create" ? (
        <section className="tab-slide-in grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <div id="create-order" className={`${shell} p-5 sm:p-6`}>
              <div className="mb-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true">
                    <Plus className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Order setup</p>
                    <h2 className="app-title mt-1 text-xl font-semibold">Create a new order</h2>
                  </div>
                </div>
                <Badge variant="default">Primary</Badge>
              </div>

            <form onSubmit={handleCreateOrder} className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Service</span>
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
                    <span className={fieldLabelClass}>Server ID</span>
                    <Input
                      value={form.serverId}
                      onChange={(event) => setForm((current) => ({ ...current, serverId: event.target.value }))}
                      placeholder="Discord server ID"
                      required
                    />
                  </label>

                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Amount</span>
                    <Input
                      type="number"
                      min={1}
                      value={form.amount}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))
                      }
                    />
                  </label>

                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Delay</span>
                    <Input
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
                    <span className={fieldLabelClass}>Billing cycle</span>
                    <Input
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

                <div className="mt-6 flex flex-wrap gap-3">
                  <Button className="min-w-[150px] px-4 py-2.5" type="submit" disabled={creating}>
                    {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    {creating ? "Creating..." : "Create order"}
                  </Button>
                  <Button className="min-w-[150px] px-4 py-2.5" variant="secondary" type="button" onClick={refreshBalance}>
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    Refresh balance
                  </Button>
                </div>

                {availability ? (
                  <div className="app-panel-soft px-4 py-3 text-sm text-slate-300" role="status" aria-live="polite">{availability}</div>
                ) : checkingAvailability ? (
                  <div className="app-panel-soft px-4 py-3">
                    <div className="app-skeleton app-skeleton-line w-32" />
                  </div>
                ) : null}
              </form>
          </div>

          <div className="space-y-4">
            <div className={`${shell} p-5 sm:p-6`}>
              <div className="flex items-center gap-3">
                <span className="stat-icon" aria-hidden="true">
                  <KeyRound className="h-4 w-4" />
                </span>
                <div>
                  <p className={labelClass}>Secure access</p>
                  <h2 className="app-title mt-1 text-lg font-semibold">Tokenu API</h2>
                </div>
              </div>
              <form onSubmit={handleSaveApiKey} className="mt-4 space-y-6">
                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Local key</span>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKeyValue(event.target.value)}
                      placeholder="Paste API key"
                      autoComplete="off"
                    />
                  </label>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button className="min-w-[132px] px-4 py-2.5" type="submit" disabled={saving}>
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      className="min-w-[132px] px-4 py-2.5"
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        clearApiKey();
                        setApiKeyValue("");
                        setBalance(null);
                        setMessage("API key cleared.");
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </form>
            </div>

            <div className={`${shell} p-5 sm:p-6`}>
              <div className="flex items-center gap-3">
                <span className="stat-icon" aria-hidden="true">
                  <Search className="h-4 w-4" />
                </span>
                <div>
                  <p className={labelClass}>Quick access</p>
                  <h2 className="app-title mt-1 text-lg font-semibold">Track an order</h2>
                </div>
              </div>
              <div className="mt-4 space-y-5">
                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Manual add</span>
                    <Input
                      value={orderIdToTrack}
                      onChange={(event) => setOrderIdToTrack(event.target.value)}
                      placeholder="Enter order ID"
                    />
                  </label>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button className="min-w-[132px] px-4 py-2.5" type="button" onClick={trackOrderManually}>
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Add
                    </Button>
                    <Button asChild variant="ghost" className="min-w-[132px] px-4 py-2.5">
                      <Link to="/orders">
                        <Search className="h-4 w-4" aria-hidden="true" />
                        Lookup
                      </Link>
                    </Button>
                  </div>
                </div>
            </div>
          </div>
        </section>
        ) : null}

        {activeTab === "manage" ? (
        <section className={shell + " tab-slide-in overflow-hidden"}>
          <div className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="stat-icon" aria-hidden="true">
                <ListChecks className="h-4 w-4" />
              </span>
              <div>
                <p className={labelClass}>Management</p>
                <h2 className="app-title mt-1 text-xl font-semibold">Order queue</h2>
              </div>
            </div>
            <Badge variant="outline">{orders.length} tracked</Badge>
          </div>

          {orders.length ? (
            <div className="overflow-auto">
              <table className="min-w-[860px] w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-[#101620ed]">
                  <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    <th className="px-5 py-4 font-semibold">Order</th>
                    <th className="px-5 py-4 font-semibold">Service</th>
                    <th className="px-5 py-4 font-semibold">Amount</th>
                    <th className="px-5 py-4 font-semibold">Status</th>
                    <th className="px-5 py-4 font-semibold">Cost</th>
                    <th className="px-5 py-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.uniqid} className="border-t border-white/[0.07]">
                      <td className="px-5 py-4 align-top">
                        <strong className="block font-mono text-sm font-semibold text-[#f7f5ef]">{order.uniqid}</strong>
                        <span className="mt-1 block text-sm text-slate-500">{order.serverId || "No server ID"}</span>
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">{order.service}</td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">{order.amount}</td>
                      <td className="px-5 py-4 align-top">
                        <Badge variant={String(order.status ?? "").toLowerCase().includes("completed") ? "success" : ["error", "invalid", "terminated"].some((value) => String(order.status ?? "").toLowerCase().includes(value)) ? "destructive" : "secondary"}>
                          {order.status ?? "NEW"}
                        </Badge>
                        {order.details ? <div className="mt-2 text-sm text-slate-500">{order.details}</div> : null}
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">
                        {typeof order.cost === "number" ? `$${formatNumber(order.cost)}` : "-"}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Button asChild variant="secondary" size="xs" className="px-3 text-[10px] uppercase tracking-[0.12em]">
                            <Link to={`/orders?uniqid=${encodeURIComponent(order.uniqid)}`}>
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Open
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            className="px-3 text-[10px] uppercase tracking-[0.12em]"
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(order.uniqid).then(() => setMessage("Order ID copied."));
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            Copy
                          </Button>
                          <Button
                            variant="destructive"
                            size="xs"
                            className="px-3 text-[10px] uppercase tracking-[0.12em]"
                            type="button"
                            onClick={() => persistOrders(orders.filter((item) => item.uniqid !== order.uniqid))}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid min-h-56 place-items-center px-5 py-10 text-center">
              <div>
                <span className="stat-icon mx-auto" aria-hidden="true">
                  <ListChecks className="h-4 w-4" />
                </span>
                <p className="mt-4 text-sm font-medium text-slate-300">No tracked orders yet</p>
                <p className="app-copy mt-1 text-sm">Create an order to start your private queue.</p>
              </div>
            </div>
          )}
        </section>
        ) : null}
      </div>
    </div>
  );
}
