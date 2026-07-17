import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getOrderStatus } from "../lib/tokenu";
import type { OrderStatusResponse } from "../types";

const inputClass =
  "app-input";

const labelClass = "app-kicker";

const buttonClass =
  "app-button app-button-ghost";

const primaryButtonClass =
  "app-button app-button-primary";

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

export default function OrderPage() {
  const [params, setParams] = useSearchParams();
  const [uniqid, setUniqid] = useState(params.get("uniqid") ?? "");
  const [result, setResult] = useState<OrderStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
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
  const showOverlay = loading;

  return (
    <section className="relative grid gap-4 xl:grid-cols-[0.94fr_1.06fr]">
      {showOverlay ? (
        <div className="app-overlay">
          <div className="app-preloader">
            <div className="app-spinner" />
            <p className="app-kicker">Loading</p>
          </div>
        </div>
      ) : null}

      <div className={`${shell} p-5`}>
        <p className={labelClass}>Public tracker</p>
        <h2 className="app-title mt-2 text-[2rem] font-semibold">Order lookup</h2>
        <p className="app-copy mt-2 text-sm leading-6">Open status and payload with an order ID.</p>

        <div className="mt-5 space-y-5">
          <label className="space-y-2">
            <span className={labelClass}>Order ID</span>
            <input
              className={inputClass}
              value={uniqid}
              onChange={(event) => setUniqid(event.target.value)}
              placeholder="XXX-XXXXX-XXX"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-4">
            <button className={primaryButtonClass} type="button" onClick={() => lookup()} disabled={loading}>
              {loading ? "Loading..." : "Check"}
            </button>
            <button
              className={buttonClass}
              type="button"
              onClick={() => {
                setUniqid("");
                setResult(null);
                setMessage("Enter an order ID.");
                setParams({});
              }}
            >
              Clear
            </button>
          </div>

          {message ? <div className="app-panel-soft px-4 py-3 text-sm text-slate-300">{message}</div> : null}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="app-panel-soft p-4">
            <p className={labelClass}>Shown</p>
            <p className="app-copy mt-2 text-sm">Status, details, payload.</p>
          </div>
          <div className="app-panel-soft p-4">
            <p className={labelClass}>Created</p>
            <p className="app-copy mt-2 text-sm">
              {result?.createdAt ? formatTime(result.createdAt) : result?.created_at ? formatTime(result.created_at) : "-"}
            </p>
          </div>
        </div>
      </div>

      <div className={`${shell} p-5`}>
        <p className={labelClass}>Order payload</p>
        <h3 className="app-title mt-2 text-xl font-semibold">Summary and payload</h3>

        {loading && !result ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="app-panel-soft p-4">
                <div className="app-skeleton app-skeleton-line w-16" />
                <div className="app-skeleton app-skeleton-line mt-3 w-20" />
              </div>
              <div className="app-panel-soft p-4">
                <div className="app-skeleton app-skeleton-line w-16" />
                <div className="app-skeleton app-skeleton-line mt-3 w-14" />
              </div>
              <div className="app-panel-soft p-4">
                <div className="app-skeleton app-skeleton-line w-16" />
                <div className="app-skeleton app-skeleton-line mt-3 w-14" />
              </div>
            </div>
            <div className="app-panel-soft p-4">
              <div className="app-skeleton app-skeleton-line w-32" />
              <div className="app-skeleton app-skeleton-line mt-3 w-full" />
              <div className="app-skeleton app-skeleton-line mt-2 w-5/6" />
            </div>
            <div className="app-panel-soft p-4">
              <div className="app-skeleton app-skeleton-line w-24" />
              <div className="app-skeleton app-skeleton-line mt-3 w-full" />
              <div className="app-skeleton app-skeleton-line mt-2 w-11/12" />
              <div className="app-skeleton app-skeleton-line mt-2 w-4/5" />
            </div>
          </div>
        ) : result ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {summary.map((item) => (
                <div key={item.label} className="app-panel-soft p-4">
                  <span className={labelClass}>{item.label}</span>
                  <strong className="mt-2 block text-lg font-semibold text-slate-50">{item.value}</strong>
                </div>
              ))}
            </div>

            <div className="app-panel-soft p-4">
              <strong className="block text-sm font-semibold text-slate-50">{result.uniqid}</strong>
              <p className="app-copy mt-2 text-sm leading-6">{result.details ?? result.error ?? "No details."}</p>
            </div>

            <div className="overflow-auto border border-white/8 bg-[#070b15] p-4">
              <pre className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{formatJson(result)}</pre>
            </div>
          </div>
        ) : (
          <div className="app-panel-soft mt-5 px-4 py-5 text-sm text-slate-400">
            Search an order to load summary and payload.
          </div>
        )}
      </div>
    </section>
  );
}
