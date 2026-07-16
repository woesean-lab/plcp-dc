import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getOrderStatus } from "../lib/tokenu";
import type { OrderStatusResponse } from "../types";

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
  const [message, setMessage] = useState("Enter an order ID to inspect status.");

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
      setMessage(`Loaded order ${target}.`);
      setParams({ uniqid: target });
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Order could not be found.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="lookup-shell">
      <div className="panel lookup-hero">
        <span className="eyebrow">Public tracker</span>
        <h2>Siparis sorgulama</h2>
        <p className="intro-copy">
          Bu sayfa admin key gerektirmez. Order ID girip status, details ve raw payload bilgisini
          gorebilirsin.
        </p>

        <div className="intro-actions" style={{ marginTop: 18 }}>
          <button className="primary-button" type="button" onClick={() => lookup()} disabled={loading}>
            {loading ? "Loading..." : "Check status"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setUniqid("");
              setResult(null);
              setMessage("Enter an order ID to inspect status.");
              setParams({});
            }}
          >
            Clear
          </button>
        </div>

        <div className="detail-grid" style={{ marginTop: 20 }}>
          <label className="field span-2">
            <span>Order ID</span>
            <input value={uniqid} onChange={(event) => setUniqid(event.target.value)} placeholder="XXX-XXXXX-XXX" />
          </label>
        </div>

        {message ? <div className="notice" style={{ marginTop: 16 }}>{message}</div> : null}

        <div className="mini-stack" style={{ marginTop: 18 }}>
          <div className="mini-card">
            <h3 className="title">What users see</h3>
            <p>Order status, progress, and the raw API payload if support needs to inspect it.</p>
          </div>
          <div className="mini-card">
            <h3 className="title">Created at</h3>
            <p>{result?.createdAt ? formatTime(result.createdAt) : result?.created_at ? formatTime(result.created_at) : "-"}</p>
          </div>
        </div>
      </div>

      <div className="panel section lookup-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Order payload</span>
            <h3 className="section-title">Status summary and API response.</h3>
            <p>The UI highlights the important bits first, then keeps the full object below.</p>
          </div>
        </div>

        {result ? (
          <>
            <div className="summary-row" style={{ marginTop: 0 }}>
              {summary.map((item) => (
                <div key={item.label} className="summary-card">
                  <span className="label">{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            <div className="info-box">
              <strong style={{ display: "block", marginBottom: 8 }}>{result.uniqid}</strong>
              <div className="muted">{result.details ?? result.error ?? "No additional details returned."}</div>
            </div>

            <div className="json-box">
              <pre>{formatJson(result)}</pre>
            </div>
          </>
        ) : (
          <div className="empty-state">Search an order to populate the summary and raw payload here.</div>
        )}
      </div>
    </section>
  );
}
