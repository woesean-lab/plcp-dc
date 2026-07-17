import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CircleDollarSign,
  CloudOff,
  Copy,
  ExternalLink,
  Hexagon,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  type LucideIcon
} from "lucide-react";
import { loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import { clearApiKey, getApiKey, setApiKey } from "../lib/auth";
import { normalizeAdminTab } from "../lib/navigation";
import { checkAvailableAmount, createOrder, getBalance } from "../lib/tokenu";
import type { ServiceType, TrackedOrder } from "../types";

const SERVICE_OPTIONS: Array<{ value: ServiceType; title: string; description: string; icon: LucideIcon }> = [
  { value: "OAUTH-OFFLINE", title: "OAuth Offline", description: "Persistent authorization", icon: CloudOff },
  { value: "OAUTH-ONLINE", title: "OAuth Online", description: "Live authorization", icon: Radio },
  { value: "OAUTH-PREMIUM", title: "OAuth Premium", description: "Priority authorization", icon: Sparkles },
  { value: "OAUTH-NFT", title: "OAuth NFT", description: "Token-based authorization", icon: Hexagon }
];

const EMPTY_FORM = {
  service: "OAUTH-ONLINE" as ServiceType,
  serverId: "",
  amount: 100,
  delay: 1,
  billingCycle: 1
};

const labelClass = "app-kicker";
const fieldLabelClass = "field-label";
const shell = "app-panel";

function formatNumber(value?: number) {
  return typeof value === "number" && !Number.isNaN(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    : "—";
}

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const activeTab = normalizeAdminTab(searchParams.get("tab"));

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
    if (getApiKey()) void refreshBalance();
    // The initial connection check runs once; saves refresh explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMessage("");
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "create") return;

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
  }, [activeTab, form.service, form.serverId]);

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
      setMessage(`Order created: ${created.uniqid}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Order could not be created.");
    } finally {
      setCreating(false);
    }
  }

  function trackOrderManually() {
    const uniqid = orderIdToTrack.trim();
    if (!uniqid) {
      setMessage("Order ID is required.");
      return;
    }

    if (orders.some((order) => order.uniqid === uniqid)) {
      setMessage("Order is already tracked.");
      return;
    }

    persistOrders([
      {
        uniqid,
        createdAt: new Date().toISOString(),
        status: "NEW"
      },
      ...orders
    ]);
    setOrderIdToTrack("");
    setMessage("Order added.");
  }

  const showOverlay = saving || loadingBalance;
  const feedback = message ? (
    <div className="app-panel-soft app-notice px-4 py-3 text-sm text-[var(--app-text-secondary)]" role="status" aria-live="polite">
      {message}
    </div>
  ) : null;

  return (
    <div className="relative">
      {showOverlay ? (
        <div className="app-overlay" role="status" aria-live="polite">
          <div className="app-preloader">
            <div className="app-spinner" />
            <div>
              <p className="app-kicker">Secure sync</p>
              <p className="mt-2 text-sm text-[var(--app-muted)]">Refreshing your private workspace</p>
            </div>
            <div className="app-progress" aria-hidden="true">
              <span />
            </div>
          </div>
        </div>
      ) : null}

      <div key={activeTab} className="space-y-5 tab-slide-in">
        {activeTab === "create" ? (
          <>
            <header className="page-heading">
              <div>
                <p className={labelClass}>Create</p>
                <h1 className="page-title">New order</h1>
                <p className="app-copy page-copy">Choose a service and configure the delivery details.</p>
              </div>
              <Badge variant={storedApiKey ? "success" : "destructive"}>{storedApiKey ? "API connected" : "API key required"}</Badge>
            </header>

            {feedback}

            <section className={`${shell} p-5 sm:p-6`}>
              <div className="mb-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true">
                    <Plus className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Order setup</p>
                    <h2 className="app-title mt-1 text-xl font-semibold">Configure order</h2>
                  </div>
                </div>
                <Badge variant="default">Primary action</Badge>
              </div>

              <form onSubmit={handleCreateOrder} className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <fieldset className="md:col-span-2">
                    <legend className={`${fieldLabelClass} mb-2`}>Service</legend>
                    <div className="service-grid">
                      {SERVICE_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const selected = form.service === option.value;

                        return (
                          <label key={option.value} className={`service-option ${selected ? "is-selected" : ""}`}>
                            <input
                              className="sr-only"
                              type="radio"
                              name="service"
                              value={option.value}
                              checked={selected}
                              onChange={() => setForm((current) => ({ ...current, service: option.value }))}
                            />
                            <span className="service-option-icon" aria-hidden="true">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="service-option-title">{option.title}</span>
                              <span className="service-option-code">{option.description}</span>
                            </span>
                            <span className="service-option-dot" aria-hidden="true" />
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  <label className="space-y-2 md:col-span-2">
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
                      onChange={(event) => setForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))}
                    />
                  </label>

                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Delay</span>
                    <Input
                      type="number"
                      min={1}
                      max={1200}
                      value={form.delay}
                      onChange={(event) => setForm((current) => ({ ...current, delay: Number(event.target.value) || 1 }))}
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
                      onChange={(event) => setForm((current) => ({ ...current, billingCycle: Number(event.target.value) || 1 }))}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button className="min-w-[150px] px-4 py-2.5 max-sm:w-full" type="submit" disabled={creating || !storedApiKey}>
                    {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    {creating ? "Creating..." : "Create order"}
                  </Button>
                  {!storedApiKey ? (
                    <Button asChild variant="secondary" className="max-sm:w-full">
                      <Link to="/admin?tab=settings">
                        <Settings2 className="h-4 w-4" aria-hidden="true" />
                        Configure API key
                      </Link>
                    </Button>
                  ) : null}
                </div>

                {availability ? (
                  <div className="app-panel-soft px-4 py-3 text-sm text-[var(--app-text-secondary)]" role="status" aria-live="polite">
                    {availability}
                  </div>
                ) : checkingAvailability ? (
                  <div className="app-panel-soft px-4 py-3">
                    <div className="app-skeleton app-skeleton-line w-32" />
                  </div>
                ) : null}
              </form>
            </section>
          </>
        ) : null}

        {activeTab === "manage" ? (
          <>
            <header className="page-heading">
              <div>
                <p className={labelClass}>Manage</p>
                <h1 className="page-title">Order queue</h1>
                <p className="app-copy page-copy">Review tracked orders and add an existing order to your local queue.</p>
              </div>
              <div className="page-heading-meta">
                <Badge variant="outline">{orders.length} tracked</Badge>
                <Badge variant="secondary">{activeOrders.length} active</Badge>
              </div>
            </header>

            {feedback}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
              <section className={`${shell} overflow-hidden`}>
                <div className="flex items-center gap-3 border-b border-[var(--app-divider)] px-5 py-5 sm:px-6">
                  <span className="stat-icon" aria-hidden="true">
                    <ListChecks className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Local queue</p>
                    <h2 className="app-title mt-1 text-lg font-semibold">Tracked orders</h2>
                  </div>
                </div>

                {orders.length ? (
                  <div className="overflow-auto">
                    <table className="w-full min-w-[860px] border-collapse">
                      <thead className="sticky top-0 z-10 bg-[var(--app-table-head)]">
                        <tr className="text-left text-[11px] uppercase tracking-[0.18em] text-[var(--app-subtle)]">
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
                          <tr key={order.uniqid} className="border-t border-[var(--app-divider)]">
                            <td className="px-5 py-4 align-top">
                              <strong className="block font-mono text-sm font-semibold text-[var(--app-text)]">{order.uniqid}</strong>
                              <span className="mt-1 block text-sm text-[var(--app-subtle)]">{order.serverId || "Manually tracked"}</span>
                            </td>
                            <td className="px-5 py-4 align-top text-sm text-[var(--app-text-secondary)]">{order.service ?? "—"}</td>
                            <td className="px-5 py-4 align-top text-sm text-[var(--app-text-secondary)]">
                              {typeof order.amount === "number" ? order.amount : "—"}
                            </td>
                            <td className="px-5 py-4 align-top">
                              <Badge
                                variant={
                                  String(order.status ?? "").toLowerCase().includes("completed")
                                    ? "success"
                                    : ["error", "invalid", "terminated"].some((value) =>
                                        String(order.status ?? "").toLowerCase().includes(value)
                                      )
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {order.status ?? "NEW"}
                              </Badge>
                              {order.details ? <div className="mt-2 text-sm text-[var(--app-subtle)]">{order.details}</div> : null}
                            </td>
                            <td className="px-5 py-4 align-top text-sm text-[var(--app-text-secondary)]">
                              {typeof order.cost === "number" ? `$${formatNumber(order.cost)}` : "—"}
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
                      <p className="mt-4 text-sm font-medium text-[var(--app-text-secondary)]">No tracked orders yet</p>
                      <p className="app-copy mt-1 text-sm">Create an order or add an existing ID.</p>
                    </div>
                  </div>
                )}
              </section>

              <aside className={`${shell} p-5 sm:p-6 xl:sticky xl:top-[108px]`}>
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true">
                    <Search className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Manual tracking</p>
                    <h2 className="app-title mt-1 text-lg font-semibold">Add order ID</h2>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Order ID</span>
                    <Input
                      value={orderIdToTrack}
                      onChange={(event) => setOrderIdToTrack(event.target.value)}
                      placeholder="Enter order ID"
                      className="font-mono"
                    />
                  </label>
                  <Button className="w-full" type="button" onClick={trackOrderManually}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add to queue
                  </Button>
                  <Button asChild variant="ghost" className="w-full">
                    <Link to="/orders">
                      <Search className="h-4 w-4" aria-hidden="true" />
                      Open public lookup
                    </Link>
                  </Button>
                </div>
              </aside>
            </div>
          </>
        ) : null}

        {activeTab === "settings" ? (
          <>
            <header className="page-heading">
              <div>
                <p className={labelClass}>Settings</p>
                <h1 className="page-title">Tokenu connection</h1>
                <p className="app-copy page-copy">Manage the API key and connection details for this browser.</p>
              </div>
              <Badge variant={storedApiKey ? "success" : "destructive"}>{storedApiKey ? "Connected" : "Not connected"}</Badge>
            </header>

            {feedback}

            <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
              <section className={`${shell} p-5 sm:p-6`}>
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Secure access</p>
                    <h2 className="app-title mt-1 text-lg font-semibold">Tokenu API key</h2>
                  </div>
                </div>
                <p className="app-copy mt-4 max-w-2xl text-sm leading-6">
                  The key is stored locally in this browser and is never included in the application source.
                </p>

                <form onSubmit={handleSaveApiKey} className="mt-6 space-y-5">
                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Local API key</span>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKeyValue(event.target.value)}
                      placeholder="Paste API key"
                      autoComplete="off"
                    />
                  </label>

                  <div className="flex flex-wrap gap-3">
                    <Button className="min-w-[132px] max-sm:w-full" type="submit" disabled={saving}>
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      {saving ? "Saving..." : "Save key"}
                    </Button>
                    <Button
                      className="min-w-[132px] max-sm:w-full"
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        clearApiKey();
                        setApiKeyValue("");
                        setBalance(null);
                        setMessage("API key cleared.");
                      }}
                    >
                      Clear key
                    </Button>
                  </div>
                </form>
              </section>

              <aside className={`${shell} p-5 sm:p-6`}>
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true">
                    <Settings2 className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Connection</p>
                    <h2 className="app-title mt-1 text-lg font-semibold">Status</h2>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <div className="settings-status-row">
                    <span className="stat-icon" aria-hidden="true">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="settings-status-label">API key</span>
                      <strong>{storedApiKey ? "Ready" : "Missing"}</strong>
                    </span>
                  </div>
                  <div className="settings-status-row">
                    <span className="stat-icon" aria-hidden="true">
                      <CircleDollarSign className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="settings-status-label">Balance</span>
                      <strong>{balance === null ? "Not synced" : `$${formatNumber(balance)}`}</strong>
                    </span>
                  </div>
                  <div className="settings-status-row">
                    <span className="stat-icon" aria-hidden="true">
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="settings-status-label">Storage</span>
                      <strong>Local browser only</strong>
                    </span>
                  </div>
                </div>

                <Button className="mt-5 w-full" variant="secondary" type="button" onClick={refreshBalance} disabled={!storedApiKey || loadingBalance}>
                  <RefreshCw className={`h-4 w-4 ${loadingBalance ? "animate-spin" : ""}`} aria-hidden="true" />
                  Refresh balance
                </Button>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
