import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Bot, Copy, ExternalLink, FileJson, Hash, MessageSquareText, RefreshCw, RotateCcw, Server, ShieldCheck, Timer, TriangleAlert, X } from "lucide-react";
import toast from "react-hot-toast";
import { extractBotInvite, getPlainDetails } from "../lib/bot-invite";
import { cancelDcordBoostOrder, getOrderStatus, replaceDcordBoostToken, restartOrder as restartIntegrationOrder, resumeDcordBoostOrder, updateOrderDelay } from "../lib/integration";
import { mergeOrderStatus } from "../lib/order-status";
import { getServiceTitle } from "../lib/services";
import type { OrderProvider, OrderStatusResponse } from "../types";

const labelClass = "app-kicker";
const DISCORD_EPOCH_MS = 1_420_070_400_000n;

type DcordTokenResult = {
  index: number;
  token: string;
  status: string;
  joinStatus: string;
  boostStatus: string;
  slots: string;
  boostMessage: string;
  successful: boolean;
  state: "success" | "pending" | "error";
};

type CommunityMemberResult = {
  index: number;
  username: string;
  avatarUrl: string | null;
  state: string;
  details: string;
  completedAt?: string;
};

function getCommunityMemberResults(source: OrderStatusResponse | null): CommunityMemberResult[] {
  if (!Array.isArray(source?.communityResults)) return [];
  return source.communityResults.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    return [{
      index,
      username: typeof row.username === "string" && row.username.trim() ? row.username.trim() : `Member ${index + 1}`,
      avatarUrl: typeof row.avatarUrl === "string" && row.avatarUrl.trim() ? row.avatarUrl.trim() : null,
      state: typeof row.state === "string" && row.state.trim() ? row.state.trim() : "queued",
      details: typeof row.details === "string" && row.details.trim() ? row.details.trim() : "Waiting for delivery.",
      completedAt: typeof row.completedAt === "string" ? row.completedAt : undefined
    }];
  });
}

function getDcordTokenResults(source: OrderStatusResponse | null): DcordTokenResult[] {
  const results = source?.dcordResults;
  if (!Array.isArray(results)) return [];

  return results
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      const token = typeof row.token === "string" && row.token.trim() ? row.token.trim() : `Token ${index + 1}`;
      const status = typeof row.status === "string" && row.status.trim() ? row.status.trim() : "unknown";
      const normalizedStatus = status.toLowerCase();
      const successful = row.boosted === true || normalizedStatus.includes("boosted");
      const joined = row.success === true || successful || normalizedStatus.includes("joined");
      const joinStatus = typeof row.joinStatus === "string" && row.joinStatus.trim()
        ? row.joinStatus.trim()
        : joined
          ? "joined"
          : ["queued", "pending", "waiting"].some((value) => normalizedStatus.includes(value))
            ? "waiting"
            : normalizedStatus.includes("joining") || normalizedStatus.includes("process")
              ? "joining"
              : "failed";
      const boostStatus = typeof row.boostStatus === "string" && row.boostStatus.trim()
        ? row.boostStatus.trim()
        : successful
          ? "boosted"
          : ["queued", "joining", "pending", "process", "waiting", "verifying"].some((value) => normalizedStatus.includes(value))
            ? "waiting"
            : "failed";
      const rawSlots = row.slots;
      const slots = typeof rawSlots === "number" && Number.isFinite(rawSlots)
        ? rawSlots > 0 ? `+${rawSlots}` : "-"
        : typeof rawSlots === "string" && rawSlots.trim()
          ? rawSlots.trim()
          : successful
            ? "+2"
            : "-";
      const boostMessage = typeof row.boostMessage === "string" && row.boostMessage.trim()
        ? row.boostMessage.trim()
        : typeof row.boost_message === "string" && row.boost_message.trim()
          ? row.boost_message.trim()
          : "";
      const isPending = [joinStatus, boostStatus, status].some((value) =>
        ["queued", "joining", "pending", "process", "waiting", "verifying"].some((stateValue) => value.toLowerCase().includes(stateValue))
      );
      const isFailed = [joinStatus, boostStatus, status].some((value) =>
        ["failed", "error", "skipped"].some((stateValue) => value.toLowerCase().includes(stateValue))
      );
      const state = successful
        ? "success"
        : isFailed
          ? "error"
          : isPending
            ? "pending"
            : "error";

      return { index, token, status, joinStatus, boostStatus, slots, boostMessage, successful, state };
    })
    .filter((item): item is DcordTokenResult => Boolean(item));
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatTime(value?: number | string) {
  if (!value) return "-";
  const numericValue = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value) : null;
  const normalizedValue = numericValue === null ? value : numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatTemplateNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US").format(value)
    : "-";
}

function formatDelay(value?: string | number) {
  if (typeof value === "number" && !Number.isNaN(value)) return `${value}s`;
  if (typeof value === "string" && value.trim()) return value;
  return "-";
}

function formatEstimatedDuration(remaining?: number, delay?: number) {
  if (typeof remaining !== "number" || typeof delay !== "number" || !Number.isFinite(remaining) || !Number.isFinite(delay)) {
    return null;
  }
  if (remaining <= 0) return "Completion imminent";

  const totalSeconds = Math.max(Math.ceil(remaining * delay), 0);
  if (totalSeconds < 60) return "Less than 1 minute remaining";

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes || parts.length === 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return `About ${parts.join(" ")} remaining`;
}

function formatTemplateDelay(value?: string | number) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "-";

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? String(parsed) : value.trim() || "-";
}

function getStringField(source: OrderStatusResponse | null, keys: string[]) {
  if (!source) return "";

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return "";
}

function getNumberField(source: OrderStatusResponse | null, keys: string[]) {
  if (!source) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return undefined;
}

function normalizeOrderService(value: string, isDcordProvider: boolean) {
  if (isDcordProvider) return "DCORD-BOOSTS";
  const normalized = value.trim().toUpperCase().replace(/[\s_]+/g, "-");
  if (["OFFLINE", "ONLINE", "PREMIUM", "NFT"].includes(normalized)) return `OAUTH-${normalized}`;
  return normalized || "UNKNOWN";
}

function getDiscordServerCreatedAt(serverId: string) {
  if (!/^\d{17,20}$/.test(serverId)) return undefined;

  try {
    const timestamp = Number((BigInt(serverId) >> 22n) + DISCORD_EPOCH_MS);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  } catch {
    return undefined;
  }
}

function isTerminalStatus(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  return ["completed", "partial", "canceled", "cancelled", "terminated", "invalid", "error"].some((value) => normalized.includes(value));
}

function OrderDetailsSkeleton() {
  return (
    <section
      className="lookup-page tab-slide-in relative grid min-w-0 gap-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading order details"
    >
      <article className="app-panel lookup-workspace" aria-hidden="true">
        <header className="lookup-workspace-header">
          <div className="lookup-order-identity">
            <Skeleton className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <Skeleton className="h-5 w-44 max-w-full" />
              <div className="mt-3 flex gap-2">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-36" />
              </div>
            </div>
          </div>
          <div className="lookup-workspace-actions">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-10" />
          </div>
        </header>

        <section className="lookup-live-progress">
          <div className="lookup-progress-heading">
            <div>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-5 w-40" />
            </div>
            <div className="grid justify-items-end gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
          <div className="lookup-progress-stats">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index}>
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="mt-2 h-5 w-12" />
              </div>
            ))}
          </div>
          <Skeleton className="h-2 w-full" />
          <div className="lookup-progress-foot">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-36" />
          </div>
        </section>

        <div className="lookup-metrics">
          <div><Skeleton className="h-3 w-20" /><Skeleton className="mt-2 h-5 w-28" /></div>
          <div><Skeleton className="h-3 w-20" /><Skeleton className="mt-2 h-5 w-16" /></div>
        </div>

        <div className="lookup-context-row">
          <section className="lookup-order-note">
            <Skeleton className="h-9 w-9 shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-4 w-72 max-w-full" />
            </div>
          </section>
          <section className="lookup-delay-control">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-24" />
          </section>
        </div>
      </article>
    </section>
  );
}

export default function OrderPage() {
  const [params, setParams] = useSearchParams();
  const [uniqid, setUniqid] = useState(params.get("uniqid") ?? "");
  const providerParam = params.get("provider");
  const provider = (providerParam === "dcord" || providerParam === "community" ? providerParam : "tokenu") as OrderProvider;
  const [result, setResult] = useState<OrderStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingDelay, setUpdatingDelay] = useState(false);
  const [restartingOrder, setRestartingOrder] = useState(false);
  const [resumingDcordOrder, setResumingDcordOrder] = useState(false);
  const [cancellingDcordOrder, setCancellingDcordOrder] = useState(false);
  const [replacingTokenIndex, setReplacingTokenIndex] = useState<number | null>(null);
  const [delayDraft, setDelayDraft] = useState("");
  const [pageLoading, setPageLoading] = useState(true);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(provider === "tokenu" ? 10 : 2);
  const refreshInFlightRef = useRef(false);
  const isDcordProvider = provider === "dcord";
  const isCommunityProvider = provider === "community";

  const botInvite = useMemo(() => extractBotInvite(result), [result]);
  const normalizedStatus = String(result?.status ?? "").trim().toUpperCase();
  const terminal = isTerminalStatus(result?.status);
  const isWaitingForBot = normalizedStatus === "WAITING" && Boolean(botInvite);
  const isWaitingForDcord = isDcordProvider && normalizedStatus === "WAITING";
  const isInvitesPaused = normalizedStatus.includes("INVITE") && normalizedStatus.includes("PAUSED");
  const serverId = getStringField(result, ["serverId", "server_id", "guildId", "guild_id", "id"]);
  const serverName = getStringField(result, ["serverName", "server_name", "guildName", "guild_name"]);
  const serverCreatedAt = getDiscordServerCreatedAt(serverId);
  const serviceType = normalizeOrderService(getStringField(result, ["service", "type"]), isDcordProvider);
  const serviceName = getServiceTitle(serviceType);
  const serverMemberCount = getNumberField(result, [
    "serverMemberCount",
    "approximateMemberCount",
    "approximate_member_count",
    "memberCount",
    "member_count",
    "members"
  ]);
  const totalAmount = getNumberField(result, ["amount", "quantity"]);
  const addedAmount = getNumberField(result, ["added"]);
  const remainingAmount = typeof totalAmount === "number" && typeof addedAmount === "number" ? Math.max(totalAmount - addedAmount, 0) : undefined;
  const progress = typeof totalAmount === "number" && typeof addedAmount === "number" && totalAmount > 0
    ? Math.min(Math.max(addedAmount / totalAmount, 0), 1)
    : null;
  const progressPercent = progress === null ? 0 : Math.round(progress * 100);
  const currentDelay = getNumberField(result, ["delay"]);
  const expiration = result?.expiredAt ?? result?.expired_at;
  const estimatedCompletion = isDcordProvider || terminal || isInvitesPaused
    ? null
    : formatEstimatedDuration(remainingAmount, currentDelay);
  const dcordTokenResults = getDcordTokenResults(result);
  const hasQueuedDcordTokens = dcordTokenResults.some((item) => item.status.toLowerCase() === "queued");
  const dcordCompletedTokenCount = dcordTokenResults.filter((item) => item.state !== "pending").length;
  const communityMemberResults = getCommunityMemberResults(result);
  const communityCompletedCount = communityMemberResults.filter((item) => !["queued", "joining"].includes(item.state.toLowerCase())).length;
  const summary = isDcordProvider
    ? [
        { label: "Duration", value: result?.duration === 1 || result?.duration === 3 ? `${result.duration} Month` : "-" },
        { label: "Token progress", value: `${dcordCompletedTokenCount}/${result?.tokenCount ?? "-"}` }
      ]
    : [
        { label: "Expiration", value: formatTime(expiration) },
        { label: "Join delay", value: formatDelay(result?.delay) }
      ];

  useEffect(() => {
    const incoming = params.get("uniqid");
    if (incoming) {
      setUniqid(incoming);
      void lookup(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPageLoading(false);
    }, 300);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const target = String(result?.uniqid ?? uniqid).trim();
    const refreshEvery = provider === "tokenu" ? 10 : 2;
    setSecondsUntilRefresh(terminal ? 0 : refreshEvery);
    if (!target || terminal) return;

    let remaining = refreshEvery;

    const timer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = refreshEvery;
        if (!refreshInFlightRef.current) {
          refreshInFlightRef.current = true;
          void getOrderStatus(target, provider)
            .then((data) => setResult((current) => mergeOrderStatus(current, data)))
            .catch(() => {
              // Keep the last loaded admin order visible and retry on the next cycle.
            })
            .finally(() => {
              refreshInFlightRef.current = false;
            });
        }
      }
      setSecondsUntilRefresh(remaining);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [provider, result?.uniqid, terminal, uniqid]);

  async function lookup(customId?: string) {
    const target = (customId ?? uniqid).trim();
    if (!target) {
      toast.error("Order ID is required.");
      return;
    }

    setLoading(true);

    try {
      const data = await getOrderStatus(target, provider);
      setResult(data);
      setDelayDraft(String(typeof data.delay === "number" ? data.delay : data.delay ?? ""));
      toast.success(`Loaded ${target}.`);
      setParams(provider === "tokenu" ? { uniqid: target } : { uniqid: target, provider });
    } catch (error) {
      setResult(null);
      toast.error(error instanceof Error ? error.message : "Order could not be found.");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateDelay() {
    const target = (result?.uniqid ?? uniqid).trim();
    const delay = Number.parseInt(delayDraft, 10);

    if (!target) {
      toast.error("Order ID is required.");
      return;
    }

    if (!Number.isFinite(delay) || delay <= 0) {
      toast.error("Delay must be a positive number.");
      return;
    }

    try {
      setUpdatingDelay(true);
      setResult((current) => (current ? { ...current, delay } : current));
      await updateOrderDelay(target, delay, provider);
      toast.success("Delay updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delay could not be updated.");
      void lookup(target);
    } finally {
      setUpdatingDelay(false);
    }
  }

  async function handleRestartOrder() {
    const target = String(result?.uniqid ?? uniqid).trim();
    if (!target || !isInvitesPaused || restartingOrder) return;

    try {
      setRestartingOrder(true);
      await restartIntegrationOrder(target);
      toast.success("Restart request sent.");

      try {
        const data = await getOrderStatus(target, provider);
        setResult((current) => mergeOrderStatus(current, data));
      } catch {
        // Live refresh will verify the updated status on the next cycle.
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Order could not be restarted.");
    } finally {
      setRestartingOrder(false);
    }
  }

  async function handleResumeDcordOrder() {
    const target = String(result?.uniqid ?? uniqid).trim();
    if (!target || !isWaitingForDcord || !hasQueuedDcordTokens || resumingDcordOrder) return;

    try {
      setResumingDcordOrder(true);
      const data = await resumeDcordBoostOrder(target);
      setResult((current) => mergeOrderStatus(current, data));
      toast.success("Dcord delivery check started.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dcord delivery could not be resumed.");
    } finally {
      setResumingDcordOrder(false);
    }
  }

  async function handleCancelDcordOrder() {
    const target = String(result?.uniqid ?? uniqid).trim();
    if (!target || !isWaitingForDcord || cancellingDcordOrder) return;
    const confirmation = hasQueuedDcordTokens
      ? "Cancel this delivery and return all unsubmitted tokens to stock?"
      : "Cancel this order and force the submitted verifying tokens back to stock? Their Dcord result may still complete later.";
    if (!window.confirm(confirmation)) return;

    try {
      setCancellingDcordOrder(true);
      const data = await cancelDcordBoostOrder(target);
      setResult((current) => mergeOrderStatus(current, data));
      const returnedCount = typeof data.returnedTokenCount === "number" ? data.returnedTokenCount : 0;
      toast.success(`Delivery cancelled. ${returnedCount} token${returnedCount === 1 ? "" : "s"} returned to stock.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dcord delivery could not be cancelled.");
    } finally {
      setCancellingDcordOrder(false);
    }
  }

  async function handleReplaceDcordToken(resultIndex: number) {
    const target = String(result?.uniqid ?? uniqid).trim();
    if (!target) {
      toast.error("Order ID is required.");
      return;
    }

    try {
      setReplacingTokenIndex(resultIndex);
      const payload = await replaceDcordBoostToken(target, resultIndex);
      setResult((current) => mergeOrderStatus(current, payload.order));
      toast.success("Replacement token started.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Token could not be replaced.");
    } finally {
      setReplacingTokenIndex(null);
    }
  }

  async function copyBotInvite() {
    if (!botInvite) return;
    try {
      await navigator.clipboard.writeText(botInvite);
      toast.success("Bot invite link copied.");
    } catch {
      toast.error("Bot invite link could not be copied.");
    }
  }

  async function copyPublicMonitorLink() {
    const target = String(result?.uniqid ?? uniqid).trim();
    if (!target) return;

    try {
      await navigator.clipboard.writeText(getPublicMonitorLink(target));
      toast.success("Public monitor link copied.");
    } catch {
      toast.error("Public monitor link could not be copied.");
    }
  }

  function openPublicMonitorLink() {
    const target = String(result?.uniqid ?? uniqid).trim();
    if (!target) return;
    window.open(getPublicMonitorLink(target), "_blank", "noopener,noreferrer");
  }

  function getPublicMonitorLink(target: string) {
    return `${window.location.origin}/monitor/${encodeURIComponent(target)}`;
  }

  async function copyDeliveryTemplate() {
    const target = String(result?.uniqid ?? uniqid).trim();

    if (!target || !botInvite) {
      toast.error("Bot invite link is required.");
      return;
    }

    const message = [
      "Please add our bot to your server to start the delivery.",
      "",
      "🔑 Required Permission: Create Invite only.",
      "",
      "You can remove the bot from your server after all members have been added.",
      "",
      "🤖 Add Bot:",
      botInvite,
      "",
      "📊 Order Monitor:",
      getPublicMonitorLink(target),
      "",
      `⚙️ Join Delay: ${formatTemplateDelay(result?.delay)} seconds (Fully customizable.)`
    ].join("\n");

    try {
      await navigator.clipboard.writeText(message);
      toast.success("Delivery template copied.");
    } catch {
      toast.error("Delivery template could not be copied.");
    }
  }

  const shell = "app-panel";
  if (pageLoading || (loading && !result)) {
    return <OrderDetailsSkeleton />;
  }

  return (
    <section className="lookup-page tab-slide-in relative grid min-w-0 gap-4">
      {result ? (
        <article className={`${shell} lookup-workspace`}>
          <header className="lookup-workspace-header">
            <div className="lookup-order-identity">
              <span className="lookup-provider-mark" aria-hidden="true">
                {isDcordProvider || isCommunityProvider ? <Bot className="h-4 w-4" /> : <FileJson className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <h2>{serverName || "Discord server"}</h2>
                <div className="lookup-order-labels">
                  <span className="lookup-status" data-status={normalizedStatus.toLowerCase()}>
                    <small>Order status</small>
                    <strong>{result.status ?? "UNKNOWN"}</strong>
                  </span>
                  <span className="lookup-service-name">
                    <small>Service</small>
                    <strong>{serviceName}</strong>
                    <code>{serviceType}</code>
                  </span>
                </div>
              </div>
            </div>

            <div className="lookup-workspace-actions">
              <span className="lookup-live-refresh" data-active={!terminal}>
                <span aria-hidden="true" />
                {terminal ? "Refresh complete" : `Live refresh · ${secondsUntilRefresh}s`}
              </span>
              {!isDcordProvider && !isCommunityProvider && isWaitingForBot ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  title="Copy delivery template message"
                  onClick={() => void copyDeliveryTemplate()}
                >
                  <MessageSquareText className="h-4 w-4" aria-hidden="true" /> Delivery template
                </Button>
              ) : null}
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyPublicMonitorLink()}>
                <Copy className="h-4 w-4" aria-hidden="true" /> Monitor link
              </Button>
              <Button type="button" variant="secondary" size="icon" onClick={openPublicMonitorLink} title="Open monitor" aria-label="Open monitor">
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </header>

          <section className="lookup-live-progress">
            <div className="lookup-progress-heading">
              <div>
                <p className="app-kicker">Live delivery</p>
                <h3>{terminal && normalizedStatus === "COMPLETED" ? "Order completed" : isWaitingForBot ? "Waiting for bot" : isWaitingForDcord ? "Waiting for Dcord" : "Delivery in progress"}</h3>
              </div>
              <div className="lookup-progress-value">
                <strong>{progress === null ? "-" : `${progressPercent}%`}</strong>
                <span>Order progress</span>
              </div>
            </div>
            <div className="lookup-progress-stats">
              <div>
                <small>Delivered</small>
                <strong>{formatTemplateNumber(addedAmount)}</strong>
              </div>
              <div>
                <small>Total ordered</small>
                <strong>{formatTemplateNumber(totalAmount)}</strong>
              </div>
              <div className="is-remaining">
                <small>Remaining</small>
                <strong>{formatTemplateNumber(remainingAmount)}</strong>
              </div>
            </div>
            <div className="lookup-progress-track" aria-label={progress === null ? "Progress unavailable" : `${progressPercent}% complete`}>
              <span style={{ width: progress === null ? "0%" : `${Math.max(progress * 100, 4)}%` }} />
            </div>
            <div className="lookup-progress-foot">
              <span><Activity className="h-3.5 w-3.5" /> {formatTemplateNumber(remainingAmount)} remaining</span>
              {estimatedCompletion ? <span><Timer className="h-3.5 w-3.5" /> {estimatedCompletion}</span> : null}
            </div>
          </section>

          <div className="lookup-metrics" aria-label="Order summary">
            {summary.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong title={item.value}>{item.value}</strong>
              </div>
            ))}
          </div>

          {isInvitesPaused && !isDcordProvider && !isCommunityProvider ? (
            <section className="lookup-invites-warning" role="alert">
              <span className="lookup-invites-warning-icon" aria-hidden="true"><TriangleAlert className="h-4 w-4" /></span>
              <div>
                <p className="app-kicker">Invites paused</p>
                <strong>Discord invites need attention</strong>
                <span>Confirm that the server invite works, then restart the order.</span>
              </div>
              <Button type="button" variant="destructive" size="sm" onClick={() => void handleRestartOrder()} disabled={restartingOrder}>
                <RotateCcw className={`h-4 w-4 ${restartingOrder ? "animate-spin" : ""}`} aria-hidden="true" />
                {restartingOrder ? "Restarting..." : "Restart order"}
              </Button>
            </section>
          ) : null}

          <div className="lookup-context-row">
            <section className={`lookup-order-note ${isWaitingForBot ? "is-action" : ""}`}>
              <span className="lookup-note-icon" aria-hidden="true">
                {isWaitingForBot ? <Bot className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className={labelClass}>{isWaitingForBot ? "Action required" : "Order details"}</p>
                {isWaitingForBot ? (
                  <p>Add the delivery bot with <strong>Create Invite</strong> permission to start this order.</p>
                ) : (
                  <p>{result.error ?? getPlainDetails(result.details)}</p>
                )}
              </div>
              {isWaitingForBot ? (
                <div className="lookup-note-actions">
                  <Button type="button" variant="secondary" size="sm" onClick={() => void copyBotInvite()}>
                    <Copy className="h-4 w-4" aria-hidden="true" /> Copy invite
                  </Button>
                  <Button asChild size="sm">
                    <a href={botInvite} target="_blank" rel="noreferrer">
                      <Bot className="h-4 w-4" aria-hidden="true" /> Add bot <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </Button>
                </div>
              ) : isWaitingForDcord ? (
                <div className="lookup-note-actions">
                  {hasQueuedDcordTokens ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => void handleResumeDcordOrder()} disabled={resumingDcordOrder}>
                      <RotateCcw className={`h-4 w-4 ${resumingDcordOrder ? "animate-spin" : ""}`} aria-hidden="true" />
                      {resumingDcordOrder ? "Starting..." : "Resume delivery"}
                    </Button>
                  ) : null}
                  <Button type="button" variant="dangerGhost" size="sm" onClick={() => void handleCancelDcordOrder()} disabled={cancellingDcordOrder || resumingDcordOrder}>
                    <X className="h-4 w-4" aria-hidden="true" />
                    {cancellingDcordOrder ? "Cancelling..." : "Cancel delivery"}
                  </Button>
                </div>
              ) : null}
            </section>

            {!terminal && !isInvitesPaused && !isDcordProvider ? (
              <section className="lookup-delay-control">
                <div>
                  <p className={labelClass}>Join delay</p>
                  <strong>{formatDelay(result.delay)}</strong>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={1200}
                  value={delayDraft}
                  onChange={(event) => setDelayDraft(event.target.value)}
                  placeholder="Delay"
                />
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleUpdateDelay()} disabled={updatingDelay}>
                  {updatingDelay ? "Updating..." : "Update"}
                </Button>
              </section>
            ) : null}
          </div>

          {isDcordProvider ? (
            <section className="lookup-token-panel">
              <div className="lookup-section-heading">
                <div>
                  <p className="app-kicker">Token results</p>
                  <h3>Per-token boost log</h3>
                </div>
                <span className="public-secure-mark"><ShieldCheck className="h-3.5 w-3.5" /> {dcordCompletedTokenCount}/{result.tokenCount ?? "-"} completed</span>
              </div>

              {dcordTokenResults.length ? (
                <div className="public-token-results-list">
                  <div className="public-token-results-head" aria-hidden="true">
                    <span />
                    <span>Token</span>
                    <span className="public-token-result-flow"><span /><span>Join</span><span>Boost</span><span>Slots</span></span>
                  </div>
                  {dcordTokenResults.map((item, index) => (
                    <div key={`${item.token}-${index}`} className="public-token-result-row" data-result={item.state}>
                      <span className="public-token-result-index">{String(index + 1).padStart(2, "0")}</span>
                      <span className="public-token-result-main">
                        <strong>{item.token}</strong>
                        <small>{item.boostMessage || item.status}</small>
                      </span>
                      <span className="public-token-result-flow">
                        <span className="public-token-result-action">
                          {item.state === "error" && normalizedStatus !== "CANCELLED" ? (
                            <Button type="button" variant="ghost" size="xs" className="public-token-replace-button" onClick={() => void handleReplaceDcordToken(item.index)} disabled={replacingTokenIndex !== null || normalizedStatus === "PROCESS"}>
                              {replacingTokenIndex === item.index ? "Replacing..." : normalizedStatus === "PROCESS" ? "Wait" : "Replace"}
                            </Button>
                          ) : null}
                        </span>
                        <span className="public-token-result-pill" data-state={item.joinStatus.toLowerCase()}>{item.joinStatus}</span>
                        <span className="public-token-result-pill" data-state={item.boostStatus.toLowerCase()}>{item.boostStatus}</span>
                        <span className="public-token-result-slots">{item.slots}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="public-token-results-empty">Waiting for token results.</p>
              )}
            </section>
          ) : null}

          {isCommunityProvider ? (
            <section className="lookup-token-panel community-order-log">
              <div className="lookup-section-heading">
                <div>
                  <p className="app-kicker">Member results</p>
                  <h3>Per-member delivery log</h3>
                </div>
                <span className="public-secure-mark"><ShieldCheck className="h-3.5 w-3.5" /> {communityCompletedCount}/{communityMemberResults.length || result.amount || "-"} processed</span>
              </div>

              {communityMemberResults.length ? (
                <div className="community-order-result-list">
                  {communityMemberResults.map((item) => (
                    <div key={`${item.username}-${item.index}`} className="community-order-result" data-state={item.state.toLowerCase()}>
                      <span className="community-order-avatar" aria-hidden="true">
                        {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : <span>{String(item.index + 1).padStart(2, "0")}</span>}
                      </span>
                      <span className="community-order-result-copy">
                        <strong>{item.username}</strong>
                        <small>{item.details}</small>
                      </span>
                      <span className="public-token-result-pill" data-state={item.state.toLowerCase()}>{item.state.replaceAll("_", " ")}</span>
                      <time dateTime={item.completedAt}>{item.completedAt ? formatTime(item.completedAt) : "-"}</time>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="public-token-results-empty">Waiting for member results.</p>
              )}
            </section>
          ) : null}

          <details className="lookup-technical-details">
            <summary>
              <span><Server className="h-4 w-4" aria-hidden="true" /> Order &amp; server details</span>
              <small>IDs and timestamps</small>
            </summary>
            <div className="lookup-technical-grid">
              <div><span>Order ID</span><strong className="is-mono" title={result.uniqid}>{result.uniqid}</strong></div>
              <div><span>Server ID</span><strong className="is-mono" title={serverId || "-"}>{serverId || "-"}</strong></div>
              <div><span>Current members</span><strong>{formatTemplateNumber(serverMemberCount)}</strong></div>
              <div><span>Order created</span><strong>{result.createdAt ? formatTime(result.createdAt) : result.created_at ? formatTime(result.created_at) : "-"}</strong></div>
              <div><span>Server created</span><strong>{formatTime(serverCreatedAt)}</strong></div>
            </div>
          </details>

          <details className="lookup-raw-payload">
            <summary>
              <span><FileJson className="h-4 w-4" aria-hidden="true" /> Raw order payload</span>
              <small>JSON</small>
            </summary>
            <div className="payload-panel overflow-auto p-4">
              <pre className="m-0 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--app-text-secondary)]">{formatJson(result)}</pre>
            </div>
          </details>
        </article>
      ) : (
        <div className={`${shell} lookup-empty-state`}>
          <span className="lookup-empty-icon" aria-hidden="true"><FileJson className="h-5 w-5" /></span>
          <div>
            <strong>No order selected</strong>
            <p>Open an order from the Orders page to view its operational status.</p>
          </div>
        </div>
      )}
    </section>
  );
}
