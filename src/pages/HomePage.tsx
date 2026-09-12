import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
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
  Crown,
  ExternalLink,
  FileJson,
  Gamepad2,
  Gem,
  Globe2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Download,
  History,
  Heart,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  Star,
  Timer,
  TriangleAlert,
  Trash2,
  UploadCloud,
  Users,
  X,
  Zap,
} from "lucide-react";
import { deleteTrackedOrder, loadTrackedOrders, saveTrackedOrders } from "../data/orders";
import { extractBotInvite } from "../lib/bot-invite";
import { extractDiscordInviteCode, resolveDiscordGuildId, resolveDiscordGuildInfo } from "../lib/discord";
import { buildGuestOrderLink } from "../lib/order-links";
import {
  clearCommunityConfig,
  createCommunityStockCategory,
  deleteCommunityStockCategory,
  exportCommunityOAuthStock,
  getCommunityAdminStatus,
  getCommunityConfig,
  importCommunityOAuthStock,
  removeCommunityAuthorization,
  removeCommunityAuthorizations,
  reorderCommunityAuthorizations,
  saveCommunityConfig,
  syncCommunityAuthorizations,
  updateCommunityStockCategory,
  type CommunityAdminStatus,
  type CommunityCategoryColorKey,
  type CommunityConfig,
  type CommunityStockCategory,
  type CommunityStockType
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
import type { BoostStock, BoostTokenStockInput, BoostTokenStockSnapshot, BoostUsedToken, CommunityJoinMethod, CreateOrderPayload, OrderStatusResponse, ServiceType, TrackedOrder } from "../types";

const EMPTY_FORM = {
  service: "OAUTH-ONLINE" as ServiceType,
  serverId: "",
  amount: 100,
  delay: 1,
  billingCycle: 1,
  duration: 1 as 1 | 3,
  useProxy: true,
  concurrency: 1,
  communityCategoryId: "offline",
  communityDurationMonths: 1,
  communityCustomDelay: 1,
  communitySpeedProfile: "custom" as "safe" | "balanced" | "fast" | "custom",
  communityJoinMethod: "create_invite" as CommunityJoinMethod
};

const COMMUNITY_SPEED_PROFILES = [
  { key: "safe", label: "Safe", delay: 700, timing: "700s", description: "Lowest risk", icon: ShieldCheck },
  { key: "balanced", label: "Balanced", delay: 300, timing: "30–300s", description: "12-step rhythm", icon: Timer },
  { key: "fast", label: "Fast", delay: 60, timing: "60s", description: "Quick delivery", icon: Rocket }
] as const;

const COMMUNITY_CATEGORY_ICONS: Record<string, typeof Users> = {
  Users,
  Timer,
  Crown,
  Gem,
  Gamepad2,
  Globe2,
  Heart,
  Rocket,
  Shield,
  Star,
  Zap
};

const COMMUNITY_CATEGORY_COLORS: Array<{ key: CommunityCategoryColorKey; label: string; tone: string }> = [
  { key: "violet", label: "Violet", tone: "#9b8cff" },
  { key: "cyan", label: "Cyan", tone: "#67c7ff" },
  { key: "emerald", label: "Emerald", tone: "#69ddb2" },
  { key: "amber", label: "Amber", tone: "#f5c76b" },
  { key: "rose", label: "Rose", tone: "#ff8297" },
  { key: "black", label: "Black", tone: "#e6e8ef" }
];

function getCommunityCategoryIcon(iconName: string) {
  return COMMUNITY_CATEGORY_ICONS[iconName] ?? Users;
}

function getCommunityCategoryAppearance(colorKey: CommunityCategoryColorKey): CSSProperties {
  const tone = COMMUNITY_CATEGORY_COLORS.find((color) => color.key === colorKey)?.tone ?? COMMUNITY_CATEGORY_COLORS[0].tone;
  return {
    "--category-tone": tone,
    "--service-tone": tone,
    "--service-tone-soft": `color-mix(in srgb, ${tone} 12%, transparent)`,
    "--service-tone-border": `color-mix(in srgb, ${tone} 34%, transparent)`,
    "--service-tone-glow": `color-mix(in srgb, ${tone} 18%, transparent)`,
    "--service-tone-ink": `color-mix(in srgb, ${tone} 62%, white)`
  } as CSSProperties;
}

function getBoostConcurrency(amount: number) {
  const tokenCount = Math.max(1, Math.ceil(amount / 2));
  return Math.min(4, Math.max(1, Math.ceil(tokenCount / 2)));
}

function isBoostUsedTokenIssue(item: BoostUsedToken) {
  const status = String(item.status ?? "").trim().toLowerCase();
  return !item.boosted && !["pending", "used"].includes(status);
}

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
  if (record.status === "failed") return { label: "Inactive", variant: "destructive" as const };
  return { label: "Connected", variant: "success" as const };
}

const EMPTY_COMMUNITY_CONFIG_DRAFT = {
  clientId: "",
  clientSecret: "",
  botToken: "",
  guildId: ""
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
  if (["error", "invalid", "terminated", "canceled", "cancelled", "invites paused"].some((value) => normalized.includes(value))) {
    return "destructive";
  }
  return "secondary";
}

function getOrderStatusTone(status?: string): "active" | "success" | "danger" | "paused" {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("completed")) return "success";
  if (normalized === "paused") return "paused";
  if (["error", "invalid", "terminated", "canceled", "cancelled", "invites paused"].some((value) => normalized.includes(value))) {
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
  const [usedTokenStatusFilter, setUsedTokenStatusFilter] = useState<"all" | "boosted" | "issues">("all");
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
  const [communityImportFile, setCommunityImportFile] = useState<File | null>(null);
  const [communityStockType, setCommunityStockType] = useState<CommunityStockType>("offline");
  const [communityCategoryDraft, setCommunityCategoryDraft] = useState<{ name: string; isPeriodic: boolean; iconName: string; colorKey: CommunityCategoryColorKey }>({
    name: "",
    isPeriodic: false,
    iconName: "Users",
    colorKey: "violet"
  });
  const [editingCommunityCategoryId, setEditingCommunityCategoryId] = useState<string | null>(null);
  const [communityCategoryModalOpen, setCommunityCategoryModalOpen] = useState(false);
  const [communityCategoryPendingDeletion, setCommunityCategoryPendingDeletion] = useState<CommunityStockCategory | null>(null);
  const [savingCommunityCategory, setSavingCommunityCategory] = useState(false);
  const [importingCommunityStock, setImportingCommunityStock] = useState(false);
  const [exportingCommunityStock, setExportingCommunityStock] = useState(false);
  const communityImportInputRef = useRef<HTMLInputElement>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [refreshingManage, setRefreshingManage] = useState(false);
  const [restartingOrderId, setRestartingOrderId] = useState<string | null>(null);
  const [orderPendingDeletion, setOrderPendingDeletion] = useState<TrackedOrder | null>(null);
  const [communityMemberPendingDeletion, setCommunityMemberPendingDeletion] = useState<CommunityAdminStatus["recent"][number] | null>(null);
  const [selectedCommunityMemberIds, setSelectedCommunityMemberIds] = useState<string[]>([]);
  const [communityBulkDeleteOpen, setCommunityBulkDeleteOpen] = useState(false);
  const [communityBulkAction, setCommunityBulkAction] = useState<"top" | "up" | "down" | "bottom" | "delete" | null>(null);
  const [orderConfirmationPayload, setOrderConfirmationPayload] = useState<CreateOrderPayload | null>(null);
  const [boostScreeningPendingPayload, setBoostScreeningPendingPayload] = useState<CreateOrderPayload | null>(null);
  const [deletingTrackedOrder, setDeletingTrackedOrder] = useState(false);
  const [availability, setAvailability] = useState("");
  const [availabilityMaximum, setAvailabilityMaximum] = useState<number | null>(null);
  const availabilityRequestRef = useRef(0);
  const communityStatusRequestRef = useRef(0);
  const [orders, setOrders] = useState<TrackedOrder[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [orderIdToTrack, setOrderIdToTrack] = useState("");
  const [currentOrderPage, setCurrentOrderPage] = useState(1);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderTypeFilter, setOrderTypeFilter] = useState("all");
  const orderStatusOptions = useMemo(() => {
    const knownStatuses = ["NEW", "PROCESS", "RECOVERING", "WAITING", "INVITES PAUSED", "PAUSED", "COMPLETED", "PARTIAL", "ERROR", "CANCELLED", "INVALID", "TERMINATED"];
    const actualStatuses = orders.map((order) => String(order.status ?? "NEW").trim().toUpperCase()).filter(Boolean);
    const statuses = Array.from(new Set([...knownStatuses, ...actualStatuses]));
    return [
      { value: "all", label: "All statuses" },
      ...statuses.map((status) => ({
        value: status,
        label: status === "INVITES PAUSED"
          ? "Invites paused"
          : status.charAt(0) + status.slice(1).toLowerCase()
      }))
    ];
  }, [orders]);

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
    () => orders.filter((order) => ["WAITING", "ERROR", "INVALID", "TERMINATED", "PAUSED", "INVITE"].some((value) => String(order.status ?? "").toUpperCase().includes(value))).length,
    [orders]
  );
  const filteredOrders = useMemo(() => {
    const query = orderSearch.trim().toLowerCase();
    return orders.filter((order) => {
      const normalizedStatus = String(order.status ?? "NEW").trim().toUpperCase();
      const boostOrder = order.provider === "dcord" || isBoostService(order.service);
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
        normalizedStatus === orderStatusFilter;
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
  const communityCategories = communityStatus?.stockCategories ?? [];
  const selectedCommunityCategory = communityCategories.find((category) => category.id === form.communityCategoryId) ?? communityCategories[0];
  const confirmationCommunityCategory = communityCategories.find((category) => category.id === orderConfirmationPayload?.categoryId);
  const selectedCommunityReady = selectedCommunityCategory?.summary.ready ?? 0;
  const selectedCommunityOrderLimit = availabilityMaximum ?? selectedCommunityReady;
  const selectedApiConfigured = selectedIsBoost ? dcordConfigured : selectedIsCommunity ? Boolean(communityStatus?.configured) : apiConfigured;
  const selectedCanCreate = selectedApiConfigured && (
    !selectedIsCommunity || (
      Boolean(form.serverId.trim()) &&
      !checkingAvailability &&
      availabilityMaximum !== null &&
      availabilityMaximum > 0 &&
      form.amount <= availabilityMaximum
    )
  );
  const selectedBoostCapacity = form.duration === 3 ? boostStock.threeMonth * 2 : boostStock.oneMonth * 2;
  const filteredUsedBoostTokens = useMemo(
    () => {
      const durationFiltered = usedTokenDurationFilter === "all"
        ? usedBoostTokens
        : usedBoostTokens.filter((item) => item.duration === usedTokenDurationFilter);
      const filtered = usedTokenStatusFilter === "boosted"
        ? durationFiltered.filter((item) => item.boosted)
        : usedTokenStatusFilter === "issues"
          ? durationFiltered.filter(isBoostUsedTokenIssue)
          : durationFiltered;

      return [...filtered].sort((left, right) => {
        const dateDifference = getTrackedTimestamp(right.resultAt ?? right.usedAt) - getTrackedTimestamp(left.resultAt ?? left.usedAt);
        return dateDifference || right.id.localeCompare(left.id);
      });
    },
    [usedBoostTokens, usedTokenDurationFilter, usedTokenStatusFilter]
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
    if (!orderPendingDeletion && !communityMemberPendingDeletion && !communityBulkDeleteOpen && !communityCategoryModalOpen && !communityCategoryPendingDeletion) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (orderPendingDeletion && !deletingTrackedOrder) setOrderPendingDeletion(null);
      if (communityMemberPendingDeletion && removingCommunityUserId === null) setCommunityMemberPendingDeletion(null);
      if (communityBulkDeleteOpen && communityBulkAction === null) setCommunityBulkDeleteOpen(false);
      if (communityCategoryModalOpen && !savingCommunityCategory) resetCommunityCategoryDraft();
      if (communityCategoryPendingDeletion && !savingCommunityCategory) setCommunityCategoryPendingDeletion(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [orderPendingDeletion, communityMemberPendingDeletion, communityBulkDeleteOpen, communityCategoryModalOpen, communityCategoryPendingDeletion, deletingTrackedOrder, removingCommunityUserId, communityBulkAction, savingCommunityCategory]);

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

    const requestId = ++availabilityRequestRef.current;

    if (!form.serverId.trim()) {
      setAvailability("");
      setAvailabilityMaximum(null);
      setCheckingAvailability(false);
      return;
    }

    setCheckingAvailability(true);
    setAvailability("");
    setAvailabilityMaximum(null);
    const handle = window.setTimeout(() => {
      void refreshAvailability(requestId);
    }, 350);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, form.service, form.serverId, form.duration, form.communityCategoryId, form.communityJoinMethod]);

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

  useEffect(() => {
    const categories = communityStatus?.stockCategories ?? [];
    if (!categories.length) return;
    if (!categories.some((category) => category.id === communityStockType)) setCommunityStockType(categories[0].id);
    if (!categories.some((category) => category.id === form.communityCategoryId)) {
      setForm((current) => ({ ...current, communityCategoryId: categories[0].id }));
    }
  }, [communityStatus?.stockCategories, communityStockType, form.communityCategoryId]);

  useEffect(() => {
    setSelectedCommunityMemberIds([]);
  }, [communityStockType]);

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
    const requestId = ++communityStatusRequestRef.current;
    try {
      setLoadingCommunityStatus(true);
      const nextStatus = await getCommunityAdminStatus();
      if (requestId === communityStatusRequestRef.current) setCommunityStatus(nextStatus);
    } catch (error) {
      if (requestId === communityStatusRequestRef.current) notifyError(error instanceof Error ? error.message : "Community join status could not be loaded.");
    } finally {
      if (requestId === communityStatusRequestRef.current) setLoadingCommunityStatus(false);
    }
  }

  async function refreshCommunityStock() {
    const requestId = ++communityStatusRequestRef.current;
    try {
      setLoadingCommunityStatus(true);
      const summary = await syncCommunityAuthorizations();
      const nextStatus = await getCommunityAdminStatus();
      if (requestId !== communityStatusRequestRef.current) return;
      setCommunityStatus(nextStatus);
      notifySuccess(`${summary.checked} members checked${summary.inactive ? `, ${summary.inactive} marked inactive` : ""}.`);
    } catch (error) {
      if (requestId === communityStatusRequestRef.current) notifyError(error instanceof Error ? error.message : "Members Stock could not be refreshed.");
    } finally {
      if (requestId === communityStatusRequestRef.current) setLoadingCommunityStatus(false);
    }
  }

  async function removeConnectedCommunityUser(record: CommunityAdminStatus["recent"][number]) {
    try {
      setRemovingCommunityUserId(record.id);
      await removeCommunityAuthorization(record.id);
      await refreshCommunityStatus();
      setSelectedCommunityMemberIds((current) => current.filter((id) => id !== record.id));
      setCommunityMemberPendingDeletion(null);
      notifySuccess(`${record.username} disconnected and removed from Members Stock.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Connected user could not be removed.");
    } finally {
      setRemovingCommunityUserId(null);
    }
  }

  async function reorderSelectedCommunityMembers(direction: "top" | "up" | "down" | "bottom") {
    if (!selectedCommunityMemberIds.length || communityBulkAction) return;
    try {
      setCommunityBulkAction(direction);
      await reorderCommunityAuthorizations(selectedCommunityMemberIds, communityStockType, direction);
      await refreshCommunityStatus();
      notifySuccess(`${selectedCommunityMemberIds.length} member${selectedCommunityMemberIds.length === 1 ? "" : "s"} moved ${direction}.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Member priority could not be updated.");
    } finally {
      setCommunityBulkAction(null);
    }
  }

  async function removeSelectedCommunityMembers() {
    if (!selectedCommunityMemberIds.length || communityBulkAction) return;
    try {
      setCommunityBulkAction("delete");
      const result = await removeCommunityAuthorizations(selectedCommunityMemberIds);
      await refreshCommunityStatus();
      setSelectedCommunityMemberIds([]);
      setCommunityBulkDeleteOpen(false);
      notifySuccess(`${result.removed} member${result.removed === 1 ? "" : "s"} removed${result.skippedReserved ? `; ${result.skippedReserved} reserved member${result.skippedReserved === 1 ? " was" : "s were"} kept` : ""}.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Selected members could not be removed.");
    } finally {
      setCommunityBulkAction(null);
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
        guildId: config.guildId
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
      await refreshCommunityStatus();
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
      communityStatusRequestRef.current += 1;
      setCommunityStatus(null);
      setLoadingCommunityStatus(false);
      notifySuccess("Saved Members bot settings removed.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Members bot settings could not be removed.");
    } finally {
      setSavingCommunityConfig(false);
    }
  }

  function beginEditingCommunityCategory(category: CommunityStockCategory) {
    setEditingCommunityCategoryId(category.id);
    setCommunityCategoryDraft({
      name: category.name,
      isPeriodic: category.isPeriodic,
      iconName: category.iconName || (category.isPeriodic ? "Timer" : "Users"),
      colorKey: category.colorKey || "violet"
    });
    setCommunityCategoryModalOpen(true);
  }

  function beginCreatingCommunityCategory() {
    setEditingCommunityCategoryId(null);
    setCommunityCategoryDraft({ name: "", isPeriodic: false, iconName: "Users", colorKey: "violet" });
    setCommunityCategoryModalOpen(true);
  }

  function resetCommunityCategoryDraft() {
    setEditingCommunityCategoryId(null);
    setCommunityCategoryDraft({ name: "", isPeriodic: false, iconName: "Users", colorKey: "violet" });
    setCommunityCategoryModalOpen(false);
  }

  async function handleSaveCommunityCategory(event: FormEvent) {
    event.preventDefault();
    const input = {
      name: communityCategoryDraft.name.trim(),
      isPeriodic: communityCategoryDraft.isPeriodic,
      iconName: communityCategoryDraft.iconName.trim(),
      colorKey: communityCategoryDraft.colorKey
    };
    if (!input.name) return notifyError("Category name is required.");
    if (!COMMUNITY_CATEGORY_ICONS[input.iconName]) return notifyError("Choose a valid Lucide icon name.");
    try {
      setSavingCommunityCategory(true);
      if (editingCommunityCategoryId) await updateCommunityStockCategory(editingCommunityCategoryId, input);
      else await createCommunityStockCategory(input);
      await refreshCommunityStatus();
      resetCommunityCategoryDraft();
      notifySuccess(editingCommunityCategoryId ? "Category updated." : "Category created.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Category could not be saved.");
    } finally {
      setSavingCommunityCategory(false);
    }
  }

  async function handleDeleteCommunityCategory() {
    const category = communityCategoryPendingDeletion;
    if (!category) return;
    try {
      setSavingCommunityCategory(true);
      await deleteCommunityStockCategory(category.id);
      await refreshCommunityStatus();
      if (editingCommunityCategoryId === category.id) resetCommunityCategoryDraft();
      setCommunityCategoryPendingDeletion(null);
      notifySuccess("Category deleted.");
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Category could not be deleted.");
    } finally {
      setSavingCommunityCategory(false);
    }
  }

  async function handleImportCommunityStock(event: FormEvent) {
    event.preventDefault();
    if (!communityImportFile) return;
    try {
      setImportingCommunityStock(true);
      if (communityImportFile.size > 10 * 1024 * 1024) throw new Error("OAuth stock JSON must be smaller than 10 MB.");
      const parsed = JSON.parse(await communityImportFile.text()) as unknown;
      const records = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && "records" in parsed && Array.isArray((parsed as { records?: unknown }).records)
          ? (parsed as { records: unknown[] }).records
          : null;
      if (!records?.length) throw new Error("Select a JSON file containing OAuth stock records.");
      const sanitizedRecords = records.map((record) => {
        const value = record && typeof record === "object" ? record as Record<string, unknown> : {};
        return {
          user_id: value.user_id ?? value.userId,
          access_token: value.access_token ?? value.accessToken,
          authed_timestamp: value.authed_timestamp ?? value.authedTimestamp,
          expires_in: value.expires_in ?? value.expiresIn
        };
      });
      const result = { total: sanitizedRecords.length, imported: 0, failed: 0, skipped: 0, errors: [] as Array<{ record: string; message: string }>, categoryName: "" };
      const importBatchSize = 100;
      for (let start = 0; start < sanitizedRecords.length; start += importBatchSize) {
        const batch = sanitizedRecords.slice(start, start + importBatchSize);
        const batchResult = await importCommunityOAuthStock(batch, communityStockType);
        result.imported += batchResult.imported;
        result.failed += batchResult.failed;
        result.skipped += batchResult.skipped;
        result.errors.push(...batchResult.errors.slice(0, Math.max(0, 25 - result.errors.length)));
        result.categoryName = batchResult.categoryName ?? result.categoryName;
      }
      await refreshCommunityStatus();
      setCommunityImportFile(null);
      if (communityImportInputRef.current) communityImportInputRef.current.value = "";
      const summary = `${result.imported} imported to ${result.categoryName ?? communityVisibleCategory?.name ?? "category"}, ${result.skipped} skipped, ${result.failed} failed.`;
      if (result.failed) notifyError(summary);
      else notifySuccess(summary);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "OAuth stock could not be imported.");
    } finally {
      setImportingCommunityStock(false);
    }
  }

  async function handleExportCommunityStock() {
    try {
      setExportingCommunityStock(true);
      const records = await exportCommunityOAuthStock(communityStockType);
      if (!records.length) throw new Error("There are no OAuth records in this category to export.");

      const blob = new Blob([JSON.stringify(records, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const categoryName = (communityVisibleCategory?.name ?? communityStockType)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "stock";
      link.href = url;
      link.download = `members-${categoryName}-oauth-stock.json`;
      link.click();
      URL.revokeObjectURL(url);
      notifySuccess(`${records.length} OAuth record${records.length === 1 ? "" : "s"} exported.`);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "OAuth stock could not be exported.");
    } finally {
      setExportingCommunityStock(false);
    }
  }

  async function refreshAvailability(requestId: number) {
    try {
      const serverId = selectedIsBoost || selectedIsCommunity ? form.serverId.trim() : await resolveDiscordGuildId(form.serverId);
      const data = await checkAvailableAmount(
        form.service,
        serverId,
        form.duration,
        selectedIsCommunity ? form.communityCategoryId : undefined,
        selectedIsCommunity ? form.communityJoinMethod : undefined
      );
      if (requestId !== availabilityRequestRef.current) return;
      setAvailability(`Available ${data.available} / max ${data.maximum}`);
      setAvailabilityMaximum(data.maximum);
      if (selectedIsCommunity && data.maximum > 0) {
        setForm((current) => ({ ...current, amount: Math.min(current.amount, data.maximum) }));
      }
    } catch (error) {
      if (requestId !== availabilityRequestRef.current) return;
      setAvailability(error instanceof Error ? error.message : "Availability could not be loaded. Try the invite again.");
      setAvailabilityMaximum(null);
    } finally {
      if (requestId === availabilityRequestRef.current) setCheckingAvailability(false);
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
      expiredAt: typeof (status.expiredAt ?? status.expired_at) === "string" ? String(status.expiredAt ?? status.expired_at) : order.expiredAt,
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
      a.duration === b.duration &&
      a.expiredAt === b.expiredAt
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
      await deleteTrackedOrder(target.uniqid);
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
      speedProfile: payloadIsCommunity ? payload.speedProfile : undefined,
      joinMethod: payloadIsCommunity ? payload.joinMethod : undefined,
      billingCycle: payload.service === "OAUTH-ONLINE" ? payload.billingCycle : undefined,
      duration: payloadIsBoost ? payload.duration : undefined,
      useProxy: payloadIsBoost ? true : undefined,
      concurrency: payloadIsBoost ? payload.concurrency : undefined,
      cost: created.cost,
      botInvite: created.bot_invite,
      categoryId: created.categoryId,
      categoryName: created.categoryName,
      categoryIsPeriodic: created.categoryIsPeriodic,
      durationMonths: created.durationMonths,
      expiredAt: created.expiredAt,
      serverInvite: extractDiscordInviteCode(targetId) ? targetId : undefined,
      serverMemberCount: serverInfo.approximateMemberCount,
      createdAt: created.createdAt ?? new Date().toISOString(),
      status: "NEW"
    };

    persistOrders([nextOrder, ...orders]);
    notifySuccess(`Order created: ${created.uniqid}`);
    const providerQuery = payloadIsBoost ? "&provider=dcord" : payloadIsCommunity ? "&provider=community" : "";
    navigate(`/orders?uniqid=${encodeURIComponent(created.uniqid)}${providerQuery}`);
  }

  function handleCreateOrder(event: FormEvent) {
    event.preventDefault();

    if (selectedIsCommunity && (checkingAvailability || availabilityMaximum === null)) {
      notifyError("Wait for the available member count to load.");
      return;
    }
    if (selectedIsCommunity && form.amount > (availabilityMaximum ?? 0)) {
      notifyError(`You can order up to ${availabilityMaximum ?? 0} available members for this server.`);
      return;
    }

    const payload: CreateOrderPayload = {
      service: form.service,
      id: form.serverId.trim(),
      amount: form.amount,
      delay: selectedIsBoost ? undefined : form.delay,
      billingCycle: form.service === "OAUTH-ONLINE" ? form.billingCycle : undefined,
      duration: selectedIsBoost ? form.duration : undefined,
      useProxy: selectedIsBoost ? true : undefined,
      concurrency: selectedIsBoost ? form.concurrency : undefined,
      categoryId: selectedIsCommunity ? form.communityCategoryId : undefined,
      durationMonths: selectedIsCommunity && selectedCommunityCategory?.isPeriodic ? form.communityDurationMonths : undefined,
      speedProfile: selectedIsCommunity ? form.communitySpeedProfile : undefined,
      joinMethod: selectedIsCommunity ? form.communityJoinMethod : undefined
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
  const communityVisibleCategory = communityCategories.find((category) => category.id === communityStockType);
  const communityVisibleSummary = communityVisibleCategory?.summary ?? communityStatus?.categories?.[communityStockType] ?? {
    joined: 0,
    authorized: 0,
    ready: 0,
    alreadyMember: 0,
    failed: 0
  };
  const communityTotalUsers = communityVisibleSummary.authorized + communityVisibleSummary.failed;
  const communityVisibleRecords = (communityStatus?.recent ?? []).filter((record) => record.stockType === communityStockType);

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

      <div className="community-category-manager">
        <div className="community-category-manager-heading">
          <div><p className={labelClass}>Stock categories</p><h3>Choose a member pool</h3><span>Each category keeps its own inventory.</span></div>
          <Button type="button" size="sm" disabled={!communityStockConfigured} onClick={beginCreatingCommunityCategory}><Plus className="h-4 w-4" /> New category</Button>
        </div>
        <div className="community-category-grid" role="tablist" aria-label="Members Stock category">
          {communityCategories.map((category) => {
            const selected = communityStockType === category.id;
            const hasStock = category.summary.authorized + category.summary.failed > 0;
            const CategoryIcon = getCommunityCategoryIcon(category.iconName);
            return (
              <article key={category.id} className={`community-category-card ${selected ? "is-active" : ""}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="community-category-select"
                  onClick={() => {
                    setCommunityStockType(category.id);
                    setSelectedCommunityMemberIds([]);
                    setCommunityImportFile(null);
                    if (communityImportInputRef.current) communityImportInputRef.current.value = "";
                  }}
                >
                  <span className="community-category-icon" aria-hidden="true"><CategoryIcon className="h-4 w-4" /></span>
                  <span className="community-category-copy"><strong>{category.name}</strong><small>{category.summary.ready} available · {category.summary.authorized + category.summary.failed} total</small></span>
                  <Badge variant={category.isPeriodic ? "secondary" : "outline"}>{category.isPeriodic ? "Period based" : "No period"}</Badge>
                </button>
                <div className="community-category-actions">
                  <Button type="button" variant="ghost" size="icon-sm" title={`Edit ${category.name}`} onClick={() => beginEditingCommunityCategory(category)}><Settings2 className="h-3.5 w-3.5" /></Button>
                  <Button type="button" variant="dangerGhost" size="icon-sm" title={hasStock ? "Empty this category before deleting it" : `Delete ${category.name}`} disabled={hasStock || savingCommunityCategory} onClick={() => setCommunityCategoryPendingDeletion(category)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="community-admin-progress members-connected-summary">
        <div><span>Total users</span><strong>{communityTotalUsers}</strong></div>
        <div><span>Available users</span><strong>{communityVisibleSummary.ready}</strong></div>
        <div><span>Connected users</span><strong>{communityVisibleSummary.authorized}</strong></div>
        <div><span>Inactive users</span><strong>{communityVisibleSummary.failed}</strong></div>
      </div>

      {!communityStockConfigured ? (
        <p className="community-admin-note">Add the Discord application, bot and target server settings to activate Members Stock.</p>
      ) : null}

      <form onSubmit={handleImportCommunityStock} className="community-stock-import">
        <div className="community-stock-import-heading">
          <span className="community-stock-import-icon" aria-hidden="true"><FileJson className="h-4 w-4" /></span>
          <div><h3>Import OAuth stock</h3><p><strong>{communityVisibleCategory?.name ?? "Selected category"}</strong> · JSON up to 10 MB / 5,000 records</p></div>
        </div>

        <input
          ref={communityImportInputRef}
          id="community-oauth-stock-file"
          className="sr-only"
          type="file"
          accept=".json,application/json"
          disabled={!communityStockConfigured || importingCommunityStock}
          onChange={(event) => setCommunityImportFile(event.target.files?.[0] ?? null)}
        />

        <div className="community-stock-import-actions">
          {communityImportFile ? <span className="community-stock-import-file"><FileJson className="h-3.5 w-3.5" /><strong>{communityImportFile.name}</strong><small>{Math.max(0.1, communityImportFile.size / 1024).toFixed(1)} KB</small><button type="button" aria-label="Clear selected file" onClick={() => { setCommunityImportFile(null); if (communityImportInputRef.current) communityImportInputRef.current.value = ""; }}><X className="h-3 w-3" /></button></span> : null}
          <Button type="button" variant="secondary" disabled={!communityStockConfigured || importingCommunityStock} onClick={() => communityImportInputRef.current?.click()}>
            <FileJson className="h-4 w-4" /> {communityImportFile ? "Change JSON" : "Choose JSON"}
          </Button>
          <Button type="submit" disabled={!communityStockConfigured || !communityImportFile || importingCommunityStock}>
            {importingCommunityStock ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {importingCommunityStock ? "Validating & importing..." : "Import stock"}
          </Button>
          <Button type="button" variant="secondary" disabled={!communityStockConfigured || !communityVisibleRecords.length || exportingCommunityStock} onClick={() => void handleExportCommunityStock()}>
            {exportingCommunityStock ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exportingCommunityStock ? "Exporting..." : "Export stock"}
          </Button>
        </div>
      </form>

      <div className="community-member-toolbar">
          <label className="community-member-select-all">
            <input
              type="checkbox"
              disabled={!communityVisibleRecords.length}
              checked={communityVisibleRecords.length > 0 && selectedCommunityMemberIds.length === communityVisibleRecords.length}
              ref={(element) => { if (element) element.indeterminate = selectedCommunityMemberIds.length > 0 && selectedCommunityMemberIds.length < communityVisibleRecords.length; }}
              onChange={(event) => setSelectedCommunityMemberIds(event.target.checked ? communityVisibleRecords.map((record) => record.id) : [])}
            />
            <span>{selectedCommunityMemberIds.length ? `${selectedCommunityMemberIds.length} selected` : `Select all · ${communityVisibleRecords.length}`}</span>
          </label>
          <div className="community-member-priority-actions">
            <Button type="button" variant="secondary" size="xs" title="Move selected to top" disabled={!selectedCommunityMemberIds.length || communityBulkAction !== null} onClick={() => void reorderSelectedCommunityMembers("top")}><ChevronsUp className="h-3.5 w-3.5" /> Top</Button>
            <Button type="button" variant="secondary" size="xs" title="Move selected up" disabled={!selectedCommunityMemberIds.length || communityBulkAction !== null} onClick={() => void reorderSelectedCommunityMembers("up")}><ChevronUp className="h-3.5 w-3.5" /> Up</Button>
            <Button type="button" variant="secondary" size="xs" title="Move selected down" disabled={!selectedCommunityMemberIds.length || communityBulkAction !== null} onClick={() => void reorderSelectedCommunityMembers("down")}><ChevronDown className="h-3.5 w-3.5" /> Down</Button>
            <Button type="button" variant="secondary" size="xs" title="Move selected to bottom" disabled={!selectedCommunityMemberIds.length || communityBulkAction !== null} onClick={() => void reorderSelectedCommunityMembers("bottom")}><ChevronsDown className="h-3.5 w-3.5" /> Bottom</Button>
            <Button type="button" variant="dangerGhost" size="sm" disabled={!selectedCommunityMemberIds.length || communityBulkAction !== null} onClick={() => setCommunityBulkDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" /> Delete selected</Button>
            <Button type="button" variant="secondary" size="sm" disabled={loadingCommunityStatus || !communityStockConfigured || communityBulkAction !== null} onClick={() => void refreshCommunityStock()}><RefreshCw className={`h-3.5 w-3.5 ${loadingCommunityStatus ? "animate-spin" : ""}`} /> Refresh</Button>
          </div>
        </div>

      {communityVisibleRecords.length ? (
        <div className="community-recent-list">
          {communityVisibleRecords.map((record, index) => {
            const badge = getCommunityRecordBadge(record);
            return (
              <div key={record.id || `${record.username}-${record.authorizedAt}-${index}`} data-state={record.status}>
                <input
                  className="community-member-checkbox"
                  type="checkbox"
                  checked={selectedCommunityMemberIds.includes(record.id)}
                  onChange={(event) => setSelectedCommunityMemberIds((current) => event.target.checked ? [...current, record.id] : current.filter((id) => id !== record.id))}
                  aria-label={`Select ${record.username}`}
                />
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
        <div className="stock-empty-state"><Users className="h-5 w-5" /><strong>No {communityVisibleCategory?.name ?? "category"} members yet</strong><span>Choose this category above, then import its OAuth JSON file.</span></div>
      ) : null}

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
                                  communityCategoryId: option.value === "community" ? (communityCategories[0]?.id ?? current.communityCategoryId) : current.communityCategoryId,
                                  amount: option.value === "boosts" ? 2 : option.value === "community" ? Math.max(1, Math.min(100, communityCategories[0]?.summary.ready ?? 1)) : 100,
                                  delay: option.value === "community" ? current.communityCustomDelay : current.delay,
                                  communitySpeedProfile: option.value === "community" ? "custom" : current.communitySpeedProfile,
                                  concurrency: option.value === "boosts" ? 1 : current.concurrency
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
                          <span className={fieldLabelClass}>Stock category</span>
                          <p className="service-selector-copy">Choose which category and its private stock will be used for this order.</p>
                        </div>
                        <span className="service-selector-count">{communityCategories.length} categories</span>
                      </div>
                      <div className="service-grid community-mode-grid">
                        {communityCategories.map((category) => {
                          const Icon = getCommunityCategoryIcon(category.iconName);
                          const selected = form.communityCategoryId === category.id;
                          const ready = category.summary.ready;
                          return (
                            <label key={category.id} className={`service-option ${selected ? "is-selected" : ""}`} data-service="COMMUNITY-CATEGORY" style={getCommunityCategoryAppearance(category.colorKey)}>
                              <input
                                className="sr-only"
                                type="radio"
                                name="communityService"
                                value={category.id}
                                checked={selected}
                                onChange={() => {
                                  availabilityRequestRef.current += 1;
                                  setAvailability("");
                                  setAvailabilityMaximum(null);
                                  setForm((current) => ({
                                    ...current,
                                    service: "COMMUNITY-OFFLINE",
                                    communityCategoryId: category.id,
                                    amount: Math.max(1, Math.min(current.amount, ready || 1))
                                  }));
                                }}
                              />
                              <span className="service-option-head" aria-hidden="true">
                                <span className="service-option-icon"><Icon className="h-5 w-5" /></span>
                                <span className="service-option-state">{selected ? <><Check className="h-3 w-3" /> Selected</> : "Select"}</span>
                              </span>
                              <span className="service-option-title">{category.name}</span>
                              <span className="service-option-description">{ready} connected members available</span>
                              <span className="community-service-option-footer">
                                <span className="service-option-code service-option-code-badge"><span>{ready} MEMBERS</span></span>
                                <span className="service-option-code">{category.isPeriodic ? "Period based" : "No expiration"}</span>
                              </span>
                            </label>
                          );
                        })}
                        {!communityCategories.length ? <p className="service-selector-copy">Create a Members Stock category before placing an order.</p> : null}
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
                                    const nextAmount = nextCapacity > 0 ? Math.min(current.amount, nextCapacity) : current.amount;
                                    return {
                                      ...current,
                                      duration: duration as 1 | 3,
                                      amount: nextAmount,
                                      concurrency: getBoostConcurrency(nextAmount)
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
                                onClick={() => setForm((current) => {
                                  const amount = Math.max(2, current.amount - 2);
                                  return { ...current, amount, concurrency: getBoostConcurrency(amount) };
                                })}
                              >
                                <Minus className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <div className="boost-amount-value" aria-live="polite">{form.amount}</div>
                              <button
                                type="button"
                                aria-label="Increase boosts"
                                disabled={selectedBoostCapacity <= 0 || form.amount >= selectedBoostCapacity}
                                onClick={() =>
                                  setForm((current) => {
                                    const amount = Math.min(Math.max(2, selectedBoostCapacity), current.amount + 2);
                                    return { ...current, amount, concurrency: getBoostConcurrency(amount) };
                                  })
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
                                  availabilityRequestRef.current += 1;
                                  setAvailability("");
                                  setAvailabilityMaximum(null);
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
                              max={getBoostConcurrency(form.amount)}
                              value={form.concurrency}
                              onChange={(event) => {
                                const value = Math.min(Math.max(Number(event.target.value) || 1, 1), getBoostConcurrency(form.amount));
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
                        {selectedIsCommunity ? (
                          <>
                            <div className="community-join-method-field">
                              <div className="community-speed-profile-copy">
                                <span className="boost-order-label">Join method</span>
                                <small>Choose the bot setup used for this order.</small>
                              </div>
                              <div className="community-join-method-options" role="radiogroup" aria-label="Join method">
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={form.communityJoinMethod === "create_invite"}
                                  className={form.communityJoinMethod === "create_invite" ? "is-selected" : ""}
                                  onClick={() => setForm((current) => ({ ...current, communityJoinMethod: "create_invite" }))}
                                >
                                  <Bot className="h-4 w-4" aria-hidden="true" />
                                  <span><strong>Create Invite</strong><small>Bot Invite · Create Invite only</small></span>
                                  {form.communityJoinMethod === "create_invite" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                                </button>
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={form.communityJoinMethod === "join_application"}
                                  className={form.communityJoinMethod === "join_application" ? "is-selected" : ""}
                                  onClick={() => setForm((current) => ({ ...current, communityJoinMethod: "join_application" }))}
                                >
                                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                                  <span><strong>Join Application</strong><small>Apply to Join · permissions 35</small></span>
                                  {form.communityJoinMethod === "join_application" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                                </button>
                              </div>
                            </div>

                            <div className="community-speed-profile-field">
                              <div className="community-speed-profile-copy">
                                <span className="boost-order-label">Delivery speed</span>
                                <small>Select a profile or set an exact delay.</small>
                              </div>
                              <div className="community-speed-profile-options" aria-label="Delivery speed profile">
                                {COMMUNITY_SPEED_PROFILES.map((profile) => {
                                  const Icon = profile.icon;
                                  const selected = form.communitySpeedProfile === profile.key;
                                  return (
                                    <button
                                      key={profile.key}
                                      type="button"
                                      className={selected ? "is-selected" : ""}
                                      aria-pressed={selected}
                                      onClick={() => setForm((current) => ({ ...current, delay: profile.delay, communitySpeedProfile: profile.key }))}
                                    >
                                      <Icon className="h-4 w-4" aria-hidden="true" />
                                      <span className="community-speed-option-copy"><strong>{profile.label}</strong><small>{profile.description}</small></span>
                                      <em>{profile.timing}</em>
                                    </button>
                                  );
                                })}
                                <label className={`community-speed-custom-option ${form.communitySpeedProfile === "custom" ? "is-selected" : ""}`}>
                                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                                  <span className="community-speed-option-copy"><strong>Custom</strong><small>Exact delay</small></span>
                                  <span className="community-speed-custom-control">
                                    <input
                                      type="number"
                                      min={1}
                                      max={1200}
                                      value={form.communityCustomDelay}
                                      aria-label="Custom delay in seconds"
                                      onFocus={() => setForm((current) => ({ ...current, delay: current.communityCustomDelay, communitySpeedProfile: "custom" }))}
                                      onChange={(event) => {
                                        const delay = Number(event.target.value) || 1;
                                        setForm((current) => ({ ...current, delay, communityCustomDelay: delay, communitySpeedProfile: "custom" }));
                                      }}
                                    />
                                    <em>s</em>
                                  </span>
                                </label>
                              </div>
                            </div>
                          </>
                        ) : null}
                        <div className={`boost-order-grid members-order-grid ${form.service === "OAUTH-ONLINE" ? "is-online" : ""} ${selectedIsCommunity ? "is-community" : ""} ${selectedIsCommunity && selectedCommunityCategory?.isPeriodic ? "is-periodic" : ""}`}>
                          <div className="boost-order-field">
                            <span className="boost-order-label">Number of Members</span>
                            <input
                              className="boost-number-input"
                              type="number"
                              min={1}
                              max={selectedIsCommunity ? Math.max(1, selectedCommunityOrderLimit) : undefined}
                              value={form.amount}
                              onChange={(event) => {
                                const requested = Math.max(1, Number(event.target.value) || 1);
                                const amount = selectedIsCommunity ? Math.min(requested, Math.max(1, selectedCommunityOrderLimit)) : requested;
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

                          {!selectedIsCommunity ? (
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
                          ) : null}

                          {selectedIsCommunity && selectedCommunityCategory?.isPeriodic ? (
                            <div className="boost-order-field community-order-month-field">
                              <span className="boost-order-label">Month</span>
                              <div className="community-order-month-options" aria-label="Order support period">
                                {[1, 2, 3, 4, 5, 6].map((month) => (
                                  <button key={month} type="button" title={`${month} month${month === 1 ? "" : "s"}`} aria-pressed={form.communityDurationMonths === month} className={form.communityDurationMonths === month ? "is-selected" : ""} onClick={() => setForm((current) => ({ ...current, communityDurationMonths: month }))}>{month}</button>
                                ))}
                              </div>
                            </div>
                          ) : null}

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
                  {selectedIsCommunity && selectedApiConfigured && selectedCommunityReady === 0 ? (
                    <span className="self-center text-sm text-[var(--app-muted)]">No {selectedCommunityCategory?.name ?? "category"} members are available.</span>
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
                  <FilterDropdown label="Status" showLabel={false} value={orderStatusFilter} onChange={setOrderStatusFilter} options={orderStatusOptions} />
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
                      <span>Order</span><span>Service</span><span>Status</span><span>Delivery</span><span>Created</span><span>Expires</span><span>Actions</span>
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
                                <strong>{order.provider === "community" ? (order.categoryName ?? serviceOption?.title ?? "Members 2") : (serviceOption?.title ?? "Manual")}</strong>
                                <span>{boostOrder && order.duration ? `${order.duration} month` : order.provider === "community" ? order.categoryIsPeriodic ? `${order.durationMonths} month support` : "Members 2" : "Members"}</span>
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
                              <time className="orders-row-expiration" dateTime={order.expiredAt ?? undefined} title={order.expiredAt ?? undefined}>{order.expiredAt ? formatTrackedDate(order.expiredAt) : "-"}</time>
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
                    <div className="stock-used-filter-group">
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
                    <div className="stock-used-filter-group">
                      <span>Status</span>
                      <div className="stock-duration-filter stock-status-filter" role="group" aria-label="Filter used tokens by status">
                        {[
                          { value: "all" as const, label: "All", count: usedBoostTokens.length },
                          { value: "boosted" as const, label: "Boosted", count: usedBoostTokens.filter((item) => item.boosted).length },
                          { value: "issues" as const, label: "Issues", count: usedBoostTokens.filter(isBoostUsedTokenIssue).length }
                        ].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`${usedTokenStatusFilter === option.value ? "is-active" : ""} ${option.value === "issues" ? "is-issue-filter" : ""}`}
                            aria-pressed={usedTokenStatusFilter === option.value}
                            onClick={() => {
                              setUsedTokenStatusFilter(option.value);
                              setSelectedUsedBoostTokens({});
                            }}
                          >
                            {option.label}<span>{option.count}</span>
                          </button>
                        ))}
                      </div>
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
                      <div className="stock-empty-state"><History className="h-5 w-5" /><strong>No matching used tokens</strong><span>Adjust the duration or status filters.</span></div>
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
                    <span className={fieldLabelClass}>Members Stock server ID</span>
                    <Input value={communityConfigDraft.guildId} onChange={(event) => setCommunityConfigDraft((current) => ({ ...current, guildId: event.target.value }))} placeholder="Required when the bot is in multiple servers" inputMode="numeric" />
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
                    <Button type="submit" disabled={savingCommunityConfig || !communityConfigDraft.clientId.trim() || (!communityConfig?.hasClientSecret && !communityConfigDraft.clientSecret.trim()) || (!communityConfig?.hasBotToken && !communityConfigDraft.botToken.trim())}>
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

      {communityCategoryModalOpen ? (
        <div className="confirm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingCommunityCategory) resetCommunityCategoryDraft(); }}>
          <form className="confirm-modal community-category-modal" onSubmit={handleSaveCommunityCategory} role="dialog" aria-modal="true" aria-labelledby="community-category-title">
            <span className="confirm-modal-icon is-success" aria-hidden="true"><Settings2 className="h-5 w-5" /></span>
            <p className="app-kicker text-[var(--app-accent)]">Members Stock</p>
            <h2 id="community-category-title">{editingCommunityCategoryId ? "Edit category" : "Create category"}</h2>
            <p>Give this member pool a clear name and choose whether orders from it have a support period.</p>
            <label className="grid gap-2 text-left">
              <span className={fieldLabelClass}>Category name</span>
              <Input autoFocus value={communityCategoryDraft.name} maxLength={60} placeholder="Example: Premium members" onChange={(event) => setCommunityCategoryDraft((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <div className="community-category-appearance" style={getCommunityCategoryAppearance(communityCategoryDraft.colorKey)}>
              <div className="community-category-appearance-heading"><strong>Appearance</strong><small>Applied when this category is selected in an order.</small></div>
              <fieldset className="community-category-icon-picker">
                <legend className={fieldLabelClass}>Icon</legend>
                <div className="community-category-icon-options">
                  {Object.entries(COMMUNITY_CATEGORY_ICONS).map(([iconName, Icon]) => (
                    <button
                      key={iconName}
                      type="button"
                      title={iconName}
                      aria-label={iconName}
                      aria-pressed={communityCategoryDraft.iconName === iconName}
                      className={communityCategoryDraft.iconName === iconName ? "is-selected" : ""}
                      onClick={() => setCommunityCategoryDraft((current) => ({ ...current, iconName }))}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="community-category-color-picker">
                <legend className={fieldLabelClass}>Color</legend>
                <div className="community-category-color-options">
                  {COMMUNITY_CATEGORY_COLORS.map((color) => (
                    <button
                      key={color.key}
                      type="button"
                      title={color.label}
                      aria-label={color.label}
                      aria-pressed={communityCategoryDraft.colorKey === color.key}
                      className={communityCategoryDraft.colorKey === color.key ? "is-selected" : ""}
                      style={{ "--category-tone": color.tone } as CSSProperties}
                      onClick={() => setCommunityCategoryDraft((current) => ({ ...current, colorKey: color.key }))}
                    >
                      <span />
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="community-category-period-options">
              <label className={!communityCategoryDraft.isPeriodic ? "is-selected" : ""}>
                <input className="sr-only" type="radio" name="categoryPeriod" checked={!communityCategoryDraft.isPeriodic} onChange={() => setCommunityCategoryDraft((current) => ({ ...current, isPeriodic: false }))} />
                <Users className="h-4 w-4" /><span><strong>Standard</strong><small>No order support deadline</small></span>
              </label>
              <label className={communityCategoryDraft.isPeriodic ? "is-selected" : ""}>
                <input className="sr-only" type="radio" name="categoryPeriod" checked={communityCategoryDraft.isPeriodic} onChange={() => setCommunityCategoryDraft((current) => ({ ...current, isPeriodic: true }))} />
                <Timer className="h-4 w-4" /><span><strong>Period based</strong><small>Duration is selected per order</small></span>
              </label>
            </div>
            <div className="confirm-modal-actions">
              <Button type="button" variant="secondary" disabled={savingCommunityCategory} onClick={resetCommunityCategoryDraft}>Cancel</Button>
              <Button type="submit" disabled={savingCommunityCategory || !communityCategoryDraft.name.trim()}>{savingCommunityCategory ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{savingCommunityCategory ? "Saving..." : editingCommunityCategoryId ? "Save changes" : "Create category"}</Button>
            </div>
          </form>
        </div>
      ) : null}

      {communityCategoryPendingDeletion ? (
        <div className="confirm-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingCommunityCategory) setCommunityCategoryPendingDeletion(null); }}>
          <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-category-title">
            <span className="confirm-modal-icon" aria-hidden="true"><TriangleAlert className="h-5 w-5" /></span>
            <p className="app-kicker text-[var(--app-danger)]">Delete category</p>
            <h2 id="delete-category-title">Delete “{communityCategoryPendingDeletion.name}”?</h2>
            <p>This removes the empty category permanently. Categories containing members cannot be deleted.</p>
            <div className="confirm-modal-actions">
              <Button autoFocus type="button" variant="secondary" disabled={savingCommunityCategory} onClick={() => setCommunityCategoryPendingDeletion(null)}>Keep category</Button>
              <Button type="button" variant="destructive" disabled={savingCommunityCategory} onClick={() => void handleDeleteCommunityCategory()}>{savingCommunityCategory ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{savingCommunityCategory ? "Deleting..." : "Delete category"}</Button>
            </div>
          </div>
        </div>
      ) : null}

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
            <p id="delete-order-description">
              This removes <strong>{orderPendingDeletion.uniqid}</strong> from your Orders list and tracked orders database. {orderPendingDeletion.provider === "community"
                ? "A waiting delivery is cancelled and its reserved members return to stock."
                : orderPendingDeletion.provider === "dcord"
                  ? "Active local delivery must finish before removal."
                  : "It does not cancel the upstream order."}
            </p>
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
                  <strong>{isCommunityService(orderConfirmationPayload.service) ? (communityCategories.find((category) => category.id === orderConfirmationPayload.categoryId)?.name ?? "Members 2") : (SERVICE_OPTIONS.find((option) => option.value === orderConfirmationPayload.service)?.title ?? orderConfirmationPayload.service)}</strong>
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
                  {isCommunityService(orderConfirmationPayload.service) ? <span><ListChecks className="h-3.5 w-3.5" />{orderConfirmationPayload.joinMethod === "join_application" ? "Join Application" : "Create Invite"}</span> : null}
                  {orderConfirmationPayload.delay ? <span><Timer className="h-3.5 w-3.5" />{orderConfirmationPayload.delay}s delay</span> : null}
                  {confirmationCommunityCategory?.isPeriodic && orderConfirmationPayload.durationMonths ? <span><History className="h-3.5 w-3.5" />{orderConfirmationPayload.durationMonths} month support</span> : null}
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
            <p id="delete-member-description">This removes <strong>{communityMemberPendingDeletion.username}</strong> only from this panel. It does not revoke or modify the S2Tools authorization.</p>
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

      {communityBulkDeleteOpen ? (
        <div
          className="confirm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && communityBulkAction === null) setCommunityBulkDeleteOpen(false);
          }}
        >
          <div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="bulk-delete-members-title" aria-describedby="bulk-delete-members-description">
            <span className="confirm-modal-icon" aria-hidden="true"><TriangleAlert className="h-5 w-5" /></span>
            <p className="app-kicker text-[var(--app-danger)]">Bulk remove</p>
            <h2 id="bulk-delete-members-title">Remove {selectedCommunityMemberIds.length} selected members?</h2>
            <p id="bulk-delete-members-description">This removes the selected users from Members Stock. Members reserved by an active order will be kept.</p>
            <div className="confirm-modal-actions">
              <Button autoFocus type="button" variant="secondary" disabled={communityBulkAction !== null} onClick={() => setCommunityBulkDeleteOpen(false)}>Keep members</Button>
              <Button type="button" variant="destructive" disabled={communityBulkAction !== null} onClick={() => void removeSelectedCommunityMembers()}>
                {communityBulkAction === "delete" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                {communityBulkAction === "delete" ? "Removing..." : "Remove selected"}
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
