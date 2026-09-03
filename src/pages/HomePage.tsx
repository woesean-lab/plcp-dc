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
  Timer,
  TriangleAlert,
  Trash2,
  Users,
} from "lucide-react";
import { loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import { extractBotInvite, getPlainDetails } from "../lib/bot-invite";
import { extractDiscordInviteCode, resolveDiscordGuildId, resolveDiscordGuildInfo } from "../lib/discord";
import { buildGuestOrderLink } from "../lib/order-links";
import {
  clearCommunityConfig,
  getCommunityAdminStatus,
  getCommunityConfig,
  removeCommunityAuthorization,
  saveCommunityConfig,
  syncCommunityAuthorizations,
  type CommunityAdminStatus,
  type CommunityConfig
} from "../lib/community";
import { normalizeAdminTab, type AdminTab } from "../lib/navigation";
import { isBoostService, isCommunityService, SERVICE_OPTIONS } from "../lib/services";
import {
  checkAvailableAmount,
  checkDcordConnection,
  clearIntegrationApiKey,
  clearDcordApiKey,
  createOrder,
  deleteBoostStockTokens,
  deleteUsedBoostTokens,
  clearDcordProxies,
  getBalance,
  getBoostStockTokens,
  getDcordProxies,
  getOrderStatus,
  getIntegrationConfig,
  markBoostStockTokensUsed,
  restartOrder,
  returnUsedBoostToken,
  saveBoostStock,
  saveDcordApiKey,
  saveDcordProxies,
  saveIntegrationApiKey
} from "../lib/integration";
import type { BoostStock, BoostTokenStockInput, BoostTokenStockSnapshot, BoostUsedToken, CreateOrderPayload, OrderStatusResponse, ServiceType, TrackedOrder } from "../types";

const EMPTY_FORM = {
  service: "OAUTH-ONLINE" as ServiceType,
  serverId: "",
  amount: 100,
  delay: 1,
  billingCycle: 1,
  duration: 1 as const,
  useProxy: true,
  concurrency: 7
};

const EMPTY_BOOST_STOCK: BoostStock = {
  oneMonth: 0,
  threeMonth: 0
};

const EMPTY_BOOST_TOKEN_DRAFTS: BoostTokenStockInput = {
  oneMonthTokens: "",
  threeMonthTokens: ""
};

function parseProxyDraft(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeProxyDraft(value: string) {
  return value
    .split(/(\r\n|\n|\r|,)/)
    .map((part) => {
      if (/^(\r\n|\n|\r|,)$/.test(part)) return part;
      const entry = part.trim();
      if (!entry || entry.includes("@") || /^https?:\/\//i.test(entry)) return part;
      const [host, port, username, password, ...extra] = entry.split(":");
      return host && port && username && password && !extra.length
        ? `${username}:${password}@${host}:${port}`
        : part;
    })
    .join("");
}

function getCommunityRecordBadge(record: CommunityAdminStatus["recent"][number]) {
  if (record.reservedOrderId) return { label: "In order", variant: "secondary" as const };
  if (record.status === "failed") return { label: "Inactive", variant: "destructive" as const };
  if (record.status === "already_member") return { label: "In server", variant: "success" as const };
  if (record.status === "joined") return { label: "Joined", variant: "success" as const };
  return { label: "Connected", variant: "success" as const };
}

const EMPTY_COMMUNITY_CONFIG_DRAFT = {
  clientId: "",
  clientSecret: "",
  botToken: "",
  redirectUri: ""
};

const BOOST_MEMBERSHIP_SCREENING_MESSAGE = "Membership screening is enabled on this server. Disable the join form before boosting.";

type FilterOption = {
  value: string;
  label: string;
};

function FilterDropdown({
  label,
  value,
  options,
  onChange,
  showLabel = true
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="filter-dropdown">
      {showLabel ? <span className={fieldLabelClass}>{label}</span> : null}
      <button
        type="button"
        className={`filter-dropdown-trigger ${open ? "is-open" : ""}`}
        aria-label={label}
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
const ACTIVE_SYNC_BATCH_SIZE = 3;
const ACTIVE_SYNC_PAUSE_MS = 1000;
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

function formatOrderStatus(status?: string) {
  const label = String(status ?? "New").trim().replace(/[_-]+/g, " ").toLowerCase();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "New";
}

function getTrackedTimestamp(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
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
  if (["error", "invalid", "terminated", "canceled", "cancelled", "paused"].some((value) => normalized.includes(value))) {
    return "destructive";
  }
  return "secondary";
}

function getOrderStatusTone(status?: string): "active" | "success" | "danger" {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("completed")) return "success";
  if (["error", "invalid", "terminated", "canceled", "cancelled", "paused"].some((value) => normalized.includes(value))) {
    return "danger";
  }
  return "active";
}

function isTerminalOrder(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  return ["completed", "partial", "canceled", "cancelled", "terminated", "invalid", "error"].some((value) => normalized.includes(value));
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
      {tab === "manage" ? (
        <header className="page-heading orders-page-heading" aria-hidden="true">
          <div className="w-full max-w-2xl">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-9 w-40" />
            <Skeleton className="mt-3 h-4 w-96 max-w-full" />
          </div>
          <div className="orders-heading-actions">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-28" />
          </div>
        </header>
      ) : <SkeletonHeading />}

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
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
              <SkeletonField className="md:col-span-2" />
            </div>
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      ) : null}

      {tab === "manage" ? (
        <div className="grid gap-5" aria-hidden="true">
          <div className="orders-summary-strip">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index}>
                <span><Skeleton className="h-2.5 w-20" /></span>
                <strong><Skeleton className="h-7 w-8" /></strong>
                <small><Skeleton className="h-2.5 w-24" /></small>
              </div>
            ))}
          </div>

          <div className={`${shell} orders-workspace`}>
            <div className="orders-commandbar">
              <Skeleton className="h-11 w-full" />
              <SkeletonField />
              <SkeletonField />
              <div className="orders-import-control">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-10 w-16" />
              </div>
            </div>
            <div className="orders-list-meta">
              <Skeleton className="h-2.5 w-28" />
              <Skeleton className="h-2.5 w-16" />
            </div>
            <div className="orders-table">
              <div className="orders-table-head">
                <span>Order</span><span>Service</span><span>Status</span><span>Delivery</span><span>Created</span><span>Actions</span>
              </div>
              <ol className="orders-row-list">
                {Array.from({ length: 4 }).map((_, index) => (
                  <li key={index}>
                    <div className="orders-row">
                      <div className="orders-row-identity">
                        <Skeleton className="h-[34px] w-[34px]" />
                        <span className="min-w-0"><Skeleton className="h-4 w-36 max-w-full" /><Skeleton className="mt-2 h-2.5 w-28 max-w-full" /></span>
                      </div>
                      <div className="orders-row-service"><Skeleton className="h-4 w-20" /><Skeleton className="h-2.5 w-14" /></div>
                      <div className="orders-row-status"><Skeleton className="h-6 w-20" /></div>
                      <div className="orders-row-delivery">
                        <div><Skeleton className="h-2.5 w-12" /><Skeleton className="mt-2 h-4 w-8" /></div>
                        <div><Skeleton className="h-2.5 w-10" /><Skeleton className="mt-2 h-4 w-10" /></div>
                        <div><Skeleton className="h-2.5 w-10" /><Skeleton className="mt-2 h-4 w-10" /></div>
                      </div>
                      <Skeleton className="orders-row-date h-3 w-20" />
                      <div className="orders-row-actions"><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /><Skeleton className="h-8 w-8" /></div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
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
  const [dcordProxyDraft, setDcordProxyDraft] = useState("");
  const [dcordProxyCount, setDcordProxyCount] = useState(0);
  const [usedBoostTokens, setUsedBoostTokens] = useState<BoostUsedToken[]>([]);
  const [selectedBoostTokens, setSelectedBoostTokens] = useState<Record<string, boolean>>({});
  const [selectedUsedBoostTokens, setSelectedUsedBoostTokens] = useState<Record<string, boolean>>({});
  const [stockCategory, setStockCategory] = useState<"boosts" | "offline">("boosts");
  const [stockView, setStockView] = useState<"active" | "used">("active");
  const [usedTokenDurationFilter, setUsedTokenDurationFilter] = useState<"all" | 1 | 3>("all");
  const [balance, setBalance] = useState<number | null>(null);
  const [communityStatus, setCommunityStatus] = useState<CommunityAdminStatus | null>(null);
  const [communityConfig, setCommunityConfig] = useState<CommunityConfig | null>(null);
  const [communityConfigDraft, setCommunityConfigDraft] = useState(EMPTY_COMMUNITY_CONFIG_DRAFT);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [savingDcordApiKey, setSavingDcordApiKey] = useState(false);
  const [savingBoostStock, setSavingBoostStock] = useState(false);
  const [loadingBoostStock, setLoadingBoostStock] = useState(false);
  const [savingDcordProxies, setSavingDcordProxies] = useState(false);
  const [loadingDcordProxies, setLoadingDcordProxies] = useState(false);
  const [deletingBoostTokens, setDeletingBoostTokens] = useState(false);
  const [markingBoostTokensUsed, setMarkingBoostTokensUsed] = useState(false);
  const [deletingUsedTokens, setDeletingUsedTokens] = useState(false);
  const [returningUsedTokenId, setReturningUsedTokenId] = useState<string | null>(null);
  const [showAddTokensModal, setShowAddTokensModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [checkingDcordConnection, setCheckingDcordConnection] = useState(false);
  const [loadingCommunityStatus, setLoadingCommunityStatus] = useState(false);
  const [removingCommunityUserId, setRemovingCommunityUserId] = useState<string | null>(null);
  const [savingCommunityConfig, setSavingCommunityConfig] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [refreshingManage, setRefreshingManage] = useState(false);
  const [restartingOrderId, setRestartingOrderId] = useState<string | null>(null);
  const [orderPendingDeletion, setOrderPendingDeletion] = useState<TrackedOrder | null>(null);
  const [communityMemberPendingDeletion, setCommunityMemberPendingDeletion] = useState<CommunityAdminStatus["recent"][number] | null>(null);
  const [orderConfirmationPayload, setOrderConfirmationPayload] = useState<CreateOrderPayload | null>(null);
  const [boostScreeningPendingPayload, setBoostScreeningPendingPayload] = useState<CreateOrderPayload | null>(null);
  const [deletingTrackedOrder, setDeletingTrackedOrder] = useState(false);
  const [availability, setAvailability] = useState("");
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [orderIdToTrack, setOrderIdToTrack] = useState("");
  const [currentOrderPage, setCurrentOrderPage] = useState(1);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");

  const activeOrders = useMemo(
    () => orders.filter((order) => !isTerminalOrder(order.status)),
    [orders]
  );
  const completedOrderCount = useMemo(
    () => orders.filter((order) => String(order.status ?? "").toUpperCase().includes("COMPLETED")).length,
    [orders]
  );
  const processingOrderCount = useMemo(
    () => orders.filter((order) => String(order.status ?? "").toUpperCase().includes("PROCESS")).length,
    [orders]
  );
  const attentionOrderCount = useMemo(
    () => orders.filter((order) => ["WAITING", "ERROR", "INVALID", "TERMINATED", "PAUSED"].some((value) => String(order.status ?? "").toUpperCase().includes(value))).length,
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
  const selectedIsCommunity = isCommunityService(form.service);
  const selectedApiConfigured = selectedIsBoost ? dcordConfigured : selectedIsCommunity ? Boolean(communityStatus?.configured) : apiConfigured;
  const selectedCanCreate = selectedApiConfigured && (!selectedIsCommunity || (communityStatus?.ready ?? 0) > 0);
  const selectedBoostCapacity = form.duration === 3 ? boostStock.threeMonth * 2 : boostStock.oneMonth * 2;
  const filteredUsedBoostTokens = useMemo(
    () => {
      const filtered = usedTokenDurationFilter === "all"
        ? usedBoostTokens
        : usedBoostTokens.filter((item) => item.duration === usedTokenDurationFilter);

      return [...filtered].sort((left, right) => {
        const dateDifference = getTrackedTimestamp(right.resultAt ?? right.usedAt) - getTrackedTimestamp(left.resultAt ?? left.usedAt);
        return dateDifference || right.id.localeCompare(left.id);
      });
    },
    [usedBoostTokens, usedTokenDurationFilter]
  );
  const selectedUsedTokenIds = filteredUsedBoostTokens.filter((item) => selectedUsedBoostTokens[item.id]).map((item) => item.id);
  const dcordProxyDraftCount = useMemo(() => parseProxyDraft(dcordProxyDraft).length, [dcordProxyDraft]);
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
    if (!orderPendingDeletion && !communityMemberPendingDeletion) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (orderPendingDeletion && !deletingTrackedOrder) setOrderPendingDeletion(null);
      if (communityMemberPendingDeletion && removingCommunityUserId === null) setCommunityMemberPendingDeletion(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [orderPendingDeletion, communityMemberPendingDeletion, deletingTrackedOrder, removingCommunityUserId]);

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
    void loadCommunityConfiguration();
    // Tokenu balance is loaded lazily when Settings is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, apiConfigured, dcordConfigured]);

  useEffect(() => {
    if (activeTab !== "stock") return;
    void refreshBoostStockTokens();
    void refreshCommunityStatus();
    if (stockCategory === "boosts") void refreshDcordProxies();
    // Stock data is preloaded so switching tabs does not flash empty values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "stock" && stockCategory === "boosts") void refreshDcordProxies();
    // Dcord proxy list is only needed by the Boost Stock panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, stockCategory]);

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

  async function refreshDcordProxies() {
    try {
      setLoadingDcordProxies(true);
      const result = await getDcordProxies();
      setDcordProxyDraft(result.proxies.join("\n"));
      setDcordProxyCount(result.count);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Dcord proxy list could not be loaded.");
    } finally {
      setLoadingDcordProxies(false);
    }
  }

  async function handleCheckDcordConnection() {
    try {
      setCheckingDcordConnection(true);
      const result = await checkDcordConnection();
      if (!result.connected) throw new Error(result.message || "Dcord account is disabled.");
      notifySuccess(result.message || "Dcord connection is healthy.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Dcord connection check failed.");
    } finally {
      setCheckingDcordConnection(false);
    }
  }

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

  useEffect(() => {
    if (activeTab === "create" && selectedIsBoost) void refreshDcordProxies();
    // Proxy stock count is loaded when Boosts is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedIsBoost]);

  useEffect(() => {
    if (activeTab === "create") void refreshCommunityStatus();
    // Members Stock is loaded once when Create opens, not on every invite keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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

  async function refreshCommunityStatus() {
    try {
      setLoadingCommunityStatus(true);
      setCommunityStatus(await getCommunityAdminStatus());
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Community join status could not be loaded.");
    } finally {
      setLoadingCommunityStatus(false);
    }
  }

  async function syncCommunityStatus() {
    try {
      setLoadingCommunityStatus(true);
      const result = await syncCommunityAuthorizations();
      setCommunityStatus(await getCommunityAdminStatus());
      const inactive = result.inactive ?? result.removed;
      if (inactive) {
        notifySuccess(`${inactive} disconnected user${inactive === 1 ? "" : "s"} marked inactive.`);
      } else if (result.errors) {
        notifyError(`${result.errors} authorization${result.errors === 1 ? "" : "s"} could not be checked. No records were changed.`);
      } else {
        notifySuccess(`${result.checked} connected user${result.checked === 1 ? "" : "s"} verified.`);
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Members Stock could not be synced.");
    } finally {
      setLoadingCommunityStatus(false);
    }
  }

  async function removeConnectedCommunityUser(record: CommunityAdminStatus["recent"][number]) {
    try {
      setRemovingCommunityUserId(record.id);
      await removeCommunityAuthorization(record.id);
      setCommunityStatus(await getCommunityAdminStatus());
      setCommunityMemberPendingDeletion(null);
      notifySuccess(`${record.username} disconnected and removed from Members Stock.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Connected user could not be removed.");
    } finally {
      setRemovingCommunityUserId(null);
    }
  }

  async function loadCommunityConfiguration() {
    try {
      const config = await getCommunityConfig();
      setCommunityConfig(config);
      setCommunityConfigDraft({
        clientId: config.clientId,
        clientSecret: "",
        botToken: "",
        redirectUri: config.redirectUri
      });
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Members bot settings could not be loaded.");
    }
  }

  async function handleSaveCommunityConfig(event: FormEvent) {
    event.preventDefault();
    try {
      setSavingCommunityConfig(true);
      const config = await saveCommunityConfig(communityConfigDraft);
      setCommunityConfig(config);
      setCommunityConfigDraft((current) => ({ ...current, clientSecret: "", botToken: "" }));
      setCommunityStatus(null);
      notifySuccess(`${config.guildName ?? "Members bot"} verified and saved securely.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Members bot settings could not be saved.");
    } finally {
      setSavingCommunityConfig(false);
    }
  }

  async function handleClearCommunityConfig() {
    try {
      setSavingCommunityConfig(true);
      await clearCommunityConfig();
      await loadCommunityConfiguration();
      setCommunityStatus(null);
      notifySuccess("Saved Members bot settings removed.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Members bot settings could not be removed.");
    } finally {
      setSavingCommunityConfig(false);
    }
  }

  async function copyCommunityJoinLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/join`);
      notifySuccess("Community join link copied.");
    } catch {
      notifyError("Community join link could not be copied.");
    }
  }

  async function refreshAvailability() {
    try {
      setCheckingAvailability(true);
      const serverId = selectedIsBoost || selectedIsCommunity ? form.serverId.trim() : await resolveDiscordGuildId(form.serverId);
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

  async function handleSaveDcordProxies() {
    const proxies = parseProxyDraft(dcordProxyDraft);
    try {
      setSavingDcordProxies(true);
      const result = await saveDcordProxies(proxies);
      setDcordProxyDraft(result.proxies.join("\n"));
      setDcordProxyCount(result.count);
      notifySuccess(`${result.count} sticky prox${result.count === 1 ? "y" : "ies"} saved.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Dcord proxies could not be saved.");
    } finally {
      setSavingDcordProxies(false);
    }
  }

  async function handleClearDcordProxies() {
    try {
      setSavingDcordProxies(true);
      await clearDcordProxies();
      setDcordProxyDraft("");
      setDcordProxyCount(0);
      notifySuccess("Sticky proxy list cleared.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Dcord proxies could not be cleared.");
    } finally {
      setSavingDcordProxies(false);
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

  async function copyBoostTokens(tokens: string[]) {
    if (!tokens.length) {
      notifyError("Select tokens to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(tokens.join("\n"));
      notifySuccess(`${tokens.length} token${tokens.length === 1 ? "" : "s"} copied.`);
    } catch {
      notifyError("Selected tokens could not be copied.");
    }
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
    const parsedStatusDelay = parseDelay(status.delay);
    const resolvedStatusDelay = parsedStatusDelay ?? order.statusDelay;
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
        // The regular Orders refresh can verify the status if the upstream service needs more time.
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Order could not be continued.");
    } finally {
      setRestartingOrderId(null);
    }
  }

  async function syncTrackedOrders() {
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
        await saveTrackedOrders(nextOrders);
      }
      notifySuccess("Orders synced.");
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

  async function submitCreateOrder(payload: CreateOrderPayload) {
    const targetId = String(payload.id ?? "").trim();
    const payloadIsBoost = isBoostService(payload.service);
    const payloadIsCommunity = isCommunityService(payload.service);
    const serverInfo = await resolveDiscordGuildInfo(targetId);
    const serverId = serverInfo.guildId;
    const created = await createOrder({
      ...payload,
      id: payloadIsBoost || payloadIsCommunity ? targetId : serverId
    });
    const createdStock = (created as { stock?: BoostStock }).stock;
    if (createdStock) {
      setBoostStock(createdStock);
    }

    const nextOrder: TrackedOrder = {
      uniqid: created.uniqid,
      provider: payloadIsBoost ? "dcord" : payloadIsCommunity ? "community" : "tokenu",
      service: payload.service,
      serverId,
      serverName: serverInfo.guildName,
      amount: payload.amount,
      added: 0,
      delay: payloadIsBoost ? undefined : payload.delay,
      billingCycle: payload.service === "OAUTH-ONLINE" ? payload.billingCycle : undefined,
      duration: payloadIsBoost ? payload.duration : undefined,
      useProxy: payloadIsBoost ? true : undefined,
      concurrency: payloadIsBoost ? payload.concurrency : undefined,
      cost: created.cost,
      botInvite: created.bot_invite,
      serverInvite: extractDiscordInviteCode(targetId) ? targetId : undefined,
      serverMemberCount: serverInfo.approximateMemberCount,
      createdAt: new Date().toISOString(),
      status: "NEW"
    };

    persistOrders([nextOrder, ...orders]);
    notifySuccess(`Order created: ${created.uniqid}`);
    const providerQuery = payloadIsBoost ? "&provider=dcord" : payloadIsCommunity ? "&provider=community" : "";
    navigate(`/orders?uniqid=${encodeURIComponent(created.uniqid)}${providerQuery}`);
  }

  function handleCreateOrder(event: FormEvent) {
    event.preventDefault();

    const payload: CreateOrderPayload = {
      service: form.service,
      id: form.serverId.trim(),
      amount: form.amount,
      delay: selectedIsBoost ? undefined : form.delay,
      billingCycle: form.service === "OAUTH-ONLINE" ? form.billingCycle : undefined,
      duration: selectedIsBoost ? form.duration : undefined,
      useProxy: selectedIsBoost ? true : undefined,
      concurrency: selectedIsBoost ? form.concurrency : undefined
    };

    if (selectedIsBoost && form.amount % 2 !== 0) {
      notifyError("Boost amount must be an even number.");
      return;
    }
    setOrderConfirmationPayload(payload);
  }

  async function confirmCreateOrder() {
    if (!orderConfirmationPayload || creating) return;
    const payload = orderConfirmationPayload;
    const payloadIsBoost = isBoostService(payload.service);
    setOrderConfirmationPayload(null);
    setCreating(true);
    try {
      await submitCreateOrder(payload);
    } catch (error) {
      if (payloadIsBoost && error instanceof Error && error.message === BOOST_MEMBERSHIP_SCREENING_MESSAGE) {
        setBoostScreeningPendingPayload(payload);
        return;
      }
      notifyError(error instanceof Error ? error.message : "Order could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function retryBoostOrderAfterScreening() {
    if (!boostScreeningPendingPayload || creating) return;
    setCreating(true);
    try {
      await submitCreateOrder(boostScreeningPendingPayload);
      setBoostScreeningPendingPayload(null);
    } catch (error) {
      if (error instanceof Error && error.message === BOOST_MEMBERSHIP_SCREENING_MESSAGE) {
        notifyError("Registration form is still enabled. No order was created.");
      } else {
        notifyError(error instanceof Error ? error.message : "Order could not be created.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function continueBoostOrderDespiteScreening() {
    if (!boostScreeningPendingPayload || creating) return;
    const payload = boostScreeningPendingPayload;
    setCreating(true);
    try {
      await submitCreateOrder({ ...payload, allowMembershipScreening: true });
      setBoostScreeningPendingPayload(null);
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

  const communityStockLoading = loadingCommunityStatus && !communityStatus;
  const communityStockConfigured = Boolean(communityStatus?.configured);
  const communityStockBadge = communityStockLoading
    ? { label: "Loading", variant: "secondary" as const }
    : communityStockConfigured
      ? { label: "Ready", variant: "success" as const }
      : { label: "Setup required", variant: "destructive" as const };
  const communityTotalUsers = (communityStatus?.authorized ?? 0) + (communityStatus?.failed ?? 0);

  const communityStockPanel = communityStockLoading ? (
    <section className={`${shell} community-admin-panel offline-stock-panel p-5 sm:p-6`}>
      <div className="community-admin-heading">
        <div className="flex min-w-0 items-center gap-3">
          <Skeleton className="h-10 w-10 shrink-0" />
          <div className="min-w-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-6 w-40 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="community-admin-progress members-connected-summary">
        <div><Skeleton className="h-2.5 w-24" /><Skeleton className="mt-4 h-6 w-10" /></div>
        <div><Skeleton className="h-2.5 w-24" /><Skeleton className="mt-4 h-6 w-10" /></div>
        <div><Skeleton className="h-2.5 w-24" /><Skeleton className="mt-4 h-6 w-10" /></div>
        <div><Skeleton className="h-2.5 w-24" /><Skeleton className="mt-4 h-6 w-10" /></div>
      </div>
      <div className="community-recent-list">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index}>
            <Skeleton className="h-[34px] w-[34px]" />
            <span className="min-w-0"><Skeleton className="h-4 w-36 max-w-full" /><Skeleton className="mt-2 h-2.5 w-48 max-w-full" /></span>
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-8 w-8" />
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Skeleton className="h-11 w-52" />
        <Skeleton className="h-11 w-56" />
        <Skeleton className="h-11 w-28" />
      </div>
    </section>
  ) : (
    <section className={`${shell} community-admin-panel offline-stock-panel p-5 sm:p-6`}>
      <div className="community-admin-heading">
        <div className="flex min-w-0 items-center gap-3">
          <span className="stat-icon overflow-hidden" aria-hidden="true">
            {communityStatus?.bot?.avatarUrl
              ? <img className="h-full w-full object-cover" src={communityStatus.bot.avatarUrl} alt="" />
              : <Bot className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className={labelClass}>Members stock</p>
            <h2 className="app-title mt-1 truncate text-lg font-semibold">{communityStatus?.bot?.name ?? "Members Bot"}</h2>
          </div>
        </div>
        <Badge variant={communityStockBadge.variant}>{communityStockBadge.label}</Badge>
      </div>

      <div className="community-admin-progress members-connected-summary">
        <div><span>Total users</span><strong>{communityTotalUsers}</strong></div>
        <div><span>Available users</span><strong>{communityStatus?.ready ?? 0}</strong></div>
        <div><span>Connected users</span><strong>{communityStatus?.authorized ?? 0}</strong></div>
        <div><span>Inactive users</span><strong>{communityStatus?.failed ?? 0}</strong></div>
      </div>

      {!communityStockConfigured ? (
        <p className="community-admin-note">Add the Discord application, bot, callback address and target server settings to activate Members Stock.</p>
      ) : null}

      {communityStatus?.recent?.length ? (
        <div className="community-recent-list">
          {communityStatus.recent.map((record, index) => {
            const badge = getCommunityRecordBadge(record);
            return (
              <div key={record.id || `${record.username}-${record.authorizedAt}-${index}`} data-state={record.status}>
                <span className="community-recent-avatar" aria-hidden="true">
                  {record.avatarUrl ? <img src={record.avatarUrl} alt="" /> : <Users className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0">
                  <strong>{record.username}</strong>
                  <small>{record.details || new Date(record.authorizedAt).toLocaleString()}</small>
                </span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="dangerGhost"
                  title={`Remove ${record.username} from Members Stock`}
                  aria-label={`Remove ${record.username} from Members Stock`}
                  disabled={removingCommunityUserId !== null || Boolean(record.reservedOrderId)}
                  onClick={() => setCommunityMemberPendingDeletion(record)}
                >
                  {removingCommunityUserId === record.id
                    ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                </Button>
              </div>
            );
          })}
        </div>
      ) : communityStatus?.configured ? (
        <div className="stock-empty-state"><Users className="h-5 w-5" /><strong>No members in stock yet</strong><span>Share the authorization link to build your Members Stock.</span></div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" disabled={!communityStockConfigured} onClick={() => void copyCommunityJoinLink()}>
          <Copy className="h-4 w-4" /> Copy authorization link
        </Button>
        <Button asChild type="button" variant="secondary" disabled={!communityStockConfigured}>
          {communityStockConfigured ? (
            <a href="/join" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open authorization page</a>
          ) : <span><ExternalLink className="h-4 w-4" /> Open authorization page</span>}
        </Button>
        <Button type="button" variant="secondary" disabled={loadingCommunityStatus || !communityStockConfigured} onClick={() => void syncCommunityStatus()}>
          <RefreshCw className={`h-4 w-4 ${loadingCommunityStatus ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
    </section>
  );

  const showManageSkeleton = refreshingManage && !orders.length;

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
                      <span className="service-selector-count">3 services</span>
                    </div>
                    <div className="service-grid service-grid-compact choose-service-grid">
                      {[
                        { value: "members", title: "Members", description: "Tokenu member delivery", icon: KeyRound },
                        { value: "community", title: "Members 2", description: "Connected OAuth stock", icon: Users },
                        { value: "boosts", title: "Boosts", description: "Dcord join + boost delivery", icon: boostServiceOption?.icon ?? Plus }
                      ].map((option, index) => {
                        const Icon = option.icon;
                        const selected = option.value === "boosts"
                          ? selectedIsBoost
                          : option.value === "community"
                            ? selectedIsCommunity
                            : !selectedIsBoost && !selectedIsCommunity;

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
                                  service: option.value === "boosts"
                                    ? "DCORD-BOOSTS"
                                    : option.value === "community"
                                      ? "COMMUNITY-OFFLINE"
                                      : memberServiceOptions[0]?.value ?? "OAUTH-ONLINE",
                                  amount: option.value === "boosts" ? 2 : option.value === "community" ? Math.max(1, Math.min(100, communityStatus?.ready ?? 1)) : 100
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

                  {!selectedIsBoost && !selectedIsCommunity ? (
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

                  {selectedIsCommunity ? (
                    <fieldset className="service-selector md:col-span-2">
                      <legend className="sr-only">Members 2 service</legend>
                      <div className="service-selector-heading">
                        <div>
                          <span className={fieldLabelClass}>Member mode</span>
                          <p className="service-selector-copy">Members are delivered from your connected OAuth stock.</p>
                        </div>
                        <span className="service-selector-count">1 mode</span>
                      </div>
                      <div className="service-grid service-grid-compact">
                        <div className="service-option is-selected" data-service="COMMUNITY-OFFLINE">
                          <span className="service-option-head" aria-hidden="true">
                            <span className="service-option-icon"><Users className="h-5 w-5" /></span>
                            <span className="service-option-state"><Check className="h-3 w-3" /> Selected</span>
                          </span>
                          <span className="service-option-title">Offline</span>
                          <span className="service-option-description">{communityStatus?.ready ?? 0} connected members available</span>
                          <span className="service-option-code">COMMUNITY-OFFLINE</span>
                        </div>
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

                          <label className="boost-order-field">
                            <span className="boost-order-label">Concurrency</span>
                            <input
                              className="boost-number-input"
                              type="number"
                              min={1}
                              max={20}
                              value={form.concurrency}
                              onChange={(event) => {
                                const value = Math.min(Math.max(Number(event.target.value) || 1, 1), 20);
                                setForm((current) => ({ ...current, concurrency: value }));
                              }}
                            />
                          </label>

                          <label className="boost-proxy-toggle is-enabled">
                            <input
                              type="checkbox"
                              checked
                              disabled
                            />
                            <span><ShieldCheck className="h-4 w-4" aria-hidden="true" /></span>
                            <strong>One-time proxy required</strong>
                            <small>{dcordProxyCount ? `${dcordProxyCount} available; one is consumed per token` : "No proxies saved"}</small>
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
                              max={selectedIsCommunity ? Math.max(1, communityStatus?.ready ?? 0) : undefined}
                              value={form.amount}
                              onChange={(event) => {
                                const requested = Number(event.target.value) || 1;
                                const amount = selectedIsCommunity ? Math.min(requested, Math.max(1, communityStatus?.ready ?? 0)) : requested;
                                setForm((current) => ({ ...current, amount }));
                              }}
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
                  <Button className="min-w-[150px] px-4 py-2.5 max-sm:w-full" type="submit" disabled={creating || !selectedCanCreate}>
                    {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    {creating ? "Creating..." : "Create order"}
                  </Button>
                  {!selectedApiConfigured ? (
                    <Button asChild variant="secondary" className="max-sm:w-full">
                      <Link to="/manage?tab=settings">
                        <Settings2 className="h-4 w-4" aria-hidden="true" />
                        Configure {selectedIsBoost ? "Dcord" : selectedIsCommunity ? "Members bot" : "Tokenu"}
                      </Link>
                    </Button>
                  ) : null}
                  {selectedIsCommunity && selectedApiConfigured && (communityStatus?.ready ?? 0) === 0 ? (
                    <span className="self-center text-sm text-[var(--app-muted)]">No connected members are available.</span>
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
              <header className="page-heading orders-page-heading">
                <div>
                  <p className={labelClass}>Operations</p>
                  <h1 className="page-title">Orders</h1>
                  <p className="app-copy page-copy">Track delivery, spot blocked orders, and open the full order record.</p>
                </div>
                <div className="orders-heading-actions">
                  <Button asChild size="sm"><Link to="/manage?tab=create"><Plus className="h-4 w-4" /> New order</Link></Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void syncTrackedOrders()} disabled={refreshingManage || !activeOrders.length}>
                    <RefreshCw className={`h-4 w-4 ${refreshingManage ? "animate-spin" : ""}`} />
                    {refreshingManage ? "Syncing..." : "Sync active"}
                  </Button>
                </div>
              </header>

              <section className="orders-summary-strip" aria-label="Order overview">
                <div><span>Total orders</span><strong>{orders.length}</strong><small>tracked records</small></div>
                <div data-tone="active"><span>In progress</span><strong>{processingOrderCount}</strong><small>live deliveries</small></div>
                <div data-tone="success"><span>Completed</span><strong>{completedOrderCount}</strong><small>finished orders</small></div>
                <div data-tone={attentionOrderCount ? "danger" : "muted"}><span>Needs attention</span><strong>{attentionOrderCount}</strong><small>waiting or failed</small></div>
              </section>

              <section className={`${shell} orders-workspace`}>
                <div className="orders-commandbar">
                  <label className="orders-search-field">
                    <Search className="h-4 w-4" aria-hidden="true" />
                    <Input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Search order ID, server or service" aria-label="Search orders" />
                  </label>
                  <FilterDropdown label="Status" showLabel={false} value={orderStatusFilter} onChange={setOrderStatusFilter} options={[
                    { value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "waiting", label: "Waiting" },
                    { value: "completed", label: "Completed" }, { value: "failed", label: "Failed" }
                  ]} />
                  <FilterDropdown label="Type" showLabel={false} value={orderTypeFilter} onChange={setOrderTypeFilter} options={[
                    { value: "all", label: "All services" }, { value: "members", label: "Members" }, { value: "boosts", label: "Boosts" }
                  ]} />
                  <div className="orders-import-control">
                    <Input value={orderIdToTrack} onChange={(event) => setOrderIdToTrack(event.target.value)} placeholder="Add existing order ID" aria-label="Existing order ID" className="font-mono" />
                    <Button type="button" variant="secondary" size="sm" onClick={trackOrderManually}><Plus className="h-4 w-4" /> Add</Button>
                  </div>
                </div>

                <div className="orders-list-meta">
                  <span>{filteredOrders.length} results · newest first</span>
                  <span>Page {currentOrderPage} / {orderPageCount}</span>
                </div>

                {filteredOrders.length ? (
                  <div className="orders-table" role="table" aria-label="Tracked orders">
                    <div className="orders-table-head" role="row">
                      <span>Order</span><span>Service</span><span>Status</span><span>Delivery</span><span>Created</span><span>Actions</span>
                    </div>
                    <ol className="orders-row-list">
                      {paginatedOrders.map((order, index) => {
                        const serviceOption = SERVICE_OPTIONS.find((option) => option.value === order.service);
                        const ServiceIcon = serviceOption?.icon ?? KeyRound;
                        const progress = getOrderProgress(order);
                        const boostOrder = order.provider === "dcord" || isBoostService(order.service);
                        const providerQuery = order.provider === "dcord" ? "&provider=dcord" : order.provider === "community" ? "&provider=community" : "";
                        const serviceKind = boostOrder ? "boosts" : order.provider === "community" ? "community" : "members";
                        const botInvite = extractBotInvite(order);
                        const botInviteRequired = ["NEW", "WAITING"].includes(String(order.status ?? "").trim().toUpperCase()) ? botInvite : null;
                        const isInvitesPaused = String(order.status ?? "").trim().toUpperCase().includes("INVITES PAUSED");
                        const delayValue = order.statusDelay ?? order.delay;
                        const titleId = `orders-row-${(currentOrderPage - 1) * ORDER_PAGE_SIZE + index}`;

                        return (
                          <li key={order.uniqid}>
                            <article className="orders-row" data-status-tone={getOrderStatusTone(order.status)} data-service-kind={serviceKind} aria-labelledby={titleId}>
                              <div className="orders-row-identity">
                                <span className="orders-row-service-icon" aria-hidden="true"><ServiceIcon className="h-4 w-4" /></span>
                                <span className="min-w-0">
                                  <h2 id={titleId}>{order.serverName || "Discord server"}</h2>
                                  <code title={order.uniqid}>{order.uniqid}</code>
                                </span>
                              </div>
                              <div className="orders-row-service">
                                <strong>{serviceOption?.title ?? "Manual"}</strong>
                                <span>{boostOrder && order.duration ? `${order.duration} month` : order.provider === "community" ? "Members 2" : "Members"}</span>
                              </div>
                              <div className="orders-row-status">
                                <Badge className="orders-status-badge" data-status={String(order.status ?? "new").toLowerCase()} variant={getOrderStatusVariant(order.status)}>{formatOrderStatus(order.status)}</Badge>
                              </div>
                              <dl className={`orders-row-delivery ${boostOrder ? "is-boosts" : ""}`}>
                                <div><dt>Total</dt><dd>{formatNumber(order.amount)}</dd></div>
                                <div><dt>Remaining</dt><dd>{progress ? formatNumber(progress.remaining) : "-"}</dd></div>
                                {!boostOrder ? <div><dt>Delay</dt><dd>{formatDelay(delayValue)}</dd></div> : null}
                              </dl>
                              <time className="orders-row-date" dateTime={order.createdAt} title={order.createdAt}>{formatTrackedDate(order.createdAt)}</time>
                              <div className="orders-row-actions" role="group" aria-label={`Actions for ${order.uniqid}`}>
                                {!boostOrder ? <Button type="button" variant="secondary" size="icon" title="Copy monitor link" aria-label="Copy monitor link" onClick={() => void copyGuestLink(order)}><Copy className="h-4 w-4" /></Button> : null}
                                <Button asChild variant="secondary" size="icon" title="Open order"><Link to={`/orders?uniqid=${encodeURIComponent(order.uniqid)}${providerQuery}`} aria-label={`Open order ${order.uniqid}`}><ExternalLink className="h-4 w-4" /></Link></Button>
                                <Button variant="dangerGhost" size="icon" type="button" title="Remove order" aria-label={`Remove ${order.uniqid}`} onClick={() => setOrderPendingDeletion(order)}><Trash2 className="h-4 w-4" /></Button>
                              </div>

                              {botInviteRequired ? <div className="orders-row-alert" data-tone="waiting">
                                <span><Bot className="h-4 w-4" /><strong>Bot required</strong><small>Add the bot to start this order.</small></span>
                                <Button type="button" size="xs" variant="secondary" onClick={() => void copyBotInviteLink(botInviteRequired)}><Copy className="h-3.5 w-3.5" /> Copy link</Button>
                                <Button asChild size="xs"><a href={botInviteRequired} target="_blank" rel="noreferrer"><Bot className="h-3.5 w-3.5" /> Add bot</a></Button>
                              </div> : null}
                              {isInvitesPaused && !boostOrder ? <div className="orders-row-alert" data-tone="danger">
                                <span><TriangleAlert className="h-4 w-4" /><strong>Invites paused</strong><small>Check the invite before continuing.</small></span>
                                <Button type="button" variant="destructive" size="xs" disabled={restartingOrderId !== null} onClick={() => void handleRestartOrder(order)}><RotateCcw className={`h-3.5 w-3.5 ${restartingOrderId === order.uniqid ? "animate-spin" : ""}`} /> Continue</Button>
                              </div> : null}
                            </article>
                          </li>
                        );
                      })}
                    </ol>
                    <div className="orders-pagination">
                      <span>Showing {filteredOrders.length ? (currentOrderPage - 1) * ORDER_PAGE_SIZE + 1 : 0}-{Math.min(currentOrderPage * ORDER_PAGE_SIZE, filteredOrders.length)} of {filteredOrders.length}</span>
                      <div>
                        <Button type="button" variant="secondary" size="xs" onClick={() => setCurrentOrderPage((current) => Math.max(current - 1, 1))} disabled={currentOrderPage <= 1}><ChevronLeft className="h-3.5 w-3.5" /> Prev</Button>
                        <Button type="button" variant="secondary" size="xs" onClick={() => setCurrentOrderPage((current) => Math.min(current + 1, orderPageCount))} disabled={currentOrderPage >= orderPageCount}>Next <ChevronRight className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  </div>
                ) : <div className="orders-empty-state"><Search className="h-5 w-5" /><strong>{orders.length ? "No matching orders" : "No orders yet"}</strong><span>{orders.length ? "Adjust the search or filters." : "Create an order to start tracking delivery."}</span></div>}
              </section>
            </>
          )
        ) : null}

        {activeTab === "stock" ? (
          <>
            <header className="page-heading stock-page-heading">
              <div>
                <p className={labelClass}>Stock</p>
                <h1 className="page-title">Inventory</h1>
                <p className="app-copy page-copy">Manage Boost Stock and Members Stock separately.</p>
              </div>
              {stockCategory === "boosts" ? <div className="stock-heading-actions">
                <Button type="button" variant="secondary" size="sm" disabled={!dcordConfigured || checkingDcordConnection} onClick={() => void handleCheckDcordConnection()}>
                  <ShieldCheck className={`h-4 w-4 ${checkingDcordConnection ? "animate-pulse" : ""}`} aria-hidden="true" />
                  {checkingDcordConnection ? "Checking..." : "Dcord check"}
                </Button>
                <Button type="button" size="sm" onClick={() => setShowAddTokensModal(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add tokens
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={loadingBoostStock} onClick={() => void refreshBoostStockTokens()}>
                  <RefreshCw className={`h-4 w-4 ${loadingBoostStock ? "animate-spin" : ""}`} aria-hidden="true" />
                  Refresh
                </Button>
              </div> : null}
            </header>

            <div className="stock-category-tabs" role="tablist" aria-label="Stock type">
              <button type="button" role="tab" aria-selected={stockCategory === "boosts"} className={stockCategory === "boosts" ? "is-active" : ""} onClick={() => setStockCategory("boosts")}>
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                <span><strong>Boost Stock</strong><small>Manage boost inventory</small></span>
              </button>
              <button type="button" role="tab" aria-selected={stockCategory === "offline"} className={stockCategory === "offline" ? "is-active" : ""} onClick={() => setStockCategory("offline")}>
                <Users className="h-4 w-4" aria-hidden="true" />
                <span><strong>Members Stock</strong><small>Manage connected members</small></span>
              </button>
            </div>

            {stockCategory === "boosts" ? <>
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

            <section className={`${shell} dcord-proxy-panel`}>
              <header className="dcord-proxy-header">
                <div>
                  <p className={labelClass}>Dcord routing</p>
                  <h2>One-time proxies</h2>
                </div>
                <div className="dcord-proxy-actions">
                  <span>{dcordProxyDraftCount} typed / {dcordProxyCount} saved</span>
                  <Button type="button" variant="secondary" size="xs" disabled={loadingDcordProxies || savingDcordProxies} onClick={() => void refreshDcordProxies()}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingDcordProxies ? "animate-spin" : ""}`} aria-hidden="true" />
                    Refresh
                  </Button>
                  <Button type="button" variant="dangerGhost" size="xs" disabled={savingDcordProxies || (!dcordProxyCount && !dcordProxyDraft.trim())} onClick={() => void handleClearDcordProxies()}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Clear
                  </Button>
                  <Button type="button" size="xs" disabled={savingDcordProxies} onClick={() => void handleSaveDcordProxies()}>
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    {savingDcordProxies ? "Saving..." : "Save"}
                  </Button>
                </div>
              </header>
              <textarea
                className="dcord-proxy-textarea"
                spellCheck={false}
                value={dcordProxyDraft}
                onChange={(event) => setDcordProxyDraft(normalizeProxyDraft(event.target.value))}
                placeholder={"user:pass@host:port\nhost:port:user:pass"}
              />
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
                              <Button type="button" size="xs" variant="secondary" onClick={() => void copyBoostTokens(getSelectedTokens(group.duration))} disabled={!selectedCount}>
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
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
                      <Button type="button" size="xs" variant="secondary" onClick={() => void copyBoostTokens(getUsedTokensForDownload(true))} disabled={!selectedUsedTokenIds.length}>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy selected
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
            </> : communityStockPanel}
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
                <Badge variant={communityConfig?.configured ? "success" : "destructive"}>Members bot {communityConfig?.configured ? "Connected" : "Missing"}</Badge>
              </div>
            </header>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
              <div className="grid gap-5">
              <section className={`${shell} p-5 sm:p-6`}>
                <div className="flex items-center gap-3">
                  <span className="stat-icon" aria-hidden="true"><Bot className="h-4 w-4" /></span>
                  <div>
                    <p className={labelClass}>Members stock</p>
                    <h2 className="app-title mt-1 text-lg font-semibold">Discord bot & OAuth</h2>
                  </div>
                </div>
                <p className="app-copy mt-4 max-w-2xl text-sm leading-6">
                  Configure the bot used by Members Stock. Its Discord server is detected automatically. Secrets are encrypted and never shown again after saving.
                </p>

                <form onSubmit={handleSaveCommunityConfig} className="mt-6 grid gap-4">
                  <label className="grid gap-2">
                    <span className={fieldLabelClass}>Client ID</span>
                    <Input value={communityConfigDraft.clientId} onChange={(event) => setCommunityConfigDraft((current) => ({ ...current, clientId: event.target.value }))} placeholder="Discord application Client ID" inputMode="numeric" />
                  </label>

                  <label className="grid gap-2">
                    <span className={fieldLabelClass}>OAuth callback address</span>
                    <Input value={communityConfigDraft.redirectUri} onChange={(event) => setCommunityConfigDraft((current) => ({ ...current, redirectUri: event.target.value }))} placeholder={`${window.location.origin}/api/community/oauth/callback`} />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>Client Secret</span>
                      <Input type="password" value={communityConfigDraft.clientSecret} onChange={(event) => setCommunityConfigDraft((current) => ({ ...current, clientSecret: event.target.value }))} placeholder={communityConfig?.hasClientSecret ? "Saved - leave blank to keep" : "Discord Client Secret"} autoComplete="new-password" />
                    </label>
                    <label className="grid gap-2">
                      <span className={fieldLabelClass}>Bot Token</span>
                      <Input type="password" value={communityConfigDraft.botToken} onChange={(event) => setCommunityConfigDraft((current) => ({ ...current, botToken: event.target.value }))} placeholder={communityConfig?.hasBotToken ? "Saved - leave blank to keep" : "Discord Bot Token"} autoComplete="new-password" />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-3 pt-1">
                    <Button type="submit" disabled={savingCommunityConfig || !communityConfigDraft.clientId.trim() || !communityConfigDraft.redirectUri.trim() || (!communityConfig?.hasClientSecret && !communityConfigDraft.clientSecret.trim()) || (!communityConfig?.hasBotToken && !communityConfigDraft.botToken.trim())}>
                      {savingCommunityConfig ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      {savingCommunityConfig ? "Verifying..." : communityConfig?.configured ? "Update Members bot" : "Verify & save"}
                    </Button>
                    {communityConfig?.stored ? (
                      <Button type="button" variant="destructive" disabled={savingCommunityConfig} onClick={() => void handleClearCommunityConfig()}>Remove saved settings</Button>
                    ) : null}
                  </div>
                </form>
              </section>

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
                    <span className="stat-icon" aria-hidden="true"><Bot className="h-4 w-4" /></span>
                    <span>
                      <span className="settings-status-label">Members bot</span>
                      <strong>{communityConfig?.configured ? "Configured" : "Missing"}</strong>
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
            <p id="delete-order-description">This removes <strong>{orderPendingDeletion.uniqid}</strong> from your Orders list and tracked orders database. It does not cancel the upstream order.</p>
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

      {orderConfirmationPayload ? (
        <div
          className="confirm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creating) setOrderConfirmationPayload(null);
          }}
        >
          <div className="confirm-modal order-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="create-order-title" aria-describedby="create-order-description">
            <span className="confirm-modal-icon is-success" aria-hidden="true"><Check className="h-5 w-5" /></span>
            <p className="app-kicker text-[var(--app-accent)]">Order confirmation</p>
            <h2 id="create-order-title">Create this order?</h2>
            <p id="create-order-description">
              Check the order details before submitting. This action will reserve the required stock.
            </p>
            <div className="order-confirm-summary">
              <div className="order-confirm-primary">
                <span className="order-confirm-service-icon" aria-hidden="true"><Bot className="h-4 w-4" /></span>
                <span className="order-confirm-primary-copy">
                  <small>Service</small>
                  <strong>{SERVICE_OPTIONS.find((option) => option.value === orderConfirmationPayload.service)?.label ?? orderConfirmationPayload.service}</strong>
                </span>
                <span className="order-confirm-amount"><small>Amount</small><strong>{orderConfirmationPayload.amount}</strong></span>
              </div>
              <div className="order-confirm-target">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span><small>Discord invite</small><strong>{orderConfirmationPayload.id}</strong></span>
              </div>
              {(orderConfirmationPayload.duration || orderConfirmationPayload.concurrency || orderConfirmationPayload.delay) ? (
                <div className="order-confirm-meta">
                  {orderConfirmationPayload.duration ? <span><History className="h-3.5 w-3.5" />{orderConfirmationPayload.duration} month</span> : null}
                  {orderConfirmationPayload.concurrency ? <span><Users className="h-3.5 w-3.5" />{orderConfirmationPayload.concurrency} workers</span> : null}
                  {orderConfirmationPayload.duration ? <span><ShieldCheck className="h-3.5 w-3.5" />{orderConfirmationPayload.amount / 2} proxies</span> : null}
                  {orderConfirmationPayload.delay ? <span><Timer className="h-3.5 w-3.5" />{orderConfirmationPayload.delay}s delay</span> : null}
                </div>
              ) : null}
            </div>
            <div className="confirm-modal-actions">
              <Button autoFocus type="button" variant="secondary" disabled={creating} onClick={() => setOrderConfirmationPayload(null)}>Go back</Button>
              <Button type="button" disabled={creating} onClick={() => void confirmCreateOrder()}>
                {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                {creating ? "Creating..." : "Confirm order"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {communityMemberPendingDeletion ? (
        <div
          className="confirm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && removingCommunityUserId === null) setCommunityMemberPendingDeletion(null);
          }}
        >
          <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-member-title" aria-describedby="delete-member-description">
            <span className="confirm-modal-icon" aria-hidden="true"><TriangleAlert className="h-5 w-5" /></span>
            <p className="app-kicker text-[var(--app-danger)]">Remove member</p>
            <h2 id="delete-member-title">Remove this user?</h2>
            <p id="delete-member-description">This removes <strong>{communityMemberPendingDeletion.username}</strong> from Members Stock and revokes the saved Discord authorization.</p>
            <div className="confirm-modal-actions">
              <Button autoFocus type="button" variant="secondary" disabled={removingCommunityUserId !== null} onClick={() => setCommunityMemberPendingDeletion(null)}>Keep user</Button>
              <Button type="button" variant="destructive" disabled={removingCommunityUserId !== null} onClick={() => void removeConnectedCommunityUser(communityMemberPendingDeletion)}>
                {removingCommunityUserId === communityMemberPendingDeletion.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {removingCommunityUserId === communityMemberPendingDeletion.id ? "Removing..." : "Remove user"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {boostScreeningPendingPayload ? (
        <div
          className="confirm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !creating) setBoostScreeningPendingPayload(null);
          }}
        >
          <div className="confirm-modal boost-screening-modal" role="alertdialog" aria-modal="true" aria-labelledby="boost-screening-title" aria-describedby="boost-screening-description">
            <span className="confirm-modal-icon" aria-hidden="true"><TriangleAlert className="h-5 w-5" /></span>
            <p className="app-kicker text-[var(--app-danger)]">Boost warning</p>
            <h2 id="boost-screening-title">Registration form is enabled</h2>
            <p id="boost-screening-description">
              ⚠️ Disable the registration form until your order is complete.
              <br /><br />
              Our bots can’t complete the registration form, so they can’t join your server and add the boosts.
              <br /><br />
              Server Settings → Access → Invite Only
              <br /><br />
              After changing the setting, please create a new server invite link and send it to us.
            </p>
            <div className="confirm-modal-actions">
              <Button autoFocus type="button" variant="secondary" disabled={creating} onClick={() => setBoostScreeningPendingPayload(null)}>Cancel</Button>
              <Button type="button" variant="secondary" disabled={creating} onClick={() => void retryBoostOrderAfterScreening()}>
                {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <TriangleAlert className="h-4 w-4" aria-hidden="true" />}
                {creating ? "Checking..." : "Check again"}
              </Button>
              <Button type="button" variant="destructive" disabled={creating} onClick={() => void continueBoostOrderDespiteScreening()}>
                {creating ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <TriangleAlert className="h-4 w-4" aria-hidden="true" />}
                {creating ? "Creating..." : "Continue anyway"}
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
          <div className="confirm-modal add-tokens-modal w-[min(920px,calc(100vw-2rem))] max-w-none" role="dialog" aria-modal="true" aria-labelledby="add-tokens-title">
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
