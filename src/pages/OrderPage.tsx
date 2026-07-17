import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getOrderStatus } from "../lib/tokenu";
import type { OrderStatusResponse } from "../types";

const inputClass =
  "w-full rounded-[3px] border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-amber-300/60 focus:ring-4 focus:ring-amber-400/10";

const labelClass = "text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500";

const buttonClass =
  "inline-flex items-center justify-center rounded-[3px] border px-4 py-2.5 text-sm font-medium transition border-slate-700 bg-slate-950/60 text-slate-200 hover:border-amber-300/40 hover:bg-slate-800";

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

  const card = "border border-slate-700/70 bg-slate-900/70 shadow-2xl shadow-slate-950/30";

  return (
    <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
      <div className={`${card} p-5`}>
        <p className={labelClass}>Public tracker</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-100">Sipariş sorgulama</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">Order ID ile durum ve payload açılır.</p>

        <div className="mt-5 space-y-4">
          <label className="space-y-2">
            <span className={labelClass}>Order ID</span>
            <input
              className={inputClass}
              value={uniqid}
              onChange={(event) => setUniqid(event.target.value)}
              placeholder="XXX-XXXXX-XXX"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} type="button" onClick={() => lookup()} disabled={loading}>
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

          {message ? <div className="border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">{message}</div> : null}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="border border-slate-700 bg-slate-950/60 p-4">
            <p className={labelClass}>Shown</p>
            <p className="mt-2 text-sm text-slate-300">Status, details, payload.</p>
          </div>
          <div className="border border-slate-700 bg-slate-950/60 p-4">
            <p className={labelClass}>Created</p>
            <p className="mt-2 text-sm text-slate-300">
              {result?.createdAt ? formatTime(result.createdAt) : result?.created_at ? formatTime(result.created_at) : "-"}
            </p>
          </div>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <p className={labelClass}>Order payload</p>
        <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-100">Summary and payload</h3>

        {result ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {summary.map((item) => (
                <div key={item.label} className="border border-slate-700 bg-slate-950/60 p-4">
                  <span className={labelClass}>{item.label}</span>
                  <strong className="mt-2 block text-lg font-semibold text-slate-100">{item.value}</strong>
                </div>
              ))}
            </div>

            <div className="border border-slate-700 bg-slate-950/60 p-4">
              <strong className="block text-sm font-semibold text-slate-100">{result.uniqid}</strong>
              <p className="mt-2 text-sm leading-6 text-slate-400">{result.details ?? result.error ?? "No details."}</p>
            </div>

            <div className="overflow-auto border border-slate-700 bg-slate-950 p-4">
              <pre className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{formatJson(result)}</pre>
            </div>
          </div>
        ) : (
          <div className="mt-5 border border-slate-700 bg-slate-950/60 px-4 py-5 text-sm text-slate-400">
            Search an order to load summary and payload.
          </div>
        )}
      </div>
    </section>
  );
}
