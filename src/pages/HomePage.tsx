import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import toast from "react-hot-toast";
import {
  Bot,
  CircleDollarSign,
  Check,
  Copy,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  History,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import { extractBotInvite, getPlainDetails } from "../lib/bot-invite";
import { extractDiscordInviteCode, resolveDiscordGuildId, resolveDiscordGuildInfo } from "../lib/discord";
import { buildGuestOrderLink } from "../lib/order-links";
import { normalizeAdminTab, type AdminTab } from "../lib/navigation";
import { isBoostService, SERVICE_OPTIONS } from "../lib/services";
import {
  checkAvailableAmount,
  clearIntegrationApiKey,
  clearDcordApiKey,
  createOrder,
  deleteBoostStockTokens,
  deleteUsedBoostTokens,
  getBalance,
  getBoostStockTokens,
  getDcordBalance,
  getOrderStatus,
  getIntegrationConfig,
  markBoostStockTokensUsed,
  restartOrder,
  returnUsedBoostToken,
  saveBoostStock,
  saveDcordApiKey,
  saveIntegrationApiKey,
  updateOrderDelay
} from "../lib/integration";
import type { BoostStock, BoostTokenStockInput, BoostTokenStockSnapshot, BoostUsedToken, OrderStatusResponse, ServiceType, TrackedOrder } from "../types";

const EMPTY_FORM = {
  service: "OAUTH-ONLINE" as ServiceType,
  serverId: "",
  amount: 100,
  delay: 1,
  billingCycle: 1,
  duration: 1 as const
};

const EMPTY_BOOST_STOCK: BoostStock = {
  oneMonth: 0,
  threeMonth: 0
};

const EMPTY_BOOST_TOKEN_DRAFTS: BoostTokenStockInput = {
  oneMonthTokens: "",
  threeMonthTokens: ""
};

type FilterOption = {
  value: string;
  label: string;
};

function FilterDropdown({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="filter-dropdown">
      <span className={fieldLabelClass}>{label}</span>
      <button
        type="button"
        className={`filter-dropdown-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div className="filter-dropdown-menu" role="listbox" tabIndex={-1}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`filter-dropdown-option ${option.value === value ? "is-selected" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              aria-selected={option.value === value}
            >
              {option.label}
              {option.value === value ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const labelClass = "app-kicker";
const fieldLabelClass = "field-label";
const shell = "app-panel";
const PAGE_SKELETON_DELAY = 300;
const ACTIVE_SYNC_BATCH_SIZE = 16;
const ACTIVE_SYNC_PAUSE_MS = 180;
const ORDER_PAGE_SIZE = 20;

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

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
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
  const loadingLabel = tab === "create" ? "create order" : tab === "manage" ? "order management" : tab === "stock" ? "boost stock" : "settings";

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

      {tab === "stock" || tab === "settings" ? (
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

  const [apiKey, setApiKey] = useState("");
  const [apiConfigured, setApiConfigured] = useState(false);
  const [dcordApiKey, setDcordApiKey] = useState("");
  const [dcordConfigured, setDcordConfigured] = useState(false);
  const [boostStock, setBoostStock] = useState<BoostStock>(EMPTY_BOOST_STOCK);
  const [boostTokenDrafts, setBoostTokenDrafts] = useState<BoostTokenStockInput>(EMPTY_BOOST_TOKEN_DRAFTS);
  const [boostTokenLists, setBoostTokenLists] = useState<{ oneMonthTokens: string[]; threeMonthTokens: string[] }>({
    oneMonthTokens: [],
    threeMonthTokens: []
  });
  const [usedBoostTokens, setUsedBoostTokens] = useState<BoostUsedToken[]>([]);
  const [selectedBoostTokens, setSelectedBoostTokens] = useState<Record<string, boolean>>({});
  const [selectedUsedBoostTokens, setSelectedUsedBoostTokens] = useState<Record<string, boolean>>({});
  const [stockView, setStockView] = useState<"active" | "used">("active");
  const [usedTokenDurationFilter, setUsedTokenDurationFilter] = useState<"all" | 1 | 3>("all");
  const [balance, setBalance] = useState<number | null>(null);
  const [dcordBalance, setDcordBalance] = useState<number | null>(null);
  const [dcordCreditsConsumed, setDcordCreditsConsumed] = useState<number | null>(null);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [savingDcordApiKey, setSavingDcordApiKey] = useState(false);
  const [savingBoostStock, setSavingBoostStock] = useState(false);
  const [loadingBoostStock, setLoadingBoostStock] = useState(false);
  const [deletingBoostTokens, setDeletingBoostTokens] = useState(false);
  const [markingBoostTokensUsed, setMarkingBoostTokensUsed] = useState(false);
  const [deletingUsedTokens, setDeletingUsedTokens] = useState(false);
  const [returningUsedTokenId, setReturningUsedTokenId] = useState<string | null>(null);
  const [showAddTokensModal, setShowAddTokensModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [loadingDcordBalance, setLoadingDcordBalance] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [refreshingManage, setRefreshingManage] = useState(false);
  const [updatingDelayId, setUpdatingDelayId] = useState<string | null>(null);
  const [restartingOrderId, setRestartingOrderId] = useState<string | null>(null);
  const [orderPendingDeletion, setOrderPendingDeletion] = useState<TrackedOrder | null>(null);
  const [deletingTrackedOrder, setDeletingTrackedOrder] = useState(false);
  const [availability, setAvailability] = useState("");
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [orderIdToTrack, setOrderIdToTrack] = useState("");
  const [delayDrafts, setDelayDrafts] = useState<Record<string, string>>({});
  const [delaySyncLocks, setDelaySyncLocks] = useState<Record<string, number>>({});
  const [currentOrderPage, setCurrentOrderPage] = useState(1);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");

  const activeOrders = useMemo(
    () =>
      orders.filter((order) => !["COMPLETED", "TERMINATED", "INVALID", "ERROR"].includes(String(order.status ?? "").toUpperCase())),
    [orders]
  );
  const filteredOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    return orders.filter((order) => {
      const normalizedStatus = String(order.status ?? "NEW").trim().toUpperCase();
      const boostOrder = order.provider === "dcord" || isBoostService(order.service);
      const terminal = isTerminalOrder(order.status);
      const matchesSearch = !query || [
        order.uniqid,
        order.serverName,
        order.serverId,
        order.service,
        order.status,
        order.details
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
      const matchesStatus =
        orderStatusFilter === "all" ||
        (orderStatusFilter === "active" && !terminal) ||
        (orderStatusFilter === "completed" && normalizedStatus === "COMPLETED") ||
        (orderStatusFilter === "failed" && ["ERROR", "INVALID", "TERMINATED", "CANCELED", "CANCELLED"].some((value) => normalizedStatus.includes(value))) ||
        (orderStatusFilter === "waiting" && ["NEW", "WAITING"].includes(normalizedStatus));
      const matchesType =
        orderTypeFilter === "all" ||
        (orderTypeFilter === "boosts" && boostOrder) ||
        (orderTypeFilter === "members" && !boostOrder);

      return matchesSearch && matchesStatus && matchesType;
    });
  }, [orderSearch, orderStatusFilter, orderTypeFilter, orders]);
  const orderPageCount = Math.max(1, Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE));
  const selectedIsBoost = isBoostService(form.service);
  const selectedApiConfigured = selectedIsBoost ? dcordConfigured : apiConfigured;
  const selectedBoostCapacity = form.duration === 3 ? boostStock.threeMonth * 2 : boostStock.oneMonth * 2;
  const filteredUsedBoostTokens = useMemo(
    () => usedTokenDurationFilter === "all" ? usedBoostTokens : usedBoostTokens.filter((item) => item.duration === usedTokenDurationFilter),
    [usedBoostTokens, usedTokenDurationFilter]
  );
  const selectedUsedTokenIds = filteredUsedBoostTokens.filter((item) => selectedUsedBoostTokens[item.id]).map((item) => item.id);
  const memberServiceOptions = SERVICE_OPTIONS.filter((option) => option.kind === "members");
  const boostServiceOption = SERVICE_OPTIONS.find((option) => option.kind === "boosts");
  const paginatedOrders = useMemo(() => {
    const start = (currentOrderPage - 1) * ORDER_PAGE_SIZE;
    return filteredOrders.slice(start, start + ORDER_PAGE_SIZE);
  }, [currentOrderPage, filteredOrders]);

  useEffect(() => {
    if (activeTab === "manage") {
      setCurrentOrderPage(1);
    }
  }, [activeTab, orderSearch, orderStatusFilter, orderTypeFilter]);

  useEffect(() => {
    setCurrentOrderPage((current) => Math.min(Math.max(current, 1), orderPageCount));
  }, [orderPageCount]);

  async function syncActiveOrders(sourceOrders: TrackedOrder[]) {
    const syncedOrders = [...sourceOrders];

    for (let start = 0; start < sourceOrders.length; start += ACTIVE_SYNC_BATCH_SIZE) {
      const batch = sourceOrders.slice(start, start + ACTIVE_SYNC_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (order) => {
          if (!order.uniqid) return order;

          try {
            const status = await getOrderStatus(order.uniqid, order.provider);
            return mergeTrackedOrder(order, status);
          } catch {
            return order;
          }
        })
      );

      results.forEach((nextOrder, offset) => {
        syncedOrders[start + offset] = nextOrder;
      });

      if (start + ACTIVE_SYNC_BATCH_SIZE < sourceOrders.length) {
        await sleep(ACTIVE_SYNC_PAUSE_MS);
      }
    }

    return syncedOrders;
  }

  useEffect(() => {
    let active = true;
    void loadTrackedOrders()
      .then((savedOrders) => {
        if (active) setOrders(savedOrders);
      })
      .catch((error) => {
        if (active) notifyError(error instanceof Error ? error.message : "Saved orders could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!orderPendingDeletion) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deletingTrackedOrder) setOrderPendingDeletion(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [orderPendingDeletion, deletingTrackedOrder]);

  useEffect(() => {
    if (!showAddTokensModal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingBoostStock) setShowAddTokensModal(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showAddTokensModal, savingBoostStock]);

  useEffect(() => {
    void loadIntegrationConnection();
    // The initial connection check runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadIntegrationConnection() {
    try {
      const config = await getIntegrationConfig();
      const tokenuConfigured = config.tokenuConfigured ?? config.configured;
      setApiConfigured(tokenuConfigured);
      setDcordConfigured(config.dcordConfigured);
      setBoostStock(config.boostStock);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Connection could not be checked.");
    }
  }

  useEffect(() => {
    if (activeTab !== "settings") return;
    if (apiConfigured && balance === null) void refreshBalance();
    if (dcordConfigured && dcordBalance === null) void refreshDcordBalance();
    // Balances are loaded lazily when Settings is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, apiConfigured, dcordConfigured]);

  useEffect(() => {
    if (activeTab !== "stock") return;
    void refreshBoostStockTokens();
    // Stock token lists are loaded only when the Stock page is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  function applyBoostStockSnapshot(snapshot: BoostTokenStockSnapshot) {
    setBoostStock(snapshot.stock);
    setBoostTokenLists({
      oneMonthTokens: snapshot.oneMonthTokens,
      threeMonthTokens: snapshot.threeMonthTokens
    });
    setUsedBoostTokens(snapshot.usedTokens ?? []);
    setSelectedBoostTokens({});
    setSelectedUsedBoostTokens({});
  }

  async function refreshBoostStockTokens() {
    try {
      setLoadingBoostStock(true);
      applyBoostStockSnapshot(await getBoostStockTokens());
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Boost stock could not be loaded.");
    } finally {
      setLoadingBoostStock(false);
    }
  }

  useEffect(() => {
    const syncTargets = activeOrders.filter((order) => order.uniqid);
    if (activeTab !== "manage" || !syncTargets.length) {
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
        const updates = await syncActiveOrders(syncTargets);

        if (cancelled) return;

        const updatesById = new Map(updates.map((order) => [order.uniqid, order]));
        const nextOrders = orders.map((order) => updatesById.get(order.uniqid) ?? order);
        const changed = nextOrders.some((nextOrder, index) => !areTrackedOrdersEqual(nextOrder, orders[index]));
        if (changed) {
          setOrders(nextOrders);
        }
      } finally {
        if (!cancelled) {
          setSyncingOrders(false);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, activeOrders, orders]);

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
  }, [activeTab, form.service, form.serverId, form.duration]);

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

  async function refreshDcordBalance() {
    try {
      setLoadingDcordBalance(true);
      const data = await getDcordBalance();
      setDcordBalance(data.balance);
      setDcordCreditsConsumed(data.creditsConsumed);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Dcord balance could not be loaded.");
    } finally {
      setLoadingDcordBalance(false);
    }
  }

  async function refreshAvailability() {
    try {
      setCheckingAvailability(true);
      const serverId = selectedIsBoost ? form.serverId.trim() : await resolveDiscordGuildId(form.serverId);
      const data = await checkAvailableAmount(form.service, serverId, form.duration);
      setAvailability(`Available ${data.available} / max ${data.maximum}`);
    } catch {
      setAvailability("");
    } finally {
      setCheckingAvailability(false);
    }
  }

  async function handleSaveApiKey(event: FormEvent) {
    event.preventDefault();
    const value = apiKey.trim();
    if (!value) {
      notifyError("API key is required.");
      return;
    }

    try {
      setSavingApiKey(true);
      const result = await saveIntegrationApiKey(value);
      setApiConfigured(true);
      setApiKey("");
      if (typeof result.balance === "number") setBalance(result.balance);
      notifySuccess("API key verified and saved securely.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "API key could not be saved.");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function handleClearApiKey() {
    try {
      setSavingApiKey(true);
      await clearIntegrationApiKey();
      setApiConfigured(false);
      setApiKey("");
      setBalance(null);
      notifySuccess("API key removed from the server.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "API key could not be removed.");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function handleSaveDcordApiKey(event: FormEvent) {
    event.preventDefault();
    const value = dcordApiKey.trim();
    if (!value) {
      notifyError("Dcord API key is required.");
      return;
    }

    try {
      setSavingDcordApiKey(true);
      await saveDcordApiKey(value);
      setDcordConfigured(true);
      setDcordApiKey("");
      void refreshDcordBalance();
      notifySuccess("Dcord API key saved securely.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Dcord API key could not be saved.");
    } finally {
      setSavingDcordApiKey(false);
    }
  }

  async function handleClearDcordApiKey() {
    try {
      setSavingDcordApiKey(true);
      await clearDcordApiKey();
      setDcordConfigured(false);
      setDcordApiKey("");
      setDcordBalance(null);
      setDcordCreditsConsumed(null);
      notifySuccess("Dcord API key removed from the server.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Dcord API key could not be removed.");
    } finally {
      setSavingDcordApiKey(false);
    }
  }

  async function handleSaveBoostStock(event: FormEvent) {
    event.preventDefault();
    if (!boostTokenDrafts.oneMonthTokens.trim() && !boostTokenDrafts.threeMonthTokens.trim()) {
      notifyError("Paste at least one boost token.");
      return;
    }

    try {
      setSavingBoostStock(true);
      const result = await saveBoostStock(boostTokenDrafts);
      setBoostStock(result.stock);
      setBoostTokenDrafts(EMPTY_BOOST_TOKEN_DRAFTS);
      setShowAddTokensModal(false);
      void refreshBoostStockTokens();
      notifySuccess("Boost stock updated.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Boost stock could not be saved.");
    } finally {
      setSavingBoostStock(false);
    }
  }

  function getSelectedTokens(duration: 1 | 3) {
    const source = duration === 3 ? boostTokenLists.threeMonthTokens : boostTokenLists.oneMonthTokens;
    return source.filter((token) => selectedBoostTokens[`${duration}:${token}`]);
  }

  function toggleBoostToken(duration: 1 | 3, token: string, checked: boolean) {
    setSelectedBoostTokens((current) => ({
      ...current,
      [`${duration}:${token}`]: checked
    }));
  }

  function setAllBoostTokens(duration: 1 | 3, checked: boolean) {
    const source = duration === 3 ? boostTokenLists.threeMonthTokens : boostTokenLists.oneMonthTokens;
    setSelectedBoostTokens((current) => {
      const next = { ...current };
      source.forEach((token) => {
        next[`${duration}:${token}`] = checked;
      });
      return next;
    });
  }

  function downloadBoostTokens(duration: 1 | 3, onlySelected = false) {
    const tokens = onlySelected
      ? getSelectedTokens(duration)
      : duration === 3
        ? boostTokenLists.threeMonthTokens
        : boostTokenLists.oneMonthTokens;

    if (!tokens.length) {
      notifyError("No tokens to download.");
      return;
    }

    const blob = new Blob([`${tokens.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `boost-${duration}-month-tokens.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function removeSelectedBoostTokens(duration: 1 | 3) {
    const tokens = getSelectedTokens(duration);
    if (!tokens.length) {
      notifyError("Select tokens to remove.");
      return;
    }

    try {
      setDeletingBoostTokens(true);
      applyBoostStockSnapshot(await deleteBoostStockTokens({ duration, tokens }));
      notifySuccess(`${tokens.length} token removed.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Selected tokens could not be removed.");
    } finally {
      setDeletingBoostTokens(false);
    }
  }

  async function markSelectedBoostTokensUsed(duration: 1 | 3) {
    const tokens = getSelectedTokens(duration);
    if (!tokens.length) {
      notifyError("Select tokens to mark as used.");
      return;
    }

    try {
      setMarkingBoostTokensUsed(true);
      applyBoostStockSnapshot(await markBoostStockTokensUsed({ duration, tokens }));
      notifySuccess(`${tokens.length} token moved to used tokens.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Selected tokens could not be marked as used.");
    } finally {
      setMarkingBoostTokensUsed(false);
    }
  }

  function toggleUsedBoostToken(id: string, checked: boolean) {
    setSelectedUsedBoostTokens((current) => ({
      ...current,
      [id]: checked
    }));
  }

  function setAllUsedBoostTokens(checked: boolean) {
    setSelectedUsedBoostTokens((current) => {
      const next = { ...current };
      filteredUsedBoostTokens.forEach((item) => {
        next[item.id] = checked;
      });
      return next;
    });
  }

  function getUsedTokensForDownload(onlySelected = false) {
    const source = onlySelected ? filteredUsedBoostTokens.filter((item) => selectedUsedBoostTokens[item.id]) : filteredUsedBoostTokens;
    return source.map((item) => item.token);
  }

  function downloadUsedBoostTokens(onlySelected = false) {
    const tokens = getUsedTokensForDownload(onlySelected);
    if (!tokens.length) {
      notifyError("No used tokens to download.");
      return;
    }

    const blob = new Blob([`${tokens.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = onlySelected ? "used-boost-tokens-selected.txt" : "used-boost-tokens.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleReturnUsedBoostTokens(ids: string[]) {
    if (!ids.length) {
      notifyError("Select used tokens first.");
      return;
    }

    try {
      setReturningUsedTokenId(ids.length === 1 ? ids[0] : "__bulk__");
      applyBoostStockSnapshot(await returnUsedBoostToken(ids));
      notifySuccess(`${ids.length} token returned to stock.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Token could not be returned to stock.");
    } finally {
      setReturningUsedTokenId(null);
    }
  }

  async function handleReturnUsedBoostToken(item: BoostUsedToken) {
    await handleReturnUsedBoostTokens([item.id]);
  }

  async function handleDeleteUsedBoostTokens(ids: string[]) {
    if (!ids.length) {
      notifyError("Select used tokens first.");
      return;
    }

    const confirmed = window.confirm(`${ids.length} used token record will be deleted. Tokens will not return to stock.`);
    if (!confirmed) return;

    try {
      setDeletingUsedTokens(true);
      applyBoostStockSnapshot(await deleteUsedBoostTokens(ids));
      notifySuccess(`${ids.length} used token record deleted.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Used token records could not be deleted.");
    } finally {
      setDeletingUsedTokens(false);
    }
  }

  function persistOrders(nextOrders: TrackedOrder[]) {
    setOrders(nextOrders);
    void saveTrackedOrders(nextOrders).catch((error) => {
      notifyError(error instanceof Error ? error.message : "Orders could not be saved.");
    });
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
      duration: status.duration === 1 || status.duration === 3 ? status.duration : order.duration,
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
      a.serverInvite === b.serverInvite &&
      a.serverMemberCount === b.serverMemberCount &&
      a.service === b.service &&
      a.provider === b.provider &&
      a.duration === b.duration
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

  async function handleRestartOrder(order: TrackedOrder) {
    if (restartingOrderId) return;

    try {
      setRestartingOrderId(order.uniqid);
      await restartOrder(order.uniqid);
      notifySuccess(`Continue request sent for ${order.uniqid}.`);

      try {
        const status = await getOrderStatus(order.uniqid, order.provider);
        updateLocalOrder(mergeTrackedOrder(order, status));
      } catch {
        // The regular Manage refresh can verify the status if the upstream service needs more time.
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Order could not be continued.");
    } finally {
      setRestartingOrderId(null);
    }
  }

  async function refreshTrackedOrders() {
    const syncTargets = activeOrders.filter((order) => order.uniqid);
    if (!syncTargets.length) {
      notifyError("No tracked orders to refresh.");
      return;
    }

    try {
      setRefreshingManage(true);
      const updates = await syncActiveOrders(syncTargets);
      const updatesById = new Map(updates.map((order) => [order.uniqid, order]));
      const nextOrders = orders.map((order) => updatesById.get(order.uniqid) ?? order);
      const changed = nextOrders.some((nextOrder, index) => !areTrackedOrdersEqual(nextOrder, orders[index]));
      if (changed) {
        setOrders(nextOrders);
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

  async function copyBotInviteLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      notifySuccess("Bot invite link copied.");
    } catch {
      notifyError("Bot invite link could not be copied.");
    }
  }

  async function confirmTrackedOrderDeletion() {
    if (!orderPendingDeletion || deletingTrackedOrder) return;
    const target = orderPendingDeletion;
    const nextOrders = orders.filter((item) => item.uniqid !== target.uniqid);

    try {
      setDeletingTrackedOrder(true);
      await saveTrackedOrders(nextOrders);
      setOrders(nextOrders);
      setOrderPendingDeletion(null);
      notifySuccess(`Order ${target.uniqid} removed from tracking.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Order could not be removed.");
    } finally {
      setDeletingTrackedOrder(false);
    }
  }

  async function handleCreateOrder(event: FormEvent) {
    event.preventDefault();
    setCreating(true);

    try {
      const serverInfo = await resolveDiscordGuildInfo(form.serverId);
      const serverId = serverInfo.guildId;
      if (selectedIsBoost && form.amount % 2 !== 0) {
        throw new Error("Boost amount must be an even number.");
      }
      const created = await createOrder({
        service: form.service,
        id: selectedIsBoost ? form.serverId.trim() : serverId,
        amount: form.amount,
        delay: selectedIsBoost ? undefined : form.delay,
        billingCycle: form.service === "OAUTH-ONLINE" ? form.billingCycle : undefined,
        duration: selectedIsBoost ? form.duration : undefined
      });
      const createdStock = (created as { stock?: BoostStock }).stock;
      if (createdStock) {
        setBoostStock(createdStock);
      }

      const nextOrder: TrackedOrder = {
        uniqid: created.uniqid,
        provider: selectedIsBoost ? "dcord" : "tokenu",
        service: form.service,
        serverId,
        amount: form.amount,
        added: 0,
        delay: selectedIsBoost ? undefined : form.delay,
        billingCycle: form.service === "OAUTH-ONLINE" ? form.billingCycle : undefined,
        duration: selectedIsBoost ? form.duration : undefined,
        cost: created.cost,
        botInvite: created.bot_invite,
        serverInvite: extractDiscordInviteCode(form.serverId) ? form.serverId.trim() : undefined,
        serverMemberCount: serverInfo.approximateMemberCount,
        createdAt: new Date().toISOString(),
        status: "NEW"
      };

      persistOrders([nextOrder, ...orders]);
      notifySuccess(`Order created: ${created.uniqid}`);
      navigate(`/orders?uniqid=${encodeURIComponent(created.uniqid)}${selectedIsBoost ? "&provider=dcord" : ""}`);
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

  const showManageSkeleton = refreshingManage;

  return (
    <div className="relative">
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
              <Badge variant={selectedApiConfigured ? "success" : "destructive"}>{selectedApiConfigured ? "API connected" : "API key required"}</Badge>
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
                    <legend className="sr-only">Service category</legend>
                    <div className="service-selector-heading">
                      <div>
                        <span className={fieldLabelClass}>Choose service</span>
                        <p className="service-selector-copy">Select members or boosts, then configure the order details.</p>
                      </div>
                      <span className="service-selector-count">2 services</span>
                    </div>
                    <div className="service-grid service-grid-compact">
                      {[
                        { value: "members", title: "Members", description: "Tokenu member delivery", icon: KeyRound },
                        { value: "boosts", title: "Boosts", description: "Dcord join + boost delivery", icon: boostServiceOption?.icon ?? Plus }
                      ].map((option, index) => {
                        const Icon = option.icon;
                        const selected = option.value === "boosts" ? selectedIsBoost : !selectedIsBoost;

                        return (
                          <label key={option.value} className={`service-option ${selected ? "is-selected" : ""}`} data-service={option.value}>
                            <input
                              className="sr-only"
                              type="radio"
                              name="serviceCategory"
                              value={option.value}
                              checked={selected}
                              onChange={() =>
                                setForm((current) => ({
                                  ...current,
                                  service: option.value === "boosts" ? "DCORD-BOOSTS" : memberServiceOptions[0]?.value ?? "OAUTH-ONLINE",
                                  amount: option.value === "boosts" ? 2 : 100
                                }))
                              }
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

                  {!selectedIsBoost ? (
                    <fieldset className="service-selector md:col-span-2">
                      <legend className="sr-only">Member service</legend>
                      <div className="service-selector-heading">
                        <div>
                          <span className={fieldLabelClass}>Member mode</span>
                          <p className="service-selector-copy">Choose the Tokenu member service type.</p>
                        </div>
                        <span className="service-selector-count">{memberServiceOptions.length} modes</span>
                      </div>
                      <div className="service-grid">
                        {memberServiceOptions.map((option, index) => {
                          const Icon = option.icon;
                          const selected = form.service === option.value;

                          return (
                            <label key={option.value} className={`service-option ${selected ? "is-selected" : ""}`} data-service={option.value}>
                              <input
                                className="sr-only"
                                type="radio"
                                name="memberService"
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
                  ) : null}

                  {selectedIsBoost ? (
                    <fieldset className="service-selector md:col-span-2">
                      <legend className="sr-only">Boost duration</legend>
                      <div className="service-selector-heading">
                        <div>
                          <span className={fieldLabelClass}>Boost duration</span>
                          <p className="service-selector-copy">Choose the stock bucket used for this boost order.</p>
                        </div>
                        <span className="service-selector-count">2 durations</span>
                      </div>
                      <div className="service-grid boost-duration-grid">
                        {[1, 3].map((duration, index) => {
                          const selected = form.duration === duration;
                          const tokenStock = duration === 3 ? boostStock.threeMonth : boostStock.oneMonth;
                          const boostCapacity = tokenStock * 2;
                          const requiredTokens = Math.max(1, Math.ceil((Number(form.amount) || 0) / 2));

                          return (
                            <label
                              key={duration}
                              className={`service-option ${selected ? "is-selected" : ""}`}
                              data-service={duration === 3 ? "boost-duration-3" : "boost-duration-1"}
                            >
                              <input
                                className="sr-only"
                                type="radio"
                                name="boostDuration"
                                value={duration}
                                checked={selected}
                                onChange={() =>
                                  setForm((current) => {
                                    const nextCapacity = duration === 3 ? boostStock.threeMonth * 2 : boostStock.oneMonth * 2;
                                    return {
                                      ...current,
                                      duration: duration as 1 | 3,
                                      amount: nextCapacity > 0 ? Math.min(current.amount, nextCapacity) : current.amount
                                    };
                                  })
                                }
                              />
                              <span className="service-option-head" aria-hidden="true">
                                <span className="service-option-icon">
                                  <span className="text-sm font-semibold">{duration}M</span>
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
                              <span className="service-option-title">{duration} Month</span>
                              <span className="service-option-description">
                                {tokenStock} tokens available · {requiredTokens} needed
                              </span>
                              <span className="service-option-code service-option-code-badge">{boostCapacity} BOOSTS</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}

                  {selectedIsBoost ? (
                    <div className="boost-order-block md:col-span-2">
                      <div className="boost-order-section-heading">
                        <div>
                          <span className={fieldLabelClass}>Boost details</span>
                          <p className="service-selector-copy">Set the boost amount and target server invite.</p>
                        </div>
                      </div>
                      <div className="boost-order-panel">
                        <div className="boost-order-grid">
                          <div className="boost-order-field">
                            <span className="boost-order-label">Number of Boosts</span>
                            <div className="boost-amount-control">
                              <button
                                type="button"
                                aria-label="Decrease boosts"
                                onClick={() => setForm((current) => ({ ...current, amount: Math.max(2, current.amount - 2) }))}
                              >
                                <Minus className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <div className="boost-amount-value" aria-live="polite">{form.amount}</div>
                              <button
                                type="button"
                                aria-label="Increase boosts"
                                disabled={selectedBoostCapacity <= 0 || form.amount >= selectedBoostCapacity}
                                onClick={() =>
                                  setForm((current) => ({
                                    ...current,
                                    amount: Math.min(Math.max(2, selectedBoostCapacity), current.amount + 2)
                                  }))
                                }
                              >
                                <Plus className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </div>

                          <label className="boost-order-field">
                            <span className="boost-order-label">Server Invite</span>
                            <div className="boost-invite-control">
                              <span>discord.gg/</span>
                              <input
                                value={form.serverId}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setForm((current) => ({ ...current, serverId: extractDiscordInviteCode(value) ?? value }));
                                }}
                                placeholder="yourcode"
                                required
                              />
                            </div>
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="boost-order-block md:col-span-2">
                      <div className="boost-order-section-heading">
                        <div>
                          <span className={fieldLabelClass}>Member details</span>
                          <p className="service-selector-copy">Set the member amount, invite, and delivery timing.</p>
                        </div>
                      </div>
                      <div className="boost-order-panel">
                        <div className={`boost-order-grid members-order-grid ${form.service === "OAUTH-ONLINE" ? "is-online" : ""}`}>
                          <div className="boost-order-field">
                            <span className="boost-order-label">Number of Members</span>
                            <input
                              className="boost-number-input"
                              type="number"
                              min={1}
                              value={form.amount}
                              onChange={(event) => setForm((current) => ({ ...current, amount: Number(event.target.value) || 100 }))}
                            />
                          </div>

                          <label className="boost-order-field">
                            <span className="boost-order-label">Server Invite</span>
                            <div className="boost-invite-control">
                              <span>discord.gg/</span>
                              <input
                                value={form.serverId}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setForm((current) => ({ ...current, serverId: extractDiscordInviteCode(value) ?? value }));
                                }}
                                placeholder="yourcode"
                                required
                              />
                            </div>
                          </label>

                          <label className="boost-order-field">
                            <span className="boost-order-label">Delay</span>
                            <input
                              className="boost-number-input"
                              type="number"
                              min={1}
                              max={1200}
                              value={form.delay}
                              onChange={(event) => setForm((current) => ({ ...current, delay: Number(event.target.value) || 1 }))}
                            />
                          </label>

                          {form.service === "OAUTH-ONLINE" ? (
                            <label className="boost-order-field">
                              <span className="boost-order-label">Billing cycle</span>
                              <input
                                className="boost-number-input"
                                type="number"
                                min={1}
                                max={12}
                                value={form.billingCycle}
                                onChange={(event) => setForm((current) => ({ ...current, billingCycle: Number(event.target.value) || 1 }))}
                              />
                            </label>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button className="min-w-[150px] px-4 py-2.5 max-sm:w-full" type="submit" disabled={creating || !selectedApiConfigured}>
                    {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    {creating ? "Creating..." : "Create order"}
                  </Button>
                  {!selectedApiConfigured ? (
                    <Button asChild variant="secondary" className="max-sm:w-full">
                      <Link to="/manage?tab=settings">
                        <Settings2 className="h-4 w-4" aria-hidden="true" />
                        Configure {selectedIsBoost ? "Dcord" : "Tokenu"} key
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
                <Badge variant="secondary">{filteredOrders.length} shown</Badge>
                <Badge variant="secondary">{activeOrders.length} active</Badge>
                <Badge variant="secondary">
                  Page {currentOrderPage}/{orderPageCount}
                </Badge>
                {syncingOrders ? <Badge variant="secondary">Syncing...</Badge> : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => void refreshTrackedOrders()}
                  disabled={refreshingManage || syncingOrders || !activeOrders.length}
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
                  <>
                  <div className="tracked-order-filterbar border-b border-[var(--app-divider)] px-5 py-4 sm:px-6">
                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>Search</span>
                      <Input
                        value={orderSearch}
                        onChange={(event) => setOrderSearch(event.target.value)}
                        placeholder="Order ID, server, service..."
                      />
                    </label>
                    <FilterDropdown
                      label="Status"
                      value={orderStatusFilter}
                      onChange={setOrderStatusFilter}
                      options={[
                        { value: "all", label: "All statuses" },
                        { value: "active", label: "Active" },
                        { value: "waiting", label: "Waiting" },
                        { value: "completed", label: "Completed" },
                        { value: "failed", label: "Failed" }
                      ]}
                    />
                    <FilterDropdown
                      label="Type"
                      value={orderTypeFilter}
                      onChange={setOrderTypeFilter}
                      options={[
                        { value: "all", label: "All types" },
                        { value: "members", label: "Members" },
                        { value: "boosts", label: "Boosts" }
                      ]}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!orderSearch && orderStatusFilter === "all" && orderTypeFilter === "all"}
                      onClick={() => {
                        setOrderSearch("");
                        setOrderStatusFilter("all");
                        setOrderTypeFilter("all");
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-divider)] px-5 py-3 text-sm text-[var(--app-text-secondary)] sm:px-6">
                    <span>
                      Showing {filteredOrders.length ? Math.min((currentOrderPage - 1) * ORDER_PAGE_SIZE + 1, filteredOrders.length) : 0}-
                      {Math.min(currentOrderPage * ORDER_PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={() => setCurrentOrderPage((current) => Math.max(current - 1, 1))}
                        disabled={currentOrderPage <= 1}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        Prev
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={() => setCurrentOrderPage((current) => Math.min(current + 1, orderPageCount))}
                        disabled={currentOrderPage >= orderPageCount}
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  {filteredOrders.length ? (
                    <>
                  <ol className="tracked-order-list" aria-labelledby="tracked-orders-title">
                    {paginatedOrders.map((order, index) => {
                      const serviceOption = SERVICE_OPTIONS.find((option) => option.value === order.service);
                      const ServiceIcon = serviceOption?.icon ?? KeyRound;
                      const orderIndex = (currentOrderPage - 1) * ORDER_PAGE_SIZE + index;
                      const orderTitleId = `tracked-order-${orderIndex}`;
                      const progress = getOrderProgress(order);
                      const completed = isTerminalOrder(order.status);
                      const boostOrder = order.provider === "dcord" || isBoostService(order.service);
                      const botInvite = extractBotInvite(order);
                      const botInviteRequired = ["NEW", "WAITING"].includes(String(order.status ?? "").trim().toUpperCase()) ? botInvite : null;
                      const isInvitesPaused = String(order.status ?? "").trim().toUpperCase().includes("INVITES PAUSED");

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
                                {boostOrder && order.duration ? <span>{order.duration} month boosts</span> : null}
                              </div>
                              {botInviteRequired ? (
                                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--app-accent-border)] bg-[var(--app-accent-soft)] p-2">
                                  <span className="mr-auto inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--app-text)]">
                                    <Bot className="h-3.5 w-3.5 text-[var(--app-accent)]" aria-hidden="true" /> Bot required to start
                                  </span>
                                  <Button type="button" size="xs" variant="secondary" onClick={() => void copyBotInviteLink(botInviteRequired)}>
                                    <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy bot link
                                  </Button>
                                  <Button asChild size="xs">
                                    <a href={botInviteRequired} target="_blank" rel="noreferrer">
                                      <Bot className="h-3.5 w-3.5" aria-hidden="true" /> Add bot <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                    </a>
                                  </Button>
                                </div>
                              ) : !botInvite && order.details ? <p className="tracked-order-detail">{getPlainDetails(order.details)}</p> : null}
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
                                  <dt>{boostOrder ? "Boosts" : "Users"}</dt>
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
                              {!completed && !boostOrder ? (
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
                              {isInvitesPaused && !boostOrder ? (
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  disabled={restartingOrderId !== null}
                                  onClick={() => void handleRestartOrder(order)}
                                >
                                  <RotateCcw className={`h-3.5 w-3.5 ${restartingOrderId === order.uniqid ? "animate-spin" : ""}`} aria-hidden="true" />
                                  {restartingOrderId === order.uniqid ? "Continuing..." : "Continue"}
                                </Button>
                              ) : null}
                              {!boostOrder ? (
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
                              ) : null}
                              <Button asChild variant="secondary" size="sm" title="View order">
                                <Link
                                  to={`/orders?uniqid=${encodeURIComponent(order.uniqid)}${boostOrder ? "&provider=dcord" : ""}`}
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
                                onClick={() => setOrderPendingDeletion(order)}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-divider)] px-5 py-3 text-sm text-[var(--app-text-secondary)] sm:px-6">
                    <span>Page {currentOrderPage} of {orderPageCount}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={() => setCurrentOrderPage((current) => Math.max(current - 1, 1))}
                        disabled={currentOrderPage <= 1}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        Prev
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={() => setCurrentOrderPage((current) => Math.min(current + 1, orderPageCount))}
                        disabled={currentOrderPage >= orderPageCount}
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                    </>
                  ) : (
                    <div className="grid min-h-56 place-items-center px-5 py-10 text-center">
                      <div>
                        <span className="stat-icon mx-auto" aria-hidden="true">
                          <Search className="h-4 w-4" />
                        </span>
                        <p className="mt-4 text-sm font-medium text-[var(--app-text-secondary)]">No orders match these filters</p>
                        <p className="app-copy mt-1 text-sm">Clear filters or search another order detail.</p>
                      </div>
                    </div>
                  )}
                  </>
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

        {activeTab === "stock" ? (
          <>
            <header className="page-heading stock-page-heading">
              <div>
                <p className={labelClass}>Stock</p>
                <h1 className="page-title">Token inventory</h1>
                <p className="app-copy page-copy">Manage available boost tokens and usage history.</p>
              </div>
              <div className="stock-heading-actions">
                <Button type="button" size="sm" onClick={() => setShowAddTokensModal(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add tokens
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={loadingBoostStock} onClick={() => void refreshBoostStockTokens()}>
                  <RefreshCw className={`h-4 w-4 ${loadingBoostStock ? "animate-spin" : ""}`} aria-hidden="true" />
                  Refresh
                </Button>
              </div>
            </header>

            <section className={`${shell} stock-overview`}>
              <div className="stock-overview-lead">
                <span className="stock-overview-icon"><ListChecks className="h-5 w-5" aria-hidden="true" /></span>
                <div><small>Total capacity</small><strong>{(boostStock.oneMonth + boostStock.threeMonth) * 2}</strong><span>boosts ready</span></div>
              </div>
              <div className="stock-overview-metric"><small>Active tokens</small><strong>{boostStock.oneMonth + boostStock.threeMonth}</strong><span>encrypted inventory</span></div>
              <div className="stock-overview-metric"><small>1 month</small><strong>{boostStock.oneMonth}</strong><span>{boostStock.oneMonth * 2} boosts</span></div>
              <div className="stock-overview-metric"><small>3 month</small><strong>{boostStock.threeMonth}</strong><span>{boostStock.threeMonth * 2} boosts</span></div>
              <div className="stock-overview-metric"><small>Used history</small><strong>{usedBoostTokens.length}</strong><span>recorded tokens</span></div>
            </section>

            <section className={`${shell} stock-workbench`}>
              <div className="stock-workbench-header">
                <div className="stock-view-tabs" role="tablist" aria-label="Token stock views">
                  <button type="button" role="tab" aria-selected={stockView === "active"} className={stockView === "active" ? "is-active" : ""} onClick={() => setStockView("active")}>
                    <ListChecks className="h-4 w-4" aria-hidden="true" />
                    Active inventory
                    <span>{boostStock.oneMonth + boostStock.threeMonth}</span>
                  </button>
                  <button type="button" role="tab" aria-selected={stockView === "used"} className={stockView === "used" ? "is-active" : ""} onClick={() => setStockView("used")}>
                    <History className="h-4 w-4" aria-hidden="true" />
                    Used history
                    <span>{usedBoostTokens.length}</span>
                  </button>
                </div>
                <span className="stock-storage-mark"><ShieldCheck className="h-4 w-4" /> Encrypted server storage</span>
              </div>

              {stockView === "active" ? (
                <div className="stock-inventory-groups" role="tabpanel">
                    {[
                      { duration: 1 as const, label: "1 month", tokens: boostTokenLists.oneMonthTokens },
                      { duration: 3 as const, label: "3 month", tokens: boostTokenLists.threeMonthTokens }
                    ].map((group) => {
                      const selectedCount = getSelectedTokens(group.duration).length;
                      return (
                        <section key={group.duration} className="stock-duration-section">
                          <header className="stock-duration-header">
                            <div className="stock-duration-identity">
                              <span>0{group.duration}</span>
                              <div><p className={labelClass}>{group.label} inventory</p><h2>{group.tokens.length} tokens <em>{group.tokens.length * 2} boosts</em></h2></div>
                            </div>
                            <Button type="button" size="xs" variant="secondary" onClick={() => downloadBoostTokens(group.duration)} disabled={!group.tokens.length}>
                              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download all
                            </Button>
                          </header>

                          <div className={`stock-selection-bar ${selectedCount ? "has-selection" : ""}`}>
                            <label className="stock-select-all">
                              <input type="checkbox" checked={Boolean(group.tokens.length && selectedCount === group.tokens.length)} onChange={(event) => setAllBoostTokens(group.duration, event.target.checked)} disabled={!group.tokens.length} />
                              <span>{selectedCount ? `${selectedCount} selected` : "Select all"}</span>
                            </label>
                            <div className="stock-selection-actions">
                              {selectedCount ? <Button type="button" size="xs" variant="ghost" onClick={() => setAllBoostTokens(group.duration, false)}>Clear</Button> : null}
                              <Button type="button" size="xs" variant="secondary" onClick={() => downloadBoostTokens(group.duration, true)} disabled={!selectedCount}>
                                <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                              </Button>
                              <Button type="button" size="xs" variant="secondary" onClick={() => void markSelectedBoostTokensUsed(group.duration)} disabled={!selectedCount || markingBoostTokensUsed || deletingBoostTokens}>
                                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                {markingBoostTokensUsed ? "Moving..." : "Mark used"}
                              </Button>
                              <Button type="button" size="xs" variant="dangerGhost" onClick={() => void removeSelectedBoostTokens(group.duration)} disabled={!selectedCount || deletingBoostTokens || markingBoostTokensUsed}>
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                              </Button>
                            </div>
                          </div>

                          <div className="stock-token-scroll">
                            {group.tokens.length ? (
                              <ol className="stock-token-list">
                                {group.tokens.map((token, index) => (
                                  <li key={`${group.duration}-${token}`} className={selectedBoostTokens[`${group.duration}:${token}`] ? "is-selected" : ""}>
                                    <input type="checkbox" checked={Boolean(selectedBoostTokens[`${group.duration}:${token}`])} onChange={(event) => toggleBoostToken(group.duration, token, event.target.checked)} aria-label={`Select ${group.label} token ${index + 1}`} />
                                    <span className="stock-token-index">{String(index + 1).padStart(2, "0")}</span>
                                    <code title={token}>{token}</code>
                                    <Badge variant="secondary">{group.duration} Month</Badge>
                                  </li>
                                ))}
                              </ol>
                            ) : (
                              <div className="stock-empty-state"><ListChecks className="h-5 w-5" /><strong>No tokens in this inventory</strong><span>Add {group.label} tokens to make them available for orders.</span></div>
                            )}
                          </div>
                        </section>
                      );
                    })}
                </div>
              ) : (
                <div className="stock-used-view" role="tabpanel">
                  <div className="stock-used-filterbar">
                    <span>Duration</span>
                    <div className="stock-duration-filter" role="group" aria-label="Filter used tokens by duration">
                      {[
                        { value: "all" as const, label: "All", count: usedBoostTokens.length },
                        { value: 1 as const, label: "1 Month", count: usedBoostTokens.filter((item) => item.duration === 1).length },
                        { value: 3 as const, label: "3 Month", count: usedBoostTokens.filter((item) => item.duration === 3).length }
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={usedTokenDurationFilter === option.value ? "is-active" : ""}
                          aria-pressed={usedTokenDurationFilter === option.value}
                          onClick={() => {
                            setUsedTokenDurationFilter(option.value);
                            setSelectedUsedBoostTokens({});
                          }}
                        >
                          {option.label}<span>{option.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={`stock-selection-bar stock-used-actions ${selectedUsedTokenIds.length ? "has-selection" : ""}`}>
                    <label className="stock-select-all">
                      <input type="checkbox" checked={Boolean(filteredUsedBoostTokens.length && selectedUsedTokenIds.length === filteredUsedBoostTokens.length)} onChange={(event) => setAllUsedBoostTokens(event.target.checked)} disabled={!filteredUsedBoostTokens.length} />
                      <span>{selectedUsedTokenIds.length ? `${selectedUsedTokenIds.length} selected` : `Select all ${usedTokenDurationFilter === "all" ? "used tokens" : `${usedTokenDurationFilter} month`}`}</span>
                    </label>
                    <div className="stock-selection-actions">
                      {selectedUsedTokenIds.length ? <Button type="button" size="xs" variant="ghost" onClick={() => setAllUsedBoostTokens(false)}>Clear</Button> : null}
                      <Button type="button" size="xs" variant="secondary" onClick={() => downloadUsedBoostTokens()} disabled={!filteredUsedBoostTokens.length}>
                        <Download className="h-3.5 w-3.5" /> Download all
                      </Button>
                      <Button type="button" size="xs" variant="secondary" onClick={() => downloadUsedBoostTokens(true)} disabled={!selectedUsedTokenIds.length}>
                        <Download className="h-3.5 w-3.5" /> Download selected
                      </Button>
                      <Button type="button" size="xs" variant="secondary" onClick={() => void handleReturnUsedBoostTokens(selectedUsedTokenIds)} disabled={!selectedUsedTokenIds.length || returningUsedTokenId !== null || deletingUsedTokens}>
                        <RotateCcw className="h-3.5 w-3.5" /> {returningUsedTokenId === "__bulk__" ? "Returning..." : "Return to stock"}
                      </Button>
                      <Button type="button" size="xs" variant="dangerGhost" onClick={() => void handleDeleteUsedBoostTokens(selectedUsedTokenIds)} disabled={!selectedUsedTokenIds.length || deletingUsedTokens || returningUsedTokenId !== null}>
                        <Trash2 className="h-3.5 w-3.5" /> {deletingUsedTokens ? "Deleting..." : "Delete"}
                      </Button>
                    </div>
                  </div>

                  <div className="stock-used-scroll">
                    {filteredUsedBoostTokens.length ? (
                      <ol className="stock-used-list">
                        {filteredUsedBoostTokens.map((item, index) => (
                          <li key={item.id} className={selectedUsedBoostTokens[item.id] ? "is-selected" : ""}>
                            <input type="checkbox" checked={Boolean(selectedUsedBoostTokens[item.id])} onChange={(event) => toggleUsedBoostToken(item.id, event.target.checked)} aria-label={`Select used token ${index + 1}`} />
                            <span className="stock-token-index">{String(index + 1).padStart(2, "0")}</span>
                            <div className="stock-used-token-main">
                              <code title={item.token}>{item.token}</code>
                              <span>{item.orderId ? `Order ${item.orderId}` : "Manually marked as used"}{item.boostMessage ? ` · ${item.boostMessage}` : ""}</span>
                            </div>
                            <Badge variant="secondary">{item.duration} Month</Badge>
                            <span className="stock-used-date">{formatTrackedDate(item.resultAt ?? item.usedAt)}</span>
                            <Badge variant={item.boosted ? "success" : ["pending", "used"].includes(item.status ?? "") ? "secondary" : "destructive"}>{item.boosted ? "Boosted" : item.status ?? "pending"}</Badge>
                            <Button type="button" size="xs" variant="secondary" disabled={returningUsedTokenId !== null || deletingUsedTokens} onClick={() => void handleReturnUsedBoostToken(item)}>
                              <RotateCcw className="h-3.5 w-3.5" /> {returningUsedTokenId === item.id ? "Returning..." : "Return"}
                            </Button>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="stock-empty-state"><History className="h-5 w-5" /><strong>No {usedTokenDurationFilter === "all" ? "used" : `${usedTokenDurationFilter} month`} tokens</strong><span>Tokens moved from inventory or consumed by orders will appear here.</span></div>
                    )}
                  </div>
                </div>
              )}
            </section>
          </>
        ) : null}

        {activeTab === "settings" ? (
          <>
            <header className="page-heading">
              <div>
                <p className={labelClass}>Settings</p>
                <h1 className="page-title">Integration connection</h1>
                <p className="app-copy page-copy">Configure the server-side integration connection and review its balance.</p>
              </div>
              <div className="page-heading-meta">
                <Badge variant={apiConfigured ? "success" : "destructive"}>Tokenu {apiConfigured ? "Connected" : "Missing"}</Badge>
                <Badge variant={dcordConfigured ? "success" : "destructive"}>Dcord {dcordConfigured ? "Connected" : "Missing"}</Badge>
              </div>
            </header>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
              <div className="grid gap-5">
              <section className={`${shell} p-5 sm:p-6`}>
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true">
                    <ShieldCheck className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Secure access</p>
                    <h2 className="app-title mt-1 text-lg font-semibold">Integration API key</h2>
                  </div>
                </div>
                <p className="app-copy mt-4 max-w-2xl text-sm leading-6">
                  Enter the key here once. It is verified by the server, encrypted in PostgreSQL, and never returned to this browser or exposed to visitors.
                </p>
                <form onSubmit={handleSaveApiKey} className="mt-6 grid gap-5">
                  <label className="grid gap-2">
                    <span className={fieldLabelClass}>{apiConfigured ? "Replace API key" : "API key"}</span>
                    <Input
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={apiConfigured ? "Enter a new key to replace the current one" : "Paste integration API key"}
                      autoComplete="new-password"
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button className="min-w-[132px] max-sm:w-full" type="submit" disabled={savingApiKey || !apiKey.trim()}>
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      {savingApiKey ? "Verifying..." : apiConfigured ? "Replace key" : "Save key"}
                    </Button>
                    {apiConfigured ? (
                      <Button className="min-w-[132px] max-sm:w-full" variant="destructive" type="button" disabled={savingApiKey} onClick={() => void handleClearApiKey()}>
                        Remove key
                      </Button>
                    ) : null}
                  </div>
                </form>
              </section>

              <section className={`${shell} p-5 sm:p-6`}>
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <div>
                    <p className={labelClass}>Dcord boosts</p>
                    <h2 className="app-title mt-1 text-lg font-semibold">Dcord API key</h2>
                  </div>
                </div>
                <p className="app-copy mt-4 max-w-2xl text-sm leading-6">
                  Used only for Boosts orders. The key is stored server-side and sent to Dcord with X-API-Key.
                </p>
                <form onSubmit={handleSaveDcordApiKey} className="mt-6 grid gap-5">
                  <label className="grid gap-2">
                    <span className={fieldLabelClass}>{dcordConfigured ? "Replace Dcord key" : "Dcord API key"}</span>
                    <Input
                      type="password"
                      value={dcordApiKey}
                      onChange={(event) => setDcordApiKey(event.target.value)}
                      placeholder={dcordConfigured ? "Enter a new Dcord key" : "Paste Dcord API key"}
                      autoComplete="new-password"
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Button className="min-w-[132px] max-sm:w-full" type="submit" disabled={savingDcordApiKey || !dcordApiKey.trim()}>
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                      {savingDcordApiKey ? "Saving..." : dcordConfigured ? "Replace key" : "Save key"}
                    </Button>
                    {dcordConfigured ? (
                      <Button className="min-w-[132px] max-sm:w-full" variant="destructive" type="button" disabled={savingDcordApiKey} onClick={() => void handleClearDcordApiKey()}>
                        Remove key
                      </Button>
                    ) : null}
                  </div>
                </form>
              </section>
              </div>

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
                      <span className="settings-status-label">API access</span>
                      <strong>{apiConfigured ? "Tokenu configured" : "Tokenu missing"}</strong>
                    </span>
                  </div>
                  <div className="settings-status-row">
                    <span className="stat-icon" aria-hidden="true">
                      <KeyRound className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="settings-status-label">Dcord access</span>
                      <strong>{dcordConfigured ? "Configured" : "Missing"}</strong>
                    </span>
                  </div>
                  <div className="settings-status-row">
                    <span className="stat-icon" aria-hidden="true">
                      <CircleDollarSign className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="settings-status-label">Tokenu balance</span>
                      {loadingBalance ? (
                        <Skeleton className="mt-2 h-4 w-24" aria-label="Loading balance" />
                      ) : (
                        <strong>{balance === null ? "Not synced" : `$${formatNumber(balance)}`}</strong>
                      )}
                    </span>
                  </div>
                  <div className="settings-status-row">
                    <span className="stat-icon" aria-hidden="true">
                      <CircleDollarSign className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="settings-status-label">Dcord balance</span>
                      {loadingDcordBalance ? (
                        <Skeleton className="mt-2 h-4 w-24" aria-label="Loading Dcord balance" />
                      ) : (
                        <strong>{dcordBalance === null ? "Not synced" : `${formatNumber(dcordBalance)} credits`}</strong>
                      )}
                      {dcordCreditsConsumed !== null ? (
                        <span className="mt-1 block text-xs text-[var(--app-muted)]">{formatNumber(dcordCreditsConsumed)} credits used</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="settings-status-row">
                    <span className="stat-icon" aria-hidden="true">
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="settings-status-label">Credential storage</span>
                      <strong>Encrypted PostgreSQL</strong>
                    </span>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                <Button className="w-full" variant="secondary" type="button" onClick={refreshBalance} disabled={!apiConfigured || loadingBalance}>
                  <RefreshCw className={`h-4 w-4 ${loadingBalance ? "animate-spin" : ""}`} aria-hidden="true" />
                  Refresh Tokenu balance
                </Button>
                <Button className="w-full" variant="secondary" type="button" onClick={refreshDcordBalance} disabled={!dcordConfigured || loadingDcordBalance}>
                  <RefreshCw className={`h-4 w-4 ${loadingDcordBalance ? "animate-spin" : ""}`} aria-hidden="true" />
                  Refresh Dcord balance
                </Button>
                </div>

              </aside>
            </div>
          </>
        ) : null}
        </div>
      </TimedReveal>

      {orderPendingDeletion ? (
        <div
          className="confirm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingTrackedOrder) setOrderPendingDeletion(null);
          }}
        >
          <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-order-title" aria-describedby="delete-order-description">
            <span className="confirm-modal-icon" aria-hidden="true"><TriangleAlert className="h-5 w-5" /></span>
            <p className="app-kicker text-[var(--app-danger)]">Remove order</p>
            <h2 id="delete-order-title">Stop tracking this order?</h2>
            <p id="delete-order-description">This removes <strong>{orderPendingDeletion.uniqid}</strong> from your Manage list and tracked orders database. It does not cancel the upstream order.</p>
            <div className="confirm-modal-actions">
              <Button autoFocus type="button" variant="secondary" disabled={deletingTrackedOrder} onClick={() => setOrderPendingDeletion(null)}>Keep order</Button>
              <Button type="button" variant="destructive" disabled={deletingTrackedOrder} onClick={() => void confirmTrackedOrderDeletion()}>
                {deletingTrackedOrder ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {deletingTrackedOrder ? "Removing..." : "Remove order"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showAddTokensModal ? (
        <div
          className="confirm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingBoostStock) setShowAddTokensModal(false);
          }}
        >
          <div className="confirm-modal w-[min(920px,calc(100vw-2rem))] max-w-none" role="dialog" aria-modal="true" aria-labelledby="add-tokens-title">
            <span className="confirm-modal-icon is-success" aria-hidden="true"><Plus className="h-5 w-5" /></span>
            <p className="app-kicker text-[var(--app-accent)]">Stock</p>
            <h2 id="add-tokens-title">Add boost tokens</h2>
            <p>Paste one token per line. Tokens are stored in encrypted PostgreSQL and used only when a Boosts order runs.</p>

            <form onSubmit={handleSaveBoostStock} className="mt-5 grid gap-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2">
                  <span className={fieldLabelClass}>1 month tokens</span>
                  <textarea
                    className="ui-input min-h-72 resize-y rounded-xl px-3.5 py-3 font-mono text-xs"
                    value={boostTokenDrafts.oneMonthTokens}
                    onChange={(event) => setBoostTokenDrafts((current) => ({ ...current, oneMonthTokens: event.target.value }))}
                    placeholder="One token per line"
                    autoFocus
                  />
                  <span className="text-xs text-[var(--app-muted)]">Current capacity: {boostStock.oneMonth * 2} boosts</span>
                </label>

                <label className="grid gap-2">
                  <span className={fieldLabelClass}>3 month tokens</span>
                  <textarea
                    className="ui-input min-h-72 resize-y rounded-xl px-3.5 py-3 font-mono text-xs"
                    value={boostTokenDrafts.threeMonthTokens}
                    onChange={(event) => setBoostTokenDrafts((current) => ({ ...current, threeMonthTokens: event.target.value }))}
                    placeholder="One token per line"
                  />
                  <span className="text-xs text-[var(--app-muted)]">Current capacity: {boostStock.threeMonth * 2} boosts</span>
                </label>
              </div>

              <div className="confirm-modal-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={savingBoostStock}
                  onClick={() => setShowAddTokensModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={savingBoostStock || (!boostTokenDrafts.oneMonthTokens && !boostTokenDrafts.threeMonthTokens)}
                  onClick={() => setBoostTokenDrafts(EMPTY_BOOST_TOKEN_DRAFTS)}
                >
                  Clear input
                </Button>
                <Button type="submit" disabled={savingBoostStock}>
                  {savingBoostStock ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                  {savingBoostStock ? "Saving..." : "Add to stock"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
