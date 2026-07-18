import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Server, ShieldCheck, Timer, Users } from "lucide-react";
import toast from "react-hot-toast";
import { getApiKey } from "../lib/auth";
import { getServiceTitle } from "../lib/services";
import { getOrderStatus, updateOrderDelay } from "../lib/tokenu";
import type { OrderStatusResponse } from "../types";

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
  const [refreshing, setRefreshing] = useState(false);
  const [updatingDelay, setUpdatingDelay] = useState(false);
  const [delayDraft, setDelayDraft] = useState("");
  const [error, setError] = useState("");

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
          setRefreshing(false);
        }
      }
    }

    void loadStatus();

    return () => {
      active = false;
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
  const remainingRatio = typeof membersRemaining === "number" && typeof totalMembers === "number" && totalMembers > 0
    ? Math.min(Math.max(membersRemaining / totalMembers, 0), 1)
    : null;
  const hasApiKey = Boolean(getApiKey());

  useEffect(() => {
    if (typeof currentDelay === "number" && Number.isFinite(currentDelay)) {
      setDelayDraft(String(currentDelay));
    }
  }, [currentDelay]);

  async function refresh() {
    if (!uniqid) return;

    try {
      setRefreshing(true);
      const data = await getOrderStatus(uniqid);
      setStatus(data);
      toast.success("Live stats refreshed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stats could not be refreshed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleUpdateDelay() {
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
      setUpdatingDelay(true);
      await updateOrderDelay(uniqid, nextDelay);
      setStatus((current) => (current ? { ...current, delay: nextDelay } : current));
      toast.success("Delay updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delay could not be updated.");
    } finally {
      setUpdatingDelay(false);
    }
  }

  return (
    <section className="app-shell min-h-screen px-4 py-6 text-[var(--app-text)] sm:px-6 sm:py-8">
      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />

      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl items-center">
        <article className="app-panel w-full overflow-hidden">
          <div className="border-b border-[var(--app-divider)] px-5 py-5 sm:px-7 sm:py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="app-kicker">Guest access</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--app-text)] sm:text-[2.2rem]">
                  {serverName}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--app-muted)]">
                  Live public stats for this order. No admin controls are exposed here.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={getStatusBadgeVariant(status?.status)}>{status?.status ?? "LOADING"}</Badge>
                <Badge variant="outline">{serviceName}</Badge>
                <Button variant="secondary" size="sm" type="button" onClick={() => void refresh()} disabled={loading || refreshing}>
                  <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
                  Refresh
                </Button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="app-panel-soft p-4">
                <p className="app-kicker">Order ID</p>
                <strong className="mt-2 block truncate font-mono text-base text-[var(--app-text)]">{uniqid || "-"}</strong>
              </div>
              <div className="app-panel-soft p-4">
                <p className="app-kicker">Created</p>
                <strong className="mt-2 block text-base text-[var(--app-text)]">{formatDateTime(createdAt)}</strong>
              </div>
              <div className="app-panel-soft p-4">
                <p className="app-kicker">Service</p>
                <strong className="mt-2 block text-base text-[var(--app-text)]">{serviceName}</strong>
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
            <div className="grid gap-5 p-5 sm:p-7">
              <div className={`grid gap-3 ${isCompleted ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
                <div className="app-panel-soft p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="app-kicker">Members</p>
                    <Users className="h-4 w-4 text-[var(--app-success)]" aria-hidden="true" />
                  </div>
                  <strong className="mt-3 block text-2xl font-semibold tracking-tight text-[var(--app-text)]">
                    {typeof membersAdded === "number" && typeof totalMembers === "number"
                      ? `${formatNumber(membersAdded)}/${formatNumber(totalMembers)}`
                      : "-"}
                  </strong>
                </div>
                <div className="app-panel-soft p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="app-kicker">Remaining</p>
                    <Server className="h-4 w-4 text-[var(--app-accent)]" aria-hidden="true" />
                  </div>
                  <strong className="mt-3 block text-2xl font-semibold tracking-tight text-[var(--app-text)]">
                    {typeof membersRemaining === "number" ? formatNumber(membersRemaining) : "-"}
                  </strong>
                </div>
                {!isCompleted ? (
                  <div className="app-panel-soft p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="app-kicker">Delay</p>
                      <Timer className="h-4 w-4 text-[var(--app-accent)]" aria-hidden="true" />
                    </div>
                    <strong className="mt-3 block text-2xl font-semibold tracking-tight text-[var(--app-text)]">
                      {typeof currentDelay === "number" ? `${currentDelay}s` : "-"}
                    </strong>
                  </div>
                ) : null}
                <div className="app-panel-soft flex min-h-[210px] flex-col items-center justify-center p-4">
                  <p className="app-kicker">Remaining chart</p>
                  <div className="relative mt-4 flex aspect-square w-full max-w-[170px] items-center justify-center">
                    <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                      <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                      <circle
                        cx="60"
                        cy="60"
                        r="46"
                        fill="none"
                        stroke="var(--app-accent)"
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray="289"
                        strokeDashoffset={remainingRatio === null ? 289 : 289 - remainingRatio * 289}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                      <strong className="text-[2.4rem] font-semibold leading-none tracking-tight text-[var(--app-text)]">
                        {typeof membersRemaining === "number" ? formatNumber(membersRemaining) : "-"}
                      </strong>
                      <span className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-muted)]">
                        {isCompleted ? "Completed" : "Left"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="app-panel-soft p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="app-kicker">Progress</p>
                    <h2 className="mt-1 text-lg font-semibold text-[var(--app-text)]">Live delivery state</h2>
                  </div>
                  <ShieldCheck className="h-5 w-5 text-[var(--app-success)]" aria-hidden="true" />
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.05)]">
                  <div
                    className="h-full rounded-full bg-[var(--app-accent)] transition-[width] duration-300"
                    style={{ width: progress === null ? "0%" : `${Math.max(progress * 100, 4)}%` }}
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="app-kicker">Server</p>
                    <strong className="mt-2 block text-sm text-[var(--app-text-secondary)]">{serverName}</strong>
                  </div>
                  <div>
                    <p className="app-kicker">Status</p>
                    <strong className="mt-2 block text-sm text-[var(--app-text-secondary)]">{status?.status ?? "Loading"}</strong>
                  </div>
                  <div>
                    <p className="app-kicker">Details</p>
                    <strong className="mt-2 block text-sm text-[var(--app-text-secondary)]">
                      {status?.details ?? status?.error ?? "Live stats are active."}
                    </strong>
                  </div>
                </div>
              </div>

              {!isCompleted ? (
                <div className="app-panel-soft p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="app-kicker">Delay update</p>
                      <h2 className="mt-1 text-lg font-semibold text-[var(--app-text)]">Adjust current delay</h2>
                    </div>
                    <Badge variant={hasApiKey ? "success" : "secondary"}>{hasApiKey ? "Key ready" : "Admin key required"}</Badge>
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
                      disabled={updatingDelay || !hasApiKey}
                    >
                      <Timer className="h-4 w-4" aria-hidden="true" />
                      {updatingDelay ? "Updating..." : "Update delay"}
                    </Button>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-[var(--app-muted)]">
                    {hasApiKey
                      ? "This uses the admin API key stored in your browser."
                      : "Add the admin API key in the same browser if you want this public page to submit delay changes."}
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
