import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getOrderStatus } from "../lib/tokenu";
import type { OrderStatusResponse } from "../types";

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function OrderPage() {
  const [params, setParams] = useSearchParams();
  const [uniqid, setUniqid] = useState(params.get("uniqid") ?? "");
  const [result, setResult] = useState<OrderStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Enter your order ID to inspect status.");

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
    <section className="panel section">
      <span className="eyebrow">Public tracker</span>
      <h2 className="section-title">Siparis sorgulama</h2>
      <p className="muted">
        Public users can open this page with just an order ID. No admin key is required here.
      </p>

      <div className="form-grid" style={{ marginTop: 18 }}>
        <label className="field span-2">
          <span>Order ID</span>
          <input
            value={uniqid}
            onChange={(event) => setUniqid(event.target.value)}
            placeholder="XXX-XXXXX-XXX"
          />
        </label>
      </div>

      <div className="inline-actions" style={{ marginTop: 16 }}>
        <button className="primary-button" type="button" onClick={() => lookup()} disabled={loading}>
          {loading ? "Loading..." : "Check status"}
        </button>
        <button
          className="ghost-button"
          type="button"
          onClick={() => {
            setUniqid("");
            setResult(null);
            setMessage("Enter your order ID to inspect status.");
            setParams({});
          }}
        >
          Clear
        </button>
      </div>

      {message ? <div className="notice" style={{ marginTop: 16 }}>{message}</div> : null}

      {result ? (
        <div style={{ marginTop: 18 }}>
          <div className="inline-actions" style={{ marginBottom: 12 }}>
            <span className="mini-badge">{result.status ?? "UNKNOWN"}</span>
            {typeof result.added === "number" ? <span className="mini-badge">Added {result.added}</span> : null}
            {typeof result.amount === "number" ? <span className="mini-badge">Amount {result.amount}</span> : null}
          </div>
          <div className="json-box">
            <pre>{formatJson(result)}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
