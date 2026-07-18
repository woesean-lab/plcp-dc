import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, CalendarDays, Hash, RefreshCw, Server, ShieldCheck, Timer, TriangleAlert, Users } from "lucide-react";
import toast from "react-hot-toast";
import { getApiKey } from "../lib/auth";
import { getServiceTitle } from "../lib/services";
import { getOrderStatus, updateOrderDelay } from "../lib/tokenu";
import type { OrderStatusResponse } from "../types";

const AUTO_REFRESH_SECONDS = 10;
const DELAY_UPDATE_COOLDOWN_SECONDS = 60;

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
  if (["error", "invalid", "terminated", "canceled", "cancelled"].some((value) => normalized.includes(value))) {
    return "destructive";
  }
  return "secondary";
}

export default function PublicOrderPage() {
  const { uniqid = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<OrderStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [updatingDelay, setUpdatingDelay] = useState(false);
  const [delayDraft, setDelayDraft] = useState("");
  const [error, setError] = useState("");
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState(AUTO_REFRESH_SECONDS);
  const [delayUpdateCooldown, setDelayUpdateCooldown] = useState(0);
  const refreshInFlightRef = useRef(false);
  const countdownRef = useRef(AUTO_REFRESH_SECONDS);
  const delayUpdateInFlightRef = useRef(false);
  const delayUpdateCooldownUntilRef = useRef(0);

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
        const data = await getOrderStatus(uniqid);
        if (!active) return;
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
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!uniqid) return;

    let active = true;
    countdownRef.current = AUTO_REFRESH_SECONDS;
    setSecondsUntilRefresh(AUTO_REFRESH_SECONDS);

    const timer = window.setInterval(() => {
      countdownRef.current -= 1;
      if (countdownRef.current <= 0) {
        countdownRef.current = AUTO_REFRESH_SECONDS;
        if (!refreshInFlightRef.current) {
          refreshInFlightRef.current = true;
          setAutoRefreshing(true);
          void getOrderStatus(uniqid)
            .then((data) => {
              if (active) setStatus(data);
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
  }, [uniqid]);

  const serverName = status?.serverName ?? seed.serverName ?? "Unknown server";
  const serviceName = getServiceTitle(seed.service ?? status?.type);
  const totalMembers =
    typeof status?.amount === "number" ? status.amount : typeof status?.quantity === "number" ? status.quantity : seed.amount;
  const membersAdded = typeof status?.added === "number" ? status.added : undefined;
  const membersRemaining =
    typeof totalMembers === "number" && typeof membersAdded === "number" ? Math.max(totalMembers - membersAdded, 0) : undefined;
  const currentDelay = typeof status?.delay === "number" ? status.delay : seed.delay;
  const createdAt = parseTimestamp(status?.createdAt ?? status?.created_at) ?? parseTimestamp(seed.createdAt);
  const isCompleted = String(status?.status ?? "").toUpperCase() === "COMPLETED";
  const progress =
    typeof totalMembers === "number" && typeof membersAdded === "number" && totalMembers > 0
      ? Math.min(Math.max(membersAdded / totalMembers, 0), 1)
      : null;
  const hasApiKey = Boolean(getApiKey());
  const progressPercent = progress === null ? 0 : Math.round(progress * 100);

  useEffect(() => {
    if (typeof currentDelay === "number" && Number.isFinite(currentDelay)) {
      setDelayDraft(String(currentDelay));
    }
  }, [currentDelay]);

  async function handleUpdateDelay() {
    if (delayUpdateInFlightRef.current || delayUpdateCooldownUntilRef.current > Date.now()) return;

    const nextDelay = Number.parseInt(delayDraft, 10);

    if (!Number.isFinite(nextDelay) || nextDelay <= 0) {
      toast.error("Delay must be a positive number.");
      return;
    }

    if (!uniqid) {
      toast.error("Order ID is missing.");
      return;
    }

    if (!hasApiKey) {
      toast.error("Admin API key is required to update delay.");
      return;
    }

    try {
      delayUpdateInFlightRef.current = true;
      setUpdatingDelay(true);
      await updateOrderDelay(uniqid, nextDelay);
      try {
        const verifiedStatus = await getOrderStatus(uniqid);
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

  const delayUpdatePanel = !isCompleted ? (
    <div className="public-delay-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="app-kicker">Delay update</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--app-text)]">Adjust current delay</h2>
          <p className="public-delay-description">
            Delay determines how many seconds the system waits before the next member joins your server. For example, a
            30-second delay means each member will join 30 seconds after the previous one.
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-3 max-sm:flex-col">
        <Input
          type="number"
          min={1}
          max={1200}
          value={delayDraft}
          onChange={(event) => setDelayDraft(event.target.value)}
          placeholder="Delay"
          className="w-36 shrink-0"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleUpdateDelay()}
          disabled={updatingDelay || delayUpdateCooldown > 0 || !hasApiKey}
        >
          <Timer className="h-4 w-4" aria-hidden="true" />
          {updatingDelay ? "Updating..." : delayUpdateCooldown > 0 ? `Wait ${delayUpdateCooldown}s` : "Update delay"}
        </Button>
      </div>

      <div className="public-delay-warning" role="note">
        <TriangleAlert className="h-4 w-4" aria-hidden="true" />
        <p>
          For new or small servers, we recommend a minimum <strong>700-second delay</strong> between joins when purchasing over
          <strong> 500 members</strong> to avoid the risk of server limitation.
        </p>
      </div>

    </div>
  ) : null;

  return (
    <section className="app-shell min-h-screen px-4 py-6 text-[var(--app-text)] sm:px-6 sm:py-8">
      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />

      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col justify-center gap-5">
        <article className="public-stats-card app-panel w-full overflow-hidden">
          <div className="public-stats-hero">
            <div className="public-stats-brand">
              <span className="brand-mark" aria-hidden="true"><span className="brand-letter">P</span></span>
              <span><span className="brand-eyebrow">Pulcip Members</span><strong>Eldorado best seller :)</strong></span>
            </div>

            <div className="public-stats-heading">
              <div className="min-w-0">
                <div className="public-live-label"><span aria-hidden="true" /> Live public stats</div>
                <h1>{serverName}</h1>
                <p>Real-time delivery visibility for your order, securely shared with you.</p>
              </div>

              <div className="public-stats-actions">
                <Badge variant={getStatusBadgeVariant(status?.status)}>{status?.status ?? "LOADING"}</Badge>
                <Badge variant="outline">{serviceName}</Badge>
                <div className={`auto-refresh-pill ${autoRefreshing ? "is-refreshing" : ""}`} aria-live="polite" aria-label={autoRefreshing ? "Refreshing live stats" : `Next automatic refresh in ${secondsUntilRefresh} seconds`}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{autoRefreshing ? "Refreshing" : "Next refresh"}</span>
                  <strong>{autoRefreshing ? "…" : `${secondsUntilRefresh}s`}</strong>
                </div>
              </div>
            </div>

            <div className="public-stats-meta">
              <div>
                <span className="public-meta-icon"><Hash className="h-4 w-4" /></span>
                <span><small>Order ID</small><strong className="font-mono">{uniqid || "-"}</strong></span>
              </div>
              <div>
                <span className="public-meta-icon"><CalendarDays className="h-4 w-4" /></span>
                <span><small>Created</small><strong>{formatDateTime(createdAt)}</strong></span>
              </div>
              <div>
                <span className="public-meta-icon"><Activity className="h-4 w-4" /></span>
                <span><small>Service</small><strong>{serviceName}</strong></span>
              </div>
            </div>
          </div>

          {loading && !status ? (
            <div className="grid gap-5 p-5 sm:p-7">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="app-panel-soft p-4">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="mt-3 h-7 w-24" />
                  </div>
                ))}
              </div>
              <div className="app-panel-soft p-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="mt-3 h-4 w-full" />
                <Skeleton className="mt-2 h-4 w-5/6" />
              </div>
            </div>
          ) : error ? (
            <div className="p-5 sm:p-7">
              <div className="app-panel-soft border-[var(--app-danger-button-border)] bg-[var(--app-danger-soft)] p-5 text-[var(--app-text)]">
                <p className="app-kicker text-[var(--app-danger)]">Unable to load</p>
                <p className="mt-2 text-sm leading-6 text-[var(--app-text-secondary)]">{error}</p>
              </div>
            </div>
          ) : (
            <div className="public-stats-body">
              <div className="public-stats-overview">
                <div className={`public-metrics-grid ${isCompleted ? "is-completed" : ""}`}>
                <div className="public-metric-card">
                  <div className="flex items-center justify-between gap-3">
                    <p className="app-kicker">Members</p>
                    <span className="public-metric-icon is-success"><Users className="h-4 w-4" aria-hidden="true" /></span>
                  </div>
                  <strong>
                    {typeof membersAdded === "number" && typeof totalMembers === "number"
                      ? `${formatNumber(membersAdded)}/${formatNumber(totalMembers)}`
                      : "-"}
                  </strong>
                  <small>Successfully delivered</small>
                </div>
                <div className="public-metric-card">
                  <div className="flex items-center justify-between gap-3">
                    <p className="app-kicker">Remaining</p>
                    <span className="public-metric-icon"><Server className="h-4 w-4" aria-hidden="true" /></span>
                  </div>
                  <strong>
                    {typeof membersRemaining === "number" ? formatNumber(membersRemaining) : "-"}
                  </strong>
                  <small>Members left in queue</small>
                </div>
                {!isCompleted ? (
                  <div className="public-metric-card">
                    <div className="flex items-center justify-between gap-3">
                      <p className="app-kicker">Delay</p>
                      <span className="public-metric-icon"><Timer className="h-4 w-4" aria-hidden="true" /></span>
                    </div>
                    <strong>
                      {typeof currentDelay === "number" ? `${currentDelay}s` : "-"}
                    </strong>
                    <small>Current delivery interval</small>
                  </div>
                ) : null}
                </div>

              {delayUpdatePanel}

              <div className="public-progress-card">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="app-kicker">Progress</p>
                    <h2>Live delivery state</h2>
                  </div>
                  <span className="public-secure-mark"><ShieldCheck className="h-4 w-4" /> Verified feed</span>
                </div>

                <div className="public-progress-copy"><strong>{progress === null ? "—" : `${progressPercent}%`}</strong><span>completed</span></div>
                <div className="public-progress-track">
                  <div style={{ width: progress === null ? "0%" : `${Math.max(progress * 100, 4)}%` }} />
                </div>

                <div className="public-progress-details">
                  <div>
                    <small>Server</small><strong>{serverName}</strong>
                  </div>
                  <div>
                    <small>Status</small><strong>{status?.status ?? "Loading"}</strong>
                  </div>
                  <div>
                    <small>Details</small><strong>{status?.details ?? status?.error ?? "Live stats are active."}</strong>
                  </div>
                </div>
              </div>
              </div>

              <aside className="public-radial-card">
                <p className="app-kicker">Delivery overview</p>
                <div className="public-radial" style={{ "--progress": `${progressPercent * 3.6}deg` } as CSSProperties}>
                  <div><strong>{progress === null ? "—" : `${progressPercent}%`}</strong><span>{isCompleted ? "Complete" : "Delivered"}</span></div>
                </div>
                <div className="public-radial-stats">
                  <div><small>Delivered</small><strong>{formatNumber(membersAdded)}</strong></div>
                  <div><small>Remaining</small><strong>{formatNumber(membersRemaining)}</strong></div>
                </div>
                <p className="public-radial-note"><span aria-hidden="true" /> Stats update live from the delivery network.</p>
              </aside>

            </div>
          )}
        </article>

        <footer className="app-footer" aria-label="Pulcip Members">
          <span>Pulcip Members</span>
          <span className="app-footer-divider" aria-hidden="true" />
          <span>Private operations suite</span>
        </footer>
      </div>
    </section>
  );
}
