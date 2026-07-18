import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock3, FileJson, Hash, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { getOrderStatus } from "../lib/tokenu";
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
  const [pageLoading, setPageLoading] = useState(true);
  const [message, setMessage] = useState("Enter an order ID.");

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
      setMessage("Order ID is required.");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const data = await getOrderStatus(target);
      setResult(data);
      setMessage(`Loaded ${target}.`);
      setParams({ uniqid: target });
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Order could not be found.");
    } finally {
      setLoading(false);
    }
  }

  const shell = "app-panel";
  const showOverlay = loading && !pageLoading;

  if (pageLoading) {
    return (
      <section className="relative">
        {showOverlay ? (
          <div className="app-overlay">
            <div className="app-preloader">
              <div className="app-spinner" />
              <p className="app-kicker">Loading</p>
            </div>
          </div>
        ) : null}
        <PageSkeleton />
      </section>
    );
  }

  return (
    <section className="tab-slide-in relative grid gap-5 xl:grid-cols-[0.92fr_1.08fr]">
      {showOverlay ? (
        <div className="app-overlay" role="status" aria-live="polite">
          <div className="app-preloader">
            <div className="app-spinner" />
            <div>
              <p className="app-kicker">Order lookup</p>
              <p className="mt-2 text-sm text-[var(--app-muted)]">Retrieving the latest status</p>
            </div>
            <div className="app-progress" aria-hidden="true"><span /></div>
          </div>
        </div>
      ) : null}

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
              onClick={() => {
                setUniqid("");
                setResult(null);
                setMessage("Enter an order ID.");
                setParams({});
              }}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Clear
            </Button>
          </div>

          {message ? <div className="app-panel-soft app-notice px-4 py-3 text-sm text-[var(--app-text-secondary)]" role="status" aria-live="polite">{message}</div> : null}
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

            <div className="app-panel-soft p-4">
              <div className="flex items-center gap-2 text-[var(--app-text)]">
                <Hash className="h-4 w-4 text-[var(--app-accent)]" aria-hidden="true" />
                <strong className="block font-mono text-sm font-semibold">{result.uniqid}</strong>
              </div>
              <p className="app-copy mt-2 text-sm leading-6">{result.details ?? result.error ?? "No details."}</p>
            </div>

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
