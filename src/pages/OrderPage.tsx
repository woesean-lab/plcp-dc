import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Clock3, Copy, ExternalLink, FileJson, Hash, RefreshCw, RotateCcw, Search, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import { extractBotInvite, getPlainDetails } from "../lib/bot-invite";
import { getOrderStatus, updateOrderDelay } from "../lib/tokenu";
import type { OrderStatusResponse } from "../types";

const labelClass = "app-kicker";
const fieldLabelClass = "field-label";

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatTime(value?: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDelay(value?: string | number) {
  if (typeof value === "number" && !Number.isNaN(value)) return `${value}s`;
  if (typeof value === "string" && value.trim()) return value;
  return "-";
}

function isTerminalStatus(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized.includes("completed") || normalized.includes("canceled") || normalized.includes("cancelled");
}

function PageSkeleton() {
  return (
    <section
      className="tab-slide-in grid gap-4 xl:grid-cols-[0.94fr_1.06fr]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading order lookup"
    >
      <span className="sr-only">Loading order lookup</span>
      <div className="app-panel p-5">
        <div className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-11 w-4/5" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="flex flex-wrap gap-4">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-24" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="app-panel-soft p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-4 w-full" />
            </div>
            <div className="app-panel-soft p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-4 w-2/3" />
            </div>
          </div>
        </div>
      </div>

      <div className="app-panel p-5">
        <div className="space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-2/3" />
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="app-panel-soft p-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-3 h-4 w-20" />
              </div>
            ))}
          </div>
          <div className="app-panel-soft p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-5/6" />
          </div>
          <div className="app-panel-soft p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-11/12" />
            <Skeleton className="mt-2 h-4 w-4/5" />
          </div>
        </div>
      </div>
    </section>
  );
}

export default function OrderPage() {
  const [params, setParams] = useSearchParams();
  const [uniqid, setUniqid] = useState(params.get("uniqid") ?? "");
  const [result, setResult] = useState<OrderStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatingDelay, setUpdatingDelay] = useState(false);
  const [delayDraft, setDelayDraft] = useState("");
  const [pageLoading, setPageLoading] = useState(true);

  const summary = useMemo(() => {
    if (!result) return [];

    return [
      { label: "Status", value: result.status ?? "UNKNOWN" },
      { label: "Added", value: typeof result.added === "number" ? String(result.added) : "-" },
      {
        label: "Amount",
        value: typeof result.amount === "number" ? String(result.amount) : typeof result.quantity === "number" ? String(result.quantity) : "-"
      }
    ];
  }, [result]);
  const botInvite = useMemo(() => extractBotInvite(result), [result]);

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

  async function lookup(customId?: string) {
    const target = (customId ?? uniqid).trim();
    if (!target) {
      toast.error("Order ID is required.");
      return;
    }

    setLoading(true);

    try {
      const data = await getOrderStatus(target);
      setResult(data);
      setDelayDraft(String(typeof data.delay === "number" ? data.delay : data.delay ?? ""));
      toast.success(`Loaded ${target}.`);
      setParams({ uniqid: target });
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
      await updateOrderDelay(target, delay);
      toast.success("Delay updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delay could not be updated.");
      void lookup(target);
    } finally {
      setUpdatingDelay(false);
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
      await navigator.clipboard.writeText(`${window.location.origin}/monitor/${encodeURIComponent(target)}`);
      toast.success("Public monitor link copied.");
    } catch {
      toast.error("Public monitor link could not be copied.");
    }
  }

  const shell = "app-panel";
  if (pageLoading || loading) {
    return (
      <section className="relative">
        <PageSkeleton />
      </section>
    );
  }

  const terminal = isTerminalStatus(result?.status);

  return (
    <section className="tab-slide-in relative grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
      <div className={`${shell} p-5 sm:p-6`}>
        <div className="flex items-center gap-3">
          <span className="stat-icon" aria-hidden="true">
            <Search className="h-4 w-4" />
          </span>
          <div>
            <p className={labelClass}>Public tracker</p>
            <h1 className="app-title mt-1 text-[2rem] font-semibold">Order lookup</h1>
          </div>
        </div>
        <p className="app-copy mt-4 max-w-md text-sm leading-6">Enter an order ID to open its latest status, delivery details, and raw payload.</p>

        <form
          className="mt-6 grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void lookup();
          }}
        >
          <label className="grid gap-2">
            <span className={fieldLabelClass}>Order ID</span>
            <Input
              value={uniqid}
              onChange={(event) => setUniqid(event.target.value)}
              placeholder="XXX-XXXXX-XXX"
              className="font-mono"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <Button className="min-w-[132px] px-4 py-2.5 max-sm:w-full" type="submit" disabled={loading}>
              <Search className="h-4 w-4" aria-hidden="true" />
              {loading ? "Loading..." : "Check"}
            </Button>
            <Button
              variant="secondary"
              className="min-w-[132px] px-4 py-2.5 max-sm:w-full"
              type="button"
              disabled={loading || !uniqid.trim()}
              onClick={() => void lookup()}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button
              variant="secondary"
              className="min-w-[132px] px-4 py-2.5 max-sm:w-full"
              type="button"
              onClick={() => {
                setUniqid("");
                setResult(null);
                setParams({});
                toast("Enter an order ID.");
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Clear
            </Button>
          </div>
        </form>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="app-panel-soft p-4">
            <div className="flex items-center justify-between gap-3">
              <p className={labelClass}>Protected</p>
              <ShieldCheck className="h-4 w-4 text-[var(--app-success)]" aria-hidden="true" />
            </div>
            <p className="app-copy mt-2 text-sm">Status, details, payload.</p>
          </div>
          <div className="app-panel-soft p-4">
            <div className="flex items-center justify-between gap-3">
              <p className={labelClass}>Created</p>
              <Clock3 className="h-4 w-4 text-[var(--app-accent)]" aria-hidden="true" />
            </div>
            <p className="app-copy mt-2 text-sm">
              {result?.createdAt ? formatTime(result.createdAt) : result?.created_at ? formatTime(result.created_at) : "-"}
            </p>
          </div>
        </div>
      </div>
      <div className={`${shell} p-5 sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="stat-icon" aria-hidden="true">
              <FileJson className="h-4 w-4" />
            </span>
            <div>
              <p className={labelClass}>Order payload</p>
              <h2 className="app-title mt-1 text-xl font-semibold">Summary and details</h2>
            </div>
          </div>
          {result ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => void copyPublicMonitorLink()}>
              <Copy className="h-4 w-4" aria-hidden="true" /> Copy link
            </Button>
          ) : null}
        </div>

        {loading && !result ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="app-panel-soft p-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="mt-3 h-4 w-20" />
              </div>
              <div className="app-panel-soft p-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="mt-3 h-4 w-14" />
              </div>
              <div className="app-panel-soft p-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="mt-3 h-4 w-14" />
              </div>
            </div>
            <div className="app-panel-soft p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-5/6" />
            </div>
            <div className="app-panel-soft p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-11/12" />
              <Skeleton className="mt-2 h-4 w-4/5" />
            </div>
          </div>
        ) : result ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {summary.map((item) => (
                <div key={item.label} className="app-panel-soft p-4">
                  <span className={labelClass}>{item.label}</span>
                  <strong className="mt-2 block text-lg font-semibold text-[var(--app-text)]">{item.value}</strong>
                </div>
              ))}
            </div>

            <div className={`app-panel-soft p-4 ${botInvite ? "border-[var(--app-accent-border)] bg-[var(--app-accent-soft)]" : ""}`}>
              <div className="flex items-center gap-2 text-[var(--app-text)]">
                {botInvite ? <Bot className="h-4 w-4 text-[var(--app-accent)]" aria-hidden="true" /> : <Hash className="h-4 w-4 text-[var(--app-accent)]" aria-hidden="true" />}
                <strong className="block text-sm font-semibold">{botInvite ? "Action required" : result.uniqid}</strong>
              </div>
              {botInvite ? (
                <>
                  <p className="app-copy mt-3 text-sm leading-6">Add the delivery bot to your Discord server to start this order. The bot only needs the <strong className="text-[var(--app-text)]">Create Invite</strong> permission.</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button type="button" variant="secondary" onClick={() => void copyBotInvite()}>
                      <Copy className="h-4 w-4" aria-hidden="true" /> Copy invite link
                    </Button>
                    <Button asChild>
                      <a href={botInvite} target="_blank" rel="noreferrer">
                        <Bot className="h-4 w-4" aria-hidden="true" /> Add bot to server <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </Button>
                  </div>
                </>
              ) : (
                <p className="app-copy mt-2 text-sm leading-6">{result.error ?? getPlainDetails(result.details)}</p>
              )}
            </div>

            {!terminal ? (
              <div className="app-panel-soft p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className={labelClass}>Delay</p>
                    <strong className="mt-2 block text-lg font-semibold text-[var(--app-text)]">
                      {formatDelay(result.delay)}
                    </strong>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => void handleUpdateDelay()}
                    disabled={updatingDelay}
                  >
                    {updatingDelay ? "Updating..." : "Update"}
                  </Button>
                </div>
                <div className="mt-4 flex gap-2 max-sm:flex-col">
                  <Input
                    type="number"
                    min={1}
                    max={1200}
                    value={delayDraft}
                    onChange={(event) => setDelayDraft(event.target.value)}
                    placeholder="Delay"
                    className="w-28 shrink-0"
                  />
                  <p className="app-copy self-center text-sm">Update the current delay for this order.</p>
                </div>
              </div>
            ) : null}

            <div className="payload-panel overflow-auto p-4">
              <pre className="m-0 whitespace-pre-wrap break-words text-[13px] leading-6 text-[var(--app-text-secondary)]">{formatJson(result)}</pre>
            </div>
          </div>
        ) : (
          <div className="app-panel-soft mt-5 grid min-h-64 place-items-center px-6 py-10 text-center">
            <div>
              <span className="stat-icon mx-auto" aria-hidden="true">
                <FileJson className="h-4 w-4" />
              </span>
              <p className="mt-4 text-sm font-medium text-[var(--app-text-secondary)]">No payload loaded</p>
              <p className="app-copy mt-1 text-sm">Search an order to reveal its summary and JSON response.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
