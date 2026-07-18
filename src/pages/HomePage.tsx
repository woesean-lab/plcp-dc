import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import toast from "react-hot-toast";
import {
  CircleDollarSign,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import { clearApiKey, getApiKey, setApiKey } from "../lib/auth";
import { resolveDiscordGuildId } from "../lib/discord";
import { buildGuestOrderLink } from "../lib/order-links";
import { normalizeAdminTab, type AdminTab } from "../lib/navigation";
import { SERVICE_OPTIONS } from "../lib/services";
import { checkAvailableAmount, createOrder, getBalance, getOrderStatus, updateOrderDelay } from "../lib/tokenu";
import type { OrderStatusResponse, ServiceType, TrackedOrder } from "../types";

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
const PAGE_SKELETON_DELAY = 300;

function formatNumber(value?: number) {
  return typeof value === "number" && !Number.isNaN(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    : "—";
}

function formatTrackedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function getServiceLabel(service?: ServiceType) {
  return SERVICE_OPTIONS.find((option) => option.value === service)?.title ?? "—";
}

function formatDelay(value?: number) {
  return typeof value === "number" && !Number.isNaN(value) ? `${formatNumber(value)}s` : "—";
}

function notifySuccess(message: string) {
  toast.success(message);
}

function notifyError(message: string) {
  toast.error(message);
}

function parseDelay(value?: string | number) {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getOrderStatusVariant(status?: string): "success" | "destructive" | "secondary" {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("completed")) return "success";
  if (["error", "invalid", "terminated", "canceled", "cancelled"].some((value) => normalized.includes(value))) {
    return "destructive";
  }
  return "secondary";
}

function getOrderStatusTone(status?: string): "active" | "success" | "danger" {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("completed")) return "success";
  if (["error", "invalid", "terminated", "canceled", "cancelled"].some((value) => normalized.includes(value))) {
    return "danger";
  }
  return "active";
}

function isTerminalOrder(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized.includes("completed") || normalized.includes("canceled") || normalized.includes("cancelled");
}

function getOrderProgress(order: TrackedOrder) {
  if (typeof order.amount !== "number") {
    return null;
  }

  const inferredUsed =
    typeof order.added === "number"
      ? order.added
      : String(order.status ?? "").toUpperCase() === "COMPLETED"
        ? order.amount
        : 0;
  const used = Math.max(inferredUsed, 0);
  const total = Math.max(order.amount, 0);
  const clampedUsed = Math.min(used, total);
  const remaining = Math.max(total - clampedUsed, 0);

  return {
    used: clampedUsed,
    total,
    remaining
  };
}

function TimedReveal({ children, fallback, delay = PAGE_SKELETON_DELAY }: { children: ReactNode; fallback: ReactNode; delay?: number }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  return ready ? children : fallback;
}

function SkeletonHeading({ withMeta = true }: { withMeta?: boolean }) {
  return (
    <header className="page-heading" aria-hidden="true">
      <div className="w-full max-w-2xl">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-3 h-9 w-52 max-w-[70%]" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </div>
      {withMeta ? <Skeleton className="h-6 w-28 shrink-0" /> : null}
    </header>
  );
}

function SkeletonField({ className = "" }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-11 w-full" />
    </div>
  );
}

function HomePageSkeleton({ tab }: { tab: AdminTab }) {
  const loadingLabel = tab === "create" ? "create order" : tab === "manage" ? "order management" : "settings";

  return (
    <section className="space-y-5 tab-slide-in" role="status" aria-live="polite" aria-busy="true" aria-label={`Loading ${loadingLabel}`}>
      <span className="sr-only">Loading {loadingLabel}</span>
      <SkeletonHeading />

      {tab === "create" ? (
        <div className={`${shell} p-5 sm:p-6`} aria-hidden="true">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 shrink-0" />
            <div className="w-full max-w-52">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-5 w-36" />
            </div>
          </div>
          <div className="mt-6 grid gap-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="app-panel-soft p-4">
                  <Skeleton className="h-8 w-8" />
                  <Skeleton className="mt-3 h-4 w-24 max-w-full" />
                  <Skeleton className="mt-2 h-3 w-32 max-w-full" />
                </div>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <SkeletonField className="md:col-span-2" />
              <SkeletonField />
              <SkeletonField />
              <SkeletonField className="md:col-span-2" />
            </div>
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      ) : null}

      {tab === "manage" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start" aria-hidden="true">
          <div className={`${shell} overflow-hidden`}>
            <div className="flex items-center gap-3 border-b border-[var(--app-divider)] p-5 sm:px-6">
              <Skeleton className="h-8 w-8 shrink-0" />
              <div className="w-44 max-w-full">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2 h-5 w-36" />
              </div>
            </div>
            <div className="tracked-order-list tracked-order-list-skeleton">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="tracked-order-card">
                  <div className="tracked-order-identity">
                    <div className="tracked-order-eyebrow">
                      <Skeleton className="h-2.5 w-14" />
                      <Skeleton className="h-6 w-16" />
                    </div>
                    <Skeleton className="mt-3 h-4 w-40 max-w-full" />
                    <Skeleton className="mt-2 h-3 w-28 max-w-full" />
                  </div>
                  <div className="tracked-order-service">
                    <Skeleton className="h-10 w-10 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <Skeleton className="h-2.5 w-12" />
                      <Skeleton className="mt-2 h-4 w-24 max-w-full" />
                      <Skeleton className="mt-2 h-2.5 w-20 max-w-full" />
                    </div>
                  </div>
                  <div className="tracked-order-metrics">
                    {Array.from({ length: 3 }).map((__, metricIndex) => (
                      <div key={metricIndex} className="tracked-order-metric">
                        <Skeleton className="h-2.5 w-10" />
                        <Skeleton className="mt-2 h-4 w-14 max-w-full" />
                      </div>
                    ))}
                  </div>
                  <div className="tracked-order-actions">
                    <Skeleton className="h-10 w-20" />
                    <Skeleton className="h-10 w-10" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={`${shell} p-5 sm:p-6`}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-36" />
            <SkeletonField className="mt-6" />
            <Skeleton className="mt-4 h-10 w-full" />
            <Skeleton className="mt-4 h-10 w-full" />
          </div>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr] lg:items-start" aria-hidden="true">
          <div className={`${shell} p-5 sm:p-6`}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-40" />
            <Skeleton className="mt-4 h-4 w-full max-w-lg" />
            <SkeletonField className="mt-6" />
            <div className="mt-5 flex gap-3">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
          <div className={`${shell} p-5 sm:p-6`}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-28" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="app-panel-soft flex items-center gap-3 p-3">
                  <Skeleton className="h-8 w-8 shrink-0" />
                  <div className="w-full">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-2 h-4 w-28" />
                  </div>
                </div>
              ))}
            </div>
            <Skeleton className="mt-5 h-10 w-full" />
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function HomePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const activeTab = normalizeAdminTab(searchParams.get("tab"));

  const [apiKey, setApiKeyValue] = useState(getApiKey());
  const [balance, setBalance] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [refreshingManage, setRefreshingManage] = useState(false);
  const [updatingDelayId, setUpdatingDelayId] = useState<string | null>(null);
  const [availability, setAvailability] = useState("");
  const [orders, setOrders] = useState<TrackedOrder[]>(() => loadTrackedOrders());
  const [form, setForm] = useState(EMPTY_FORM);
  const [orderIdToTrack, setOrderIdToTrack] = useState("");
  const [delayDrafts, setDelayDrafts] = useState<Record<string, string>>({});
  const [delaySyncLocks, setDelaySyncLocks] = useState<Record<string, number>>({});

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
    if (activeTab !== "manage" || !orders.some((order) => order.uniqid)) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void syncTrackedOrders();
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };

    async function syncTrackedOrders() {
      try {
        setSyncingOrders(true);

        const updates = await Promise.all(
          orders.map(async (order) => {
            if (!order.uniqid) return order;

            try {
              const status = await getOrderStatus(order.uniqid);
              return mergeTrackedOrder(order, status);
            } catch {
              return order;
            }
          })
        );

        if (cancelled) return;

        const changed = updates.some((nextOrder, index) => !areTrackedOrdersEqual(nextOrder, orders[index]));
        if (changed) {
          persistOrders(updates);
        }
      } finally {
        if (!cancelled) {
          setSyncingOrders(false);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, orders]);

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
      notifyError(error instanceof Error ? error.message : "Balance could not be loaded.");
    } finally {
      setLoadingBalance(false);
    }
  }

  async function refreshAvailability() {
    try {
      setCheckingAvailability(true);
      const serverId = await resolveDiscordGuildId(form.serverId);
      const data = await checkAvailableAmount(form.service, serverId);
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

  function updateLocalOrder(nextOrder: TrackedOrder) {
    const nextOrders = orders.map((order) => (order.uniqid === nextOrder.uniqid ? nextOrder : order));
    persistOrders(nextOrders);
  }

  function mergeTrackedOrder(order: TrackedOrder, status: OrderStatusResponse): TrackedOrder {
    const resolvedAmount = typeof status.amount === "number" ? status.amount : typeof status.quantity === "number" ? status.quantity : order.amount;
    const lockedUntil = delaySyncLocks[order.uniqid] ?? 0;
    const parsedStatusDelay = parseDelay(status.delay);
    const resolvedStatusDelay =
      Date.now() < lockedUntil && typeof order.statusDelay === "number"
        ? order.statusDelay
        : parsedStatusDelay ?? order.statusDelay;
    const resolvedAdded =
      typeof status.added === "number"
        ? status.added
        : String(status.status ?? "").toUpperCase() === "COMPLETED" && typeof resolvedAmount === "number"
          ? resolvedAmount
          : order.added;

    return {
      ...order,
      status: String(status.status ?? order.status ?? "NEW"),
      amount: typeof resolvedAmount === "number" ? resolvedAmount : order.amount,
      added: typeof resolvedAdded === "number" ? resolvedAdded : order.added,
      serverName: typeof status.serverName === "string" ? status.serverName : order.serverName,
      statusDelay: typeof resolvedStatusDelay === "number" ? resolvedStatusDelay : order.statusDelay,
      details: typeof status.details === "string" ? status.details : order.details
    };
  }

  function areTrackedOrdersEqual(a: TrackedOrder, b: TrackedOrder) {
    return (
      a.uniqid === b.uniqid &&
      a.status === b.status &&
      a.amount === b.amount &&
      a.added === b.added &&
      a.serverName === b.serverName &&
      a.statusDelay === b.statusDelay &&
      a.details === b.details &&
      a.cost === b.cost &&
      a.serverId === b.serverId &&
      a.service === b.service
    );
  }

  async function handleUpdateDelay(order: TrackedOrder) {
    const draft = delayDrafts[order.uniqid] ?? "";
    const delay = Number.parseInt(draft, 10);

    if (!Number.isFinite(delay) || delay <= 0) {
      notifyError("Delay must be a positive number.");
      return;
    }

    try {
      setUpdatingDelayId(order.uniqid);
      setDelaySyncLocks((current) => ({ ...current, [order.uniqid]: Date.now() + 7000 }));

      updateLocalOrder({
        ...order,
        statusDelay: delay
      });
      setDelayDrafts((current) => ({ ...current, [order.uniqid]: String(delay) }));

      await updateOrderDelay(order.uniqid, delay);
      notifySuccess(`Delay updated for ${order.uniqid}.`);
    } catch (error) {
      updateLocalOrder(order);
      notifyError(error instanceof Error ? error.message : "Delay could not be updated.");
    } finally {
      setUpdatingDelayId(null);
    }
  }

  async function refreshTrackedOrders() {
    if (!orders.some((order) => order.uniqid)) {
      notifyError("No tracked orders to refresh.");
      return;
    }

    try {
      setRefreshingManage(true);
      const updates = await Promise.all(
        orders.map(async (order) => {
          if (!order.uniqid) return order;

          try {
            const status = await getOrderStatus(order.uniqid);
            return mergeTrackedOrder(order, status);
          } catch {
            return order;
          }
        })
      );

      const changed = updates.some((nextOrder, index) => !areTrackedOrdersEqual(nextOrder, orders[index]));
      if (changed) {
        persistOrders(updates);
      }
      notifySuccess("Orders refreshed.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Orders could not be refreshed.");
    } finally {
      setRefreshingManage(false);
    }
  }

  async function copyGuestLink(order: TrackedOrder) {
    const link = buildGuestOrderLink(order);

    try {
      await navigator.clipboard.writeText(link);
      notifySuccess("Guest link copied.");
    } catch {
      notifyError("Guest link could not be copied.");
    }
  }

  async function handleSaveApiKey(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    try {
      const trimmed = apiKey.trim();
      if (trimmed) {
        setApiKey(trimmed);
        setApiKeyValue(trimmed);
        notifySuccess("API key saved.");
        await refreshBalance();
      } else {
        clearApiKey();
        notifySuccess("API key cleared.");
        setBalance(null);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Could not save API key.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateOrder(event: FormEvent) {
    event.preventDefault();
    setCreating(true);

    try {
      const serverId = await resolveDiscordGuildId(form.serverId);
      const created = await createOrder({
        service: form.service,
        id: serverId,
        amount: form.amount,
        delay: form.delay,
        billingCycle: form.service === "OAUTH-ONLINE" ? form.billingCycle : undefined
      });

      const nextOrder: TrackedOrder = {
        uniqid: created.uniqid,
        service: form.service,
        serverId,
        amount: form.amount,
        added: 0,
        delay: form.delay,
        billingCycle: form.service === "OAUTH-ONLINE" ? form.billingCycle : undefined,
        cost: created.cost,
        botInvite: created.bot_invite,
        createdAt: new Date().toISOString(),
        status: "NEW"
      };

      persistOrders([nextOrder, ...orders]);
      notifySuccess(`Order created: ${created.uniqid}`);
      navigate(`/orders?uniqid=${encodeURIComponent(created.uniqid)}`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Order could not be created.");
    } finally {
      setCreating(false);
    }
  }

  function trackOrderManually() {
    const uniqid = orderIdToTrack.trim();
    if (!uniqid) {
      notifyError("Order ID is required.");
      return;
    }

    if (orders.some((order) => order.uniqid === uniqid)) {
      notifyError("Order is already tracked.");
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
    notifySuccess("Order added.");
  }

  const showOverlay = saving;
  const showManageSkeleton = refreshingManage;

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

      <TimedReveal key={activeTab} fallback={<HomePageSkeleton tab={activeTab} />}>
        <div className="space-y-5 tab-slide-in">
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

            <section className={`${shell} p-5 sm:p-6`}>
              <div className="mb-6 flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true">
                    <Plus className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Order setup</p>
                    <h2 className="app-title mt-1 text-xl font-semibold">Configure order</h2>
                  </div>
                </div>
              </div>

              <form onSubmit={handleCreateOrder} className="grid gap-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <fieldset className="service-selector md:col-span-2">
                    <legend className="sr-only">Service</legend>
                    <div className="service-selector-heading">
                      <div>
                        <span className={fieldLabelClass}>Choose service</span>
                        <p className="service-selector-copy">Select the authorization mode for this order.</p>
                      </div>
                      <span className="service-selector-count">{SERVICE_OPTIONS.length} services</span>
                    </div>
                    <div className="service-grid">
                      {SERVICE_OPTIONS.map((option, index) => {
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
                            <span className="service-option-head" aria-hidden="true">
                              <span className="service-option-icon">
                                <Icon className="h-5 w-5" />
                              </span>
                              <span className="service-option-state">
                                {selected ? (
                                  <>
                                    <Check className="h-3 w-3" />
                                    Selected
                                  </>
                                ) : (
                                  String(index + 1).padStart(2, "0")
                                )}
                              </span>
                            </span>
                            <span className="service-option-title">{option.title}</span>
                            <span className="service-option-description">{option.description}</span>
                            <span className="service-option-code">{option.value}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  <label className="grid gap-2 md:col-span-2">
                    <span className={fieldLabelClass}>Server ID</span>
                    <Input
                      value={form.serverId}
                      onChange={(event) => setForm((current) => ({ ...current, serverId: event.target.value }))}
                      placeholder="Discord server ID or invite link"
                      required
                    />
                    <p className="text-xs text-[var(--app-muted)]">
                      Paste a Discord server ID, invite link, or invite code. Invite links are resolved automatically.
                    </p>
                  </label>

                  <label className="grid gap-2">
                    <span className={fieldLabelClass}>Amount</span>
                    <Input
                      type="number"
                      min={1}
                      value={form.amount}
                      onChange={(event) => setForm((current) => ({ ...current, amount: Number(event.target.value) || 0 }))}
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className={fieldLabelClass}>Delay</span>
                    <Input
                      type="number"
                      min={1}
                      max={1200}
                      value={form.delay}
                      onChange={(event) => setForm((current) => ({ ...current, delay: Number(event.target.value) || 1 }))}
                    />
                  </label>

                  {form.service === "OAUTH-ONLINE" ? (
                    <label className="grid gap-2 md:col-span-2">
                      <span className={fieldLabelClass}>Billing cycle</span>
                      <Input
                        type="number"
                        min={1}
                        max={12}
                        value={form.billingCycle}
                        onChange={(event) => setForm((current) => ({ ...current, billingCycle: Number(event.target.value) || 1 }))}
                      />
                    </label>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button className="min-w-[150px] px-4 py-2.5 max-sm:w-full" type="submit" disabled={creating || !storedApiKey}>
                    {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    {creating ? "Creating..." : "Create order"}
                  </Button>
                  {!storedApiKey ? (
                    <Button asChild variant="secondary" className="max-sm:w-full">
                      <Link to="/manage?tab=settings">
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
          showManageSkeleton ? (
            <HomePageSkeleton tab="manage" />
          ) : (
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
                {syncingOrders ? <Badge variant="secondary">Syncing...</Badge> : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => void refreshTrackedOrders()}
                  disabled={refreshingManage || syncingOrders || !orders.some((order) => order.uniqid)}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshingManage ? "animate-spin" : ""}`} aria-hidden="true" />
                  Refresh
                </Button>
              </div>
            </header>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
              <section className={`${shell} tracked-orders-panel overflow-hidden`}>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--app-divider)] px-5 py-4 sm:px-6">
                  <div className="flex items-center gap-3">
                    <span className="stat-icon" aria-hidden="true">
                      <ListChecks className="h-4 w-4" />
                    </span>
                    <div>
                      <p className={labelClass}>Local queue</p>
                      <h2 id="tracked-orders-title" className="app-title mt-1 text-lg font-semibold">Tracked orders</h2>
                    </div>
                  </div>
                  <span className="tracked-order-sorting">Sorted by newest</span>
                </div>

                {orders.length ? (
                  <ol className="tracked-order-list" aria-labelledby="tracked-orders-title">
                    {orders.map((order, index) => {
                      const serviceOption = SERVICE_OPTIONS.find((option) => option.value === order.service);
                      const ServiceIcon = serviceOption?.icon ?? KeyRound;
                      const orderTitleId = `tracked-order-${index}`;
                      const progress = getOrderProgress(order);
                      const completed = isTerminalOrder(order.status);

                      return (
                        <li key={order.uniqid}>
                          <article
                            className="tracked-order-card"
                            data-status-tone={getOrderStatusTone(order.status)}
                            aria-labelledby={orderTitleId}
                          >
                            <div className="tracked-order-identity">
                              <div className="tracked-order-eyebrow">
                                <span>Order ID</span>
                                <Badge variant={getOrderStatusVariant(order.status)}>
                                  <span className="sr-only">Status: </span>
                                  {order.status ?? "NEW"}
                                </Badge>
                              </div>
                              <h3 id={orderTitleId} className="tracked-order-id">{order.uniqid}</h3>
                              <div className="tracked-order-context">
                                {order.serverName ? <span>{order.serverName}</span> : null}
                                <span>{order.serverId ? `ID ${order.serverId}` : "Added locally"}</span>
                              </div>
                              {order.details ? <p className="tracked-order-detail">{order.details}</p> : null}
                            </div>

                            <div className="tracked-order-service">
                              <span className="tracked-order-service-icon" aria-hidden="true">
                                <ServiceIcon className="h-4 w-4" />
                              </span>
                              <span className="min-w-0">
                                <span className="tracked-order-label">{serviceOption ? "Service" : "Tracking type"}</span>
                                <strong>{serviceOption?.title ?? "Manual entry"}</strong>
                                <span className="tracked-order-service-code">{order.service ?? "LOCAL QUEUE"}</span>
                              </span>
                            </div>

                            <dl className="tracked-order-metrics">
                              {typeof order.amount === "number" ? (
                                <div className="tracked-order-metric">
                                  <dt>Amount</dt>
                                  <dd>{formatNumber(order.amount)}</dd>
                                </div>
                              ) : null}
                              {!completed && typeof order.statusDelay === "number" ? (
                                <div className="tracked-order-metric">
                                  <dt>Delay</dt>
                                  <dd>{formatDelay(order.statusDelay)}</dd>
                                </div>
                              ) : null}
                              {progress ? (
                                <div className="tracked-order-metric">
                                  <dt>Users</dt>
                                  <dd className="grid gap-1">
                                    <span>{`${formatNumber(progress.used)}/${formatNumber(progress.total)}`}</span>
                                    <span className="text-xs text-[var(--app-muted)]">{`${formatNumber(progress.remaining)} left`}</span>
                                  </dd>
                                </div>
                              ) : null}
                              {typeof order.cost === "number" ? (
                                <div className="tracked-order-metric">
                                  <dt>Cost</dt>
                                  <dd>${formatNumber(order.cost)}</dd>
                                </div>
                              ) : null}
                              <div className="tracked-order-metric">
                                <dt>Added</dt>
                                <dd>
                                  <time dateTime={order.createdAt} title={order.createdAt}>{formatTrackedDate(order.createdAt)}</time>
                                </dd>
                              </div>
                            </dl>

                              <div className="tracked-order-actions" role="group" aria-label={`Actions for order ${order.uniqid}`}>
                              {!completed ? (
                                <div className="tracked-order-delay-control grid gap-2">
                                  <span className="tracked-order-label">Update delay</span>
                                  <div className="flex gap-2 max-sm:flex-col">
                                    <Input
                                      type="number"
                                      min={1}
                                      max={1200}
                                      value={delayDrafts[order.uniqid] ?? String(order.statusDelay ?? "")}
                                      onChange={(event) =>
                                        setDelayDrafts((current) => ({
                                          ...current,
                                          [order.uniqid]: event.target.value
                                        }))
                                      }
                                      placeholder="Delay"
                                      className="w-24 shrink-0"
                                    />
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="secondary"
                                      className="max-sm:w-full"
                                      disabled={updatingDelayId === order.uniqid}
                                      onClick={() => void handleUpdateDelay(order)}
                                    >
                                      {updatingDelayId === order.uniqid ? "Updating..." : "Update"}
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                title="Copy guest link"
                                onClick={() => void copyGuestLink(order)}
                              >
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                Copy link
                              </Button>
                              <Button asChild variant="secondary" size="sm" title="View order">
                                <Link
                                  to={`/orders?uniqid=${encodeURIComponent(order.uniqid)}`}
                                  aria-label={`View order ${order.uniqid}`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                  View
                                </Link>
                              </Button>
                              <Button
                                variant="dangerGhost"
                                size="icon"
                                type="button"
                                title="Remove from tracked orders"
                                aria-label={`Remove ${order.uniqid} from tracked orders`}
                                onClick={() => persistOrders(orders.filter((item) => item.uniqid !== order.uniqid))}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ol>
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

                <div className="mt-5 grid gap-4">
                  <label className="grid gap-2">
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
                  <Button asChild variant="secondary" className="w-full">
                    <Link to="/orders">
                      <Search className="h-4 w-4" aria-hidden="true" />
                      Open order lookup
                    </Link>
                  </Button>
                </div>
              </aside>
            </div>
            </>
          )
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

                <form onSubmit={handleSaveApiKey} className="mt-6 grid gap-5">
                  <label className="grid gap-2">
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
                      variant="destructive"
                      type="button"
                      onClick={() => {
                        clearApiKey();
                        setApiKeyValue("");
                        setBalance(null);
                        notifySuccess("API key cleared.");
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
                      {loadingBalance ? (
                        <Skeleton className="mt-2 h-4 w-24" aria-label="Loading balance" />
                      ) : (
                        <strong>{balance === null ? "Not synced" : `$${formatNumber(balance)}`}</strong>
                      )}
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
      </TimedReveal>
    </div>
  );
}
