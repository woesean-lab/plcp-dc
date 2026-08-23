import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Bot, Boxes, CalendarDays, Copy, ExternalLink, RefreshCw, RotateCcw, Server, ShieldCheck, Star, Timer, TriangleAlert, Users } from "lucide-react";
import toast from "react-hot-toast";
import { extractBotInvite } from "../lib/bot-invite";
import { getServiceTitle, isBoostService } from "../lib/services";
import { getPublicOrderStatus, replaceDcordBoostToken, restartPublicOrder, updatePublicOrderDelay } from "../lib/integration";
import type { OrderStatusResponse } from "../types";

const AUTO_REFRESH_SECONDS = 10;
const DELAY_UPDATE_COOLDOWN_SECONDS = 60;
const ELDORADO_STORE_URL = "https://www.eldorado.gg/users/PulcipStore/shop/CustomItem?searchQuery=members";

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

function getDcordTokenResultKey(item: Pick<DcordTokenResult, "index" | "token">) {
  return `${item.index}:${item.token}`;
}

function formatNumber(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)
    : "-";
}

function parseNumber(value: string | null | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseTimestamp(value?: number | string) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }

    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      return asDate.getTime();
    }
  }

  return undefined;
}

function formatDateTime(value?: number | string) {
  const timestamp = parseTimestamp(value);
  if (!timestamp) return "-";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function getStatusBadgeVariant(status?: string): "success" | "destructive" | "secondary" {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("completed")) return "success";
  if (["error", "invalid", "terminated", "canceled", "cancelled", "paused"].some((value) => normalized.includes(value))) {
    return "destructive";
  }
  return "secondary";
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
          : ["queued", "joining", "pending", "process", "waiting"].some((value) => normalizedStatus.includes(value))
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
        ["queued", "joining", "pending", "process", "waiting"].some((stateValue) => value.toLowerCase().includes(stateValue))
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

export default function PublicOrderPage() {
  const { uniqid = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<OrderStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [updatingDelay, setUpdatingDelay] = useState(false);
  const [restartingOrder, setRestartingOrder] = useState(false);
  const [replacingTokenIndex, setReplacingTokenIndex] = useState<number | null>(null);
  const [delayDraft, setDelayDraft] = useState("");
  const [error, setError] = useState("");
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(AUTO_REFRESH_SECONDS);
  const [delayUpdateCooldown, setDelayUpdateCooldown] = useState(0);
  const [restartCooldown, setRestartCooldown] = useState(0);
  const [revealedBoostTokens, setRevealedBoostTokens] = useState<Record<string, boolean>>({});
  const refreshInFlightRef = useRef(false);
  const countdownRef = useRef(AUTO_REFRESH_SECONDS);
  const delayUpdateInFlightRef = useRef(false);
  const delayUpdateCooldownUntilRef = useRef(0);
  const restartInFlightRef = useRef(false);
  const restartCooldownUntilRef = useRef(0);
  const boostRevealInitializedRef = useRef(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Pulcip Monitor";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  function syncDelayUpdateCooldown(data: OrderStatusResponse) {
    const remaining = Number(data.delayUpdateCooldownSeconds);
    if (!Number.isFinite(remaining) || remaining <= 0) return;

    const cooldownUntil = Date.now() + Math.ceil(remaining) * 1000;
    if (cooldownUntil > delayUpdateCooldownUntilRef.current) {
      delayUpdateCooldownUntilRef.current = cooldownUntil;
      setDelayUpdateCooldown(Math.ceil(remaining));
    }
  }

  function syncRestartCooldown(data: OrderStatusResponse) {
    const remaining = Number(data.restartCooldownSeconds);
    if (!Number.isFinite(remaining) || remaining <= 0) return;

    const cooldownUntil = Date.now() + Math.ceil(remaining) * 1000;
    if (cooldownUntil > restartCooldownUntilRef.current) {
      restartCooldownUntilRef.current = cooldownUntil;
      setRestartCooldown(Math.ceil(remaining));
    }
  }

  const seed = useMemo(
    () => ({
      service: searchParams.get("service") ?? undefined,
      serverName: searchParams.get("serverName") ?? undefined,
      amount: parseNumber(searchParams.get("amount")),
      delay: parseNumber(searchParams.get("delay")),
      createdAt: searchParams.get("createdAt") ?? undefined
    }),
    [searchParams]
  );
  const refreshStatusService = typeof status?.service === "string" ? status.service : undefined;
  const refreshServiceType = seed.service ?? refreshStatusService ?? status?.type;
  const isBoostRefresh = status?.provider === "dcord" || isBoostService(refreshServiceType);
  const refreshSeconds = isBoostRefresh ? 2 : AUTO_REFRESH_SECONDS;

  useEffect(() => {
    if (!uniqid) {
      setError("Order link is missing.");
      setLoading(false);
      return;
    }

    let active = true;

    async function loadStatus() {
      try {
        setLoading(true);
        setError("");
        const data = await getPublicOrderStatus(uniqid);
        if (!active) return;
        syncDelayUpdateCooldown(data);
        syncRestartCooldown(data);
        setStatus(data);
      } catch (err) {
        if (!active) return;
        setStatus(null);
        setError(err instanceof Error ? err.message : "Order could not be loaded.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadStatus();

    return () => {
      active = false;
    };
  }, [uniqid]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((delayUpdateCooldownUntilRef.current - Date.now()) / 1000));
      setDelayUpdateCooldown((current) => (current === remaining ? current : remaining));
      const restartRemaining = Math.max(0, Math.ceil((restartCooldownUntilRef.current - Date.now()) / 1000));
      setRestartCooldown((current) => (current === restartRemaining ? current : restartRemaining));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!uniqid) return;

    let active = true;
    countdownRef.current = refreshSeconds;
    setSecondsUntilRefresh(refreshSeconds);

    const timer = window.setInterval(() => {
      countdownRef.current -= 1;
      if (countdownRef.current <= 0) {
        countdownRef.current = refreshSeconds;
        if (!refreshInFlightRef.current) {
          refreshInFlightRef.current = true;
          setAutoRefreshing(true);
          void getPublicOrderStatus(uniqid)
            .then((data) => {
              if (active) {
                syncDelayUpdateCooldown(data);
                syncRestartCooldown(data);
                setStatus(data);
              }
            })
            .catch(() => {
              // Keep the last known stats visible and retry on the next cycle.
            })
            .finally(() => {
              refreshInFlightRef.current = false;
              if (active) setAutoRefreshing(false);
            });
        }
      }
      setSecondsUntilRefresh(countdownRef.current);
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [uniqid, refreshSeconds]);

  const isInitialLoading = loading && !status && !error;
  const statusService = typeof status?.service === "string" ? status.service : undefined;
  const serviceType = seed.service ?? statusService ?? status?.type;
  const isBoostOrder = status?.provider === "dcord" || isBoostService(serviceType);
  const unitLabel = isBoostOrder ? "Boosts" : "Members";
  const serverName = status?.serverName ?? seed.serverName ?? "Order monitor";
  const serviceName = serviceType ? getServiceTitle(serviceType) : "Service unavailable";
  const statusLabel = status?.status ?? (error ? "UNAVAILABLE" : "PENDING");
  const totalMembers =
    typeof status?.amount === "number" ? status.amount : typeof status?.quantity === "number" ? status.quantity : seed.amount;
  const membersAdded = typeof status?.added === "number" ? status.added : undefined;
  const membersRemaining =
    typeof totalMembers === "number" && typeof membersAdded === "number" ? Math.max(totalMembers - membersAdded, 0) : undefined;
  const currentDelay = typeof status?.delay === "number" ? status.delay : parseNumber(status?.delay) ?? seed.delay;
  const createdAt = parseTimestamp(status?.createdAt ?? status?.created_at) ?? parseTimestamp(seed.createdAt);
  const normalizedStatus = String(status?.status ?? "").trim().toUpperCase();
  const isCompleted = normalizedStatus === "COMPLETED";
  const isWaiting = normalizedStatus === "WAITING";
  const isInvitesPaused = normalizedStatus.includes("INVITE") && normalizedStatus.includes("PAUSED");
  const isTerminalStatus = ["COMPLETED", "CANCELED", "CANCELLED", "TERMINATED", "INVALID", "ERROR"].some(
    (value) => normalizedStatus.includes(value)
  );
  const botInvite = useMemo(() => extractBotInvite(status), [status]);
  const progress =
    typeof totalMembers === "number" && typeof membersAdded === "number" && totalMembers > 0
      ? Math.min(Math.max(membersAdded / totalMembers, 0), 1)
      : null;
  const progressPercent = progress === null ? 0 : Math.round(progress * 100);
  const estimatedCompletion = isBoostOrder || isTerminalStatus || isInvitesPaused ? null : formatEstimatedDuration(membersRemaining, currentDelay);
  const dcordTokenResults = getDcordTokenResults(status);
  const dcordCompletedTokenCount = dcordTokenResults.filter((item) => item.state !== "pending").length;
  const boostRevealSignature = dcordTokenResults.map((item) => `${getDcordTokenResultKey(item)}:${item.successful}`).join("|");
  const canManageDcordTokens = status?.canManageDcordTokens === true;
  const boostDuration = status?.duration === 1 || status?.duration === 3 ? `${status.duration} Month` : "-";
  const liveBoostStock = status?.liveBoostStock;

  useEffect(() => {
    boostRevealInitializedRef.current = false;
    setRevealedBoostTokens({});
  }, [uniqid]);

  useEffect(() => {
    if (!dcordTokenResults.length) return;

    if (!boostRevealInitializedRef.current) {
      const initiallyRevealed = dcordTokenResults.reduce<Record<string, boolean>>((next, item) => {
        if (item.successful) next[getDcordTokenResultKey(item)] = true;
        return next;
      }, {});
      setRevealedBoostTokens(initiallyRevealed);
      boostRevealInitializedRef.current = true;
      return;
    }

    const timers = dcordTokenResults
      .filter((item) => item.successful && !revealedBoostTokens[getDcordTokenResultKey(item)])
      .map((item) =>
        window.setTimeout(() => {
          const key = getDcordTokenResultKey(item);
          setRevealedBoostTokens((current) => (current[key] ? current : { ...current, [key]: true }));
        }, 700)
      );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [boostRevealSignature, revealedBoostTokens]);

  useEffect(() => {
    if (typeof currentDelay === "number" && Number.isFinite(currentDelay)) {
      setDelayDraft(String(currentDelay));
    }
  }, [currentDelay]);

  async function handleUpdateDelay() {
    if (isTerminalStatus || isInvitesPaused || delayUpdateInFlightRef.current || delayUpdateCooldownUntilRef.current > Date.now()) return;

    const nextDelay = Number.parseInt(delayDraft, 10);

    if (!Number.isFinite(nextDelay) || nextDelay <= 0) {
      toast.error("Delay must be a positive number.");
      return;
    }

    if (!uniqid) {
      toast.error("Order ID is missing.");
      return;
    }

    try {
      delayUpdateInFlightRef.current = true;
      setUpdatingDelay(true);
      await updatePublicOrderDelay(uniqid, nextDelay);
      try {
        const verifiedStatus = await getPublicOrderStatus(uniqid);
        syncDelayUpdateCooldown(verifiedStatus);
        setStatus(verifiedStatus);
      } catch {
        // Keep the last server-confirmed value until the next automatic refresh.
      }
      delayUpdateCooldownUntilRef.current = Date.now() + DELAY_UPDATE_COOLDOWN_SECONDS * 1000;
      setDelayUpdateCooldown(DELAY_UPDATE_COOLDOWN_SECONDS);
      toast.success("Updated Successfully. The changes may take a few minutes to take effect.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delay could not be updated.");
    } finally {
      delayUpdateInFlightRef.current = false;
      setUpdatingDelay(false);
    }
  }

  async function handleRestartOrder() {
    if (!isInvitesPaused || !uniqid || restartInFlightRef.current || restartCooldownUntilRef.current > Date.now()) return;

    try {
      restartInFlightRef.current = true;
      setRestartingOrder(true);
      await restartPublicOrder(uniqid);
      restartCooldownUntilRef.current = Date.now() + DELAY_UPDATE_COOLDOWN_SECONDS * 1000;
      setRestartCooldown(DELAY_UPDATE_COOLDOWN_SECONDS);
      toast.success("Restart request sent successfully.");

      try {
        const verifiedStatus = await getPublicOrderStatus(uniqid);
        syncDelayUpdateCooldown(verifiedStatus);
        syncRestartCooldown(verifiedStatus);
        setStatus(verifiedStatus);
      } catch {
        // Automatic refresh will verify the updated status shortly.
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Order could not be restarted.");
    } finally {
      restartInFlightRef.current = false;
      setRestartingOrder(false);
    }
  }

  async function copyBotInviteLink() {
    if (!botInvite) return;

    try {
      await navigator.clipboard.writeText(botInvite);
      toast.success("Bot link copied.");
    } catch {
      toast.error("Bot invite link could not be copied.");
    }
  }

  async function handleReplaceDcordToken(resultIndex: number) {
    if (!uniqid || replacingTokenIndex !== null || normalizedStatus === "PROCESS") return;

    try {
      setReplacingTokenIndex(resultIndex);
      const payload = await replaceDcordBoostToken(uniqid, resultIndex);
      setStatus(payload.order);
      toast.success("Replacement token tried.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Token could not be replaced.");
    } finally {
      setReplacingTokenIndex(null);
    }
  }

  const delayUpdatePanel = !isBoostOrder && !isTerminalStatus ? (
    <div className="monitor-control-panel">
      <div className="monitor-panel-heading">
        <span className="monitor-panel-icon"><Timer className="h-4 w-4" aria-hidden="true" /></span>
        <div>
          <p className="app-kicker">Delivery control</p>
          <h2>Join delay</h2>
        </div>
        <strong className="monitor-current-delay">{typeof currentDelay === "number" ? `${currentDelay}s` : "-"}</strong>
      </div>

      <div className="monitor-delay-controls">
        <Input
          type="number"
          min={1}
          max={1200}
          value={delayDraft}
          onChange={(event) => setDelayDraft(event.target.value)}
          placeholder="Seconds"
          aria-label="Delay in seconds"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleUpdateDelay()}
          disabled={isInvitesPaused || updatingDelay || delayUpdateCooldown > 0}
        >
          <Timer className="h-4 w-4" aria-hidden="true" />
          {isInvitesPaused ? "Invites paused" : updatingDelay ? "Updating..." : delayUpdateCooldown > 0 ? `Wait ${delayUpdateCooldown}s` : "Update delay"}
        </Button>
      </div>

      <div className="monitor-safety-note" role="note">
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
        <p>
          Over 500 members on a new server? <strong>700s delay is recommended.</strong>
        </p>
      </div>
    </div>
  ) : null;

  return (
    <section className="monitor-page app-shell min-h-screen text-[var(--app-text)]">
      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />

      <main className="monitor-frame">
        <header className="monitor-topbar">
          <div className="monitor-brand">
            <span className="brand-mark" aria-hidden="true"><span className="brand-letter">P</span></span>
            <span><span className="brand-eyebrow">Pulcip</span><strong>{isBoostOrder ? "Boosts Monitor" : "Members Monitor"}</strong></span>
          </div>

          <div className="monitor-topbar-actions">
            <div className="monitor-live-stock" aria-label={`Live boost stock: ${formatNumber(liveBoostStock?.oneMonth)} one month boosts and ${formatNumber(liveBoostStock?.threeMonth)} three month boosts`}>
              <span className="monitor-live-stock-title"><Boxes className="h-3.5 w-3.5" aria-hidden="true" /><span><i aria-hidden="true" /> Live stock</span></span>
              <span><small>1 Month</small><strong>{formatNumber(liveBoostStock?.oneMonth)}</strong></span>
              <span><small>3 Month</small><strong>{formatNumber(liveBoostStock?.threeMonth)}</strong></span>
            </div>
            <div className={`monitor-refresh ${autoRefreshing ? "is-refreshing" : ""}`} aria-live="polite">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{autoRefreshing ? "Syncing live data" : "Live data synced"}</span>
              <strong>{autoRefreshing ? "…" : `${secondsUntilRefresh}s`}</strong>
            </div>
            <a className="monitor-store-link" href={ELDORADO_STORE_URL} target="_blank" rel="noreferrer">
              <Star className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true" />
              <span><strong>Eldorado Top Seller</strong><small>25,000+ sales · 99.7% positive</small></span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </header>

        <article className="monitor-surface">
          <div className="monitor-identity">
            <div className="monitor-server-copy">
              <div className="public-live-label"><span aria-hidden="true" /> Live order monitor</div>
              <h1>{isInitialLoading ? <Skeleton className="h-12 w-72 max-w-[70vw]" /> : serverName}</h1>
              <div className="monitor-order-meta">
                {isInitialLoading ? (
                  <><Skeleton className="h-8 w-20 rounded-full" /><Skeleton className="h-8 w-28 rounded-full" /></>
                ) : (
                  <><Badge variant={getStatusBadgeVariant(statusLabel)}>{statusLabel}</Badge><Badge variant="outline">{serviceName}</Badge></>
                )}
                <span><CalendarDays className="h-3.5 w-3.5" /> {isInitialLoading ? "Loading..." : formatDateTime(createdAt)}</span>
              </div>
            </div>

            <div className="monitor-trust-mark">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              <span><strong>Verified live feed</strong><small>Securely linked to the delivery network</small></span>
            </div>
          </div>

          {loading && !status ? (
            <div className="monitor-loading-grid">
              {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)}
            </div>
          ) : error ? (
            <div className="monitor-error">
              <TriangleAlert className="h-5 w-5" aria-hidden="true" />
              <div><strong>Unable to load this order</strong><p>{error}</p></div>
            </div>
          ) : (
            <div className={`monitor-content ${isBoostOrder ? "is-boost-monitor" : ""}`}>
              {isWaiting && botInvite ? (
                <div className="monitor-bot-alert">
                  <span><Bot className="h-4 w-4" aria-hidden="true" /><strong>Bot required to start delivery</strong></span>
                  <Button type="button" size="xs" variant="secondary" onClick={() => void copyBotInviteLink()}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy bot link
                  </Button>
                  <Button asChild size="xs">
                    <a href={botInvite} target="_blank" rel="noreferrer">
                      <Bot className="h-3.5 w-3.5" aria-hidden="true" /> Add bot
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </Button>
                </div>
              ) : null}

              <div className="monitor-stat-strip">
                <div className="monitor-stat is-primary">
                  <span className="monitor-stat-icon"><Users className="h-4 w-4" aria-hidden="true" /></span>
                  <span><small>Delivered {unitLabel}</small><strong>{formatNumber(membersAdded)}</strong><em>of {formatNumber(totalMembers)}</em></span>
                </div>
                <div className="monitor-stat">
                  <span className="monitor-stat-icon"><Server className="h-4 w-4" aria-hidden="true" /></span>
                  <span><small>Remaining</small><strong>{formatNumber(membersRemaining)}</strong><em>still in queue</em></span>
                </div>
                <div className="monitor-stat">
                  <span className="monitor-stat-icon"><Timer className="h-4 w-4" aria-hidden="true" /></span>
                  <span><small>{isBoostOrder ? "Duration" : "Current delay"}</small><strong>{isBoostOrder ? boostDuration : typeof currentDelay === "number" ? `${currentDelay}s` : "-"}</strong><em>{isBoostOrder ? "subscription length" : "between joins"}</em></span>
                </div>
              </div>

              {isInvitesPaused ? (
                <div className="monitor-restart-warning" role="alert">
                  <span className="monitor-warning-icon" aria-hidden="true"><TriangleAlert className="h-5 w-5" /></span>
                  <div>
                    <p className="app-kicker">Invites paused</p>
                    <h2>Check your Discord server restriction</h2>
                    <p>Confirm that your invite works before continuing the order.</p>
                  </div>
                  <Button type="button" variant="destructive" onClick={() => void handleRestartOrder()} disabled={restartingOrder || restartCooldown > 0}>
                    <RotateCcw className={`h-4 w-4 ${restartingOrder ? "animate-spin" : ""}`} aria-hidden="true" />
                    {restartingOrder ? "Continuing..." : restartCooldown > 0 ? `Wait ${restartCooldown}s` : "Continue"}
                  </Button>
                </div>
              ) : null}

              <div className={`monitor-workspace ${isBoostOrder ? "is-boost" : ""}`}>
                <div className="monitor-progress-panel">
                  <div className="monitor-progress-heading">
                    <div>
                      <p className="app-kicker">Delivery progress</p>
                      <h2>{isCompleted ? "Order completed" : "Order is moving"}</h2>
                    </div>
                    <span className="monitor-progress-percent">{progress === null ? "—" : `${progressPercent}%`}</span>
                  </div>
                  <div className="monitor-progress-track"><div style={{ width: progress === null ? "0%" : `${Math.max(progress * 100, 4)}%` }} /></div>
                  <div className="monitor-progress-foot">
                    <span><Activity className="h-3.5 w-3.5" /> {isCompleted ? "Everything has been delivered" : `${formatNumber(membersAdded)} delivered so far`}</span>
                    {estimatedCompletion ? <span><Timer className="h-3.5 w-3.5" /> {estimatedCompletion}</span> : null}
                  </div>
                </div>

                {delayUpdatePanel}

                {isBoostOrder && canManageDcordTokens ? (
                  <div className="monitor-token-panel">
                    <div className="monitor-token-heading">
                      <div><p className="app-kicker">Token results</p><h2>Per-token boost log</h2></div>
                      <span>{dcordCompletedTokenCount}/{status?.tokenCount ?? "-"} completed</span>
                    </div>

                  {dcordTokenResults.length ? (
                    <div className="public-token-results-list">
                      <div className="public-token-results-head" aria-hidden="true">
                        <span />
                        <span>Token</span>
                        <span className="public-token-result-flow">
                          <span />
                          <span>Join</span>
                          <span>Boost</span>
                          <span>Slots</span>
                        </span>
                      </div>
                      {dcordTokenResults.map((item, index) => {
                        const boostRevealed = !item.successful || revealedBoostTokens[getDcordTokenResultKey(item)];
                        const visibleBoostStatus = boostRevealed ? item.boostStatus : "waiting";
                        const visibleSlots = boostRevealed ? item.slots : "-";

                        return (
                          <div key={`${item.token}-${index}`} className="public-token-result-row" data-result={item.state}>
                            <span className="public-token-result-index">{String(index + 1).padStart(2, "0")}</span>
                            <span className="public-token-result-main">
                              <strong>{item.token}</strong>
                              <small>{item.boostMessage || item.status}</small>
                            </span>
                            <span className="public-token-result-flow">
                              <span className="public-token-result-action">
                                {item.state === "error" ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    className="public-token-replace-button"
                                    onClick={() => void handleReplaceDcordToken(item.index)}
                                    disabled={replacingTokenIndex !== null || normalizedStatus === "PROCESS"}
                                  >
                                    {replacingTokenIndex === item.index ? "Replacing..." : normalizedStatus === "PROCESS" ? "Wait" : "Replace"}
                                  </Button>
                                ) : null}
                              </span>
                              <span className="public-token-result-pill" data-state={item.joinStatus.toLowerCase()}>{item.joinStatus}</span>
                              <span className="public-token-result-pill" data-state={visibleBoostStatus.toLowerCase()}>{visibleBoostStatus}</span>
                              <span className="public-token-result-slots">{visibleSlots}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="public-token-results-empty">Waiting for the first token result.</p>
                  )}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </article>

        <footer className="monitor-footer" aria-label="Pulcip Members">
          <span><ShieldCheck className="h-3.5 w-3.5" /> Secure public link</span>
          <span>Order #{uniqid ? uniqid.slice(-8).toUpperCase() : "-"}</span>
        </footer>
      </main>
    </section>
  );
}
