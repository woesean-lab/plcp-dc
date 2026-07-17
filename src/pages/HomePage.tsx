import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

function PageSkeleton({ activeTab }: { activeTab: "create" | "manage" }) {
  return (
    <div className="space-y-5">
      <section className="app-panel p-6">
        <div className="grid gap-5 xl:grid-cols-[1.18fr_0.82fr] xl:items-stretch">
          <div className="flex min-h-[192px] flex-col justify-between gap-5">
            <div className="space-y-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-12 w-2/3 max-w-[24rem]" />
              <Skeleton className="h-4 w-full max-w-[34rem]" />
              <Skeleton className="h-4 w-4/5 max-w-[28rem]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="app-stat space-y-3">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {activeTab === "create" ? (
        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="app-panel p-5">
            <div className="space-y-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-32" />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-11 w-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-11 w-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-11 w-full" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-11 w-full" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-11 w-full" />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-4">
                <Skeleton className="h-10 w-36" />
                <Skeleton className="h-10 w-40" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="app-panel p-5">
              <div className="space-y-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-28" />
                <div className="space-y-3">
                  <Skeleton className="h-11 w-full" />
                  <div className="flex flex-wrap gap-4">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-10 w-24" />
                  </div>
                </div>
              </div>
            </div>

            <div className="app-panel p-5">
              <div className="space-y-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-28" />
                <div className="space-y-3">
                  <Skeleton className="h-11 w-full" />
                  <div className="flex flex-wrap gap-4">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-10 w-24" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="app-panel overflow-hidden">
          <div className="border-b border-white/8 px-5 py-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-7 w-32" />
          </div>
          <div className="overflow-auto px-5 py-4">
            <div className="min-w-[860px] space-y-3">
              <div className="grid grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-4 w-full" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, row) => (
                <div key={row} className="grid grid-cols-6 gap-3 border-t border-white/8 pt-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className={`h-4 ${index === 0 ? "w-32" : "w-full"}`} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

const inputClass = "app-input";

const labelClass = "app-kicker";
const fieldLabelClass = "text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500";

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") === "manage" ? "manage" : "create";
  const [tabSkeletonVisible, setTabSkeletonVisible] = useState(false);

  const [apiKey, setApiKeyValue] = useState(getApiKey());
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
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
    setTabSkeletonVisible(false);
    const showTimer = window.setTimeout(() => {
      setTabSkeletonVisible(true);
    }, 180);
    const hideTimer = window.setTimeout(() => {
      setTabSkeletonVisible(false);
    }, 540);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, [activeTab]);

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

  const shell = "app-panel";
  const showOverlay = saving || loadingBalance;
  const balanceLoading = loadingBalance && balance === null;
  const showCardSkeletons = tabSkeletonVisible || showOverlay || loadingBalance || saving;
  const showManageSkeleton = activeTab === "manage" && showCardSkeletons;

  return (
    <div className="relative space-y-5">
      {showOverlay ? (
        <div className="app-overlay">
          <div className="app-preloader">
            <div className="app-spinner" />
            <p className="app-kicker">Loading</p>
          </div>
        </div>
      ) : null}

      <div key={activeTab} className="space-y-5 tab-slide-in">
        <section className={`${shell} tab-slide-in p-6`}>
          <div className="grid min-h-[192px] gap-5 xl:grid-cols-[1.18fr_0.82fr] xl:items-stretch">
            <div className="flex min-h-[192px] flex-col justify-between">
            <div>
              <p className={labelClass}>Dashboard</p>
              <h2 className="app-title mt-3 text-[2.9rem] font-semibold leading-[1.01]">Orders and settings</h2>
              <p className="app-copy mt-3 max-w-2xl text-sm leading-6">
                Create orders, sync balance, and keep the queue visible from one clean control surface.
              </p>
            </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="app-stat">
              <span className={labelClass}>Balance</span>
              {showCardSkeletons ? (
                <div className="mt-2 space-y-2">
                  <div className="app-skeleton app-skeleton-line w-24" style={{ height: "1.15rem" }} />
                  <div className="app-skeleton app-skeleton-line w-16" />
                </div>
              ) : (
                <strong className="mt-2 block text-lg text-slate-50">
                  {balance === null ? "-" : `$${formatNumber(balance)}`}
                </strong>
              )}
            </div>
            <div className="app-stat">
              <span className={labelClass}>Tracked</span>
              {showCardSkeletons ? (
                <div className="mt-2 h-7 w-12 app-skeleton app-skeleton-line" />
              ) : (
                <strong className="mt-2 block text-lg text-slate-50">{orders.length}</strong>
              )}
            </div>
            <div className="app-stat">
              <span className={labelClass}>Active</span>
              {showCardSkeletons ? (
                <div className="mt-2 h-7 w-12 app-skeleton app-skeleton-line" />
              ) : (
                <strong className="mt-2 block text-lg text-slate-50">{activeOrders.length}</strong>
              )}
            </div>
            <div className="app-stat">
              <span className={labelClass}>API key</span>
              {showCardSkeletons ? (
                <div className="mt-2 space-y-2">
                  <div className="app-skeleton app-skeleton-line w-20" />
                  <div className="app-skeleton app-skeleton-line w-14" />
                </div>
              ) : (
                <strong className="mt-2 block text-lg text-slate-50">{storedApiKey ? "Ready" : "Missing"}</strong>
              )}
            </div>
            </div>
          </div>
        </section>

        {message ? <div className="app-panel px-4 py-3 text-sm text-slate-300">{message}</div> : null}

        {activeTab === "create" ? (
        <section className="tab-slide-in grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className={`${shell} p-5`}>
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className={labelClass}>Order</p>
                <h3 className="app-title mt-2 text-xl font-semibold">Create</h3>
              </div>
            </div>

            {showCardSkeletons ? (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <Skeleton className="h-10 w-36" />
                  <Skeleton className="h-10 w-40" />
                </div>
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
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

                <div className="mt-6 flex flex-wrap gap-4">
                  <Button className="min-w-[132px] px-4 py-2.5" type="submit">
                    Create order
                  </Button>
                  <Button className="min-w-[132px] px-4 py-2.5" variant="ghost" type="button" onClick={refreshBalance}>
                    Refresh balance
                  </Button>
                </div>

                {availability ? (
                  <div className="app-panel-soft px-4 py-3 text-sm text-slate-300">{availability}</div>
                ) : checkingAvailability ? (
                  <div className="app-panel-soft px-4 py-3">
                    <div className="app-skeleton app-skeleton-line w-32" />
                  </div>
                ) : null}
              </form>
            )}
          </div>

          <div className="space-y-4">
            <div className={`${shell} p-5`}>
              <p className={labelClass}>Key</p>
              <h3 className="app-title mt-2 text-lg font-semibold">Tokenu API</h3>
              {showCardSkeletons ? (
                <div className="mt-4 space-y-6">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-10 w-24" />
                  </div>
                </div>
              ) : (
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

                  <div className="mt-4 flex flex-wrap gap-4">
                    <Button className="min-w-[132px] px-4 py-2.5" type="submit" disabled={saving}>
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
              )}
            </div>

            <div className={`${shell} p-5`}>
              <p className={labelClass}>Track</p>
              <h3 className="app-title mt-2 text-lg font-semibold">Order ID</h3>
              {showCardSkeletons ? (
                <div className="mt-4 space-y-6">
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <Skeleton className="h-10 w-24" />
                    <Skeleton className="h-10 w-24" />
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-5">
                  <label className="space-y-2">
                    <span className={fieldLabelClass}>Manual add</span>
                    <Input
                      value={orderIdToTrack}
                      onChange={(event) => setOrderIdToTrack(event.target.value)}
                      placeholder="Enter order ID"
                    />
                  </label>
                  <div className="mt-4 flex flex-wrap gap-4">
                    <Button className="min-w-[132px] px-4 py-2.5" type="button" onClick={trackOrderManually}>
                      Add
                    </Button>
                    <Button asChild variant="ghost" className="min-w-[132px] px-4 py-2.5">
                      <Link to="/orders">Lookup</Link>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
        ) : null}

        {activeTab === "manage" ? (
        <section className={shell + " tab-slide-in overflow-hidden"}>
          <div className="border-b border-white/8 px-5 py-4">
            <p className={labelClass}>Management</p>
            <h3 className="app-title mt-2 text-xl font-semibold">Queue</h3>
          </div>

          {showManageSkeleton ? (
            <div className="overflow-auto px-5 py-5">
              <div className="min-w-[860px] space-y-4">
                <div className="grid grid-cols-6 gap-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-4 w-full" />
                  ))}
                </div>
                {Array.from({ length: 5 }).map((_, row) => (
                  <div key={row} className="grid grid-cols-6 gap-3 border-t border-white/8 pt-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-14" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                ))}
              </div>
            </div>
          ) : orders.length ? (
            <div className="overflow-auto">
              <table className="min-w-[860px] w-full border-collapse">
                <thead className="bg-white/5">
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
                    <tr key={order.uniqid} className="border-t border-white/8">
                      <td className="px-5 py-4 align-top">
                        <strong className="block text-sm font-semibold text-slate-50">{order.uniqid}</strong>
                        <span className="mt-1 block text-sm text-slate-500">{order.serverId || "No server ID"}</span>
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">{order.service}</td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">{order.amount}</td>
                      <td className="px-5 py-4 align-top">
                        <Badge variant={String(order.status ?? "").toLowerCase().includes("completed") ? "success" : String(order.status ?? "").toLowerCase().includes("error") ? "destructive" : "secondary"}>
                          {order.status ?? "NEW"}
                        </Badge>
                        {order.details ? <div className="mt-2 text-sm text-slate-500">{order.details}</div> : null}
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-slate-200">
                        {typeof order.cost === "number" ? `$${formatNumber(order.cost)}` : "-"}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Button asChild variant="ghost" className="px-3 py-2 text-xs uppercase tracking-[0.16em]">
                            <Link to={`/orders?uniqid=${encodeURIComponent(order.uniqid)}`}>Open</Link>
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-3 py-2 text-xs uppercase tracking-[0.16em]"
                            type="button"
                            onClick={() => navigator.clipboard.writeText(order.uniqid)}
                          >
                            Copy
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-3 py-2 text-xs uppercase tracking-[0.16em]"
                            type="button"
                            onClick={() => persistOrders(orders.filter((item) => item.uniqid !== order.uniqid))}
                          >
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
            <div className="px-5 py-10 text-sm text-slate-400">No tracked orders yet.</div>
          )}
        </section>
        ) : null}
      </div>
    </div>
  );
}
