import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Power, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { getOrderStatus, updateCommunityOrderReactionLimit } from "../lib/integration";
import { CUSTOMER_REACTION_LIMITS } from "../../shared/reaction-limits.mjs";
import type { OrderStatusResponse } from "../types";

export function OrderReactionSettingsDialog({ uniqid, onClose, onSaved }: {
  uniqid: string; onClose: () => void; onSaved: (order: OrderStatusResponse) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [order, setOrder] = useState<OrderStatusResponse | null>(null);
  const [limit, setLimit] = useState("50");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let active = true;
    void getOrderStatus(uniqid, "community").then((data) => {
      if (!active) return;
      setOrder(data); setLimit(String(data.customerReactions?.dailyLimit || 50));
    }).catch((error) => { if (active) setError(error instanceof Error ? error.message : "Could not load reaction settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; document.body.style.overflow = overflow; };
  }, [uniqid]);
  const summary = order?.customerReactions;
  const enabled = Boolean(summary && summary.dailyLimit > 0 && !summary.disabled);
  const minimum = Math.max(1, summary?.dailyLimit || 1);
  const amount = Number(limit);
  async function save(event: FormEvent) {
    event.preventDefault();
    await saveSettings(false);
  }
  async function saveSettings(disable: boolean) {
    if (inFlight.current || !summary || (!disable && (!summary.canConfigure || !Number.isSafeInteger(amount) || amount < minimum))) return;
    inFlight.current = true; setSaving(true); setDisabling(disable); setError("");
    try {
      const updated = await updateCommunityOrderReactionLimit(uniqid, disable ? summary.dailyLimit : amount, { customerAllowance: true, enabled: !disable });
      if (!updated.customerReactions || updated.customerReactions.disabled !== disable || (!disable && updated.customerReactions.dailyLimit !== amount)) {
        throw new Error("Reaction settings were not saved. Refresh the order and try again.");
      }
      onSaved(updated); toast.success(disable ? "Customer reactions disabled." : enabled ? "Daily reaction limit updated." : "Customer reactions enabled."); dialogRef.current?.close();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save reaction settings."); }
    finally { inFlight.current = false; setSaving(false); setDisabling(false); }
  }
  return <dialog ref={dialogRef} className="confirm-modal fixed inset-0 m-auto max-h-[calc(100dvh-32px)] overflow-y-auto text-[var(--app-text)] backdrop:bg-[var(--app-overlay-bg)] backdrop:backdrop-blur-md"
    onClose={onClose} onCancel={(event) => { if (inFlight.current) event.preventDefault(); }} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <form onSubmit={(event) => void save(event)}>
      <span className="confirm-modal-icon" aria-hidden="true"><Sparkles className="h-5 w-5" /></span>
      <p className="app-kicker">Order reactions</p><h2 id={`${id}-title`}>{enabled ? "Manage daily reactions" : "Enable customer reactions"}</h2>
      <p id={`${id}-description`}>Available on the customer monitor during the support period.</p>
      {loading ? <div className="my-5 flex items-center gap-2 text-sm text-[var(--app-muted)]" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />Loading settings…</div> : <div className="mt-5 grid gap-3">
        {summary?.canConfigure ? <>
          <label className="grid gap-2"><span className="field-label">Daily limit</span><Input type="number" inputMode="numeric" min={minimum} step={1} required disabled={saving} value={limit} onChange={(event) => setLimit(event.target.value)} /></label>
          <div className="stock-duration-filter flex-wrap" role="group" aria-label="Daily reaction presets">{[...CUSTOMER_REACTION_LIMITS, 1000].map((value) => <button type="button" key={value} disabled={saving || value < minimum} className={`${amount === value ? "is-active" : ""} disabled:pointer-events-none disabled:opacity-45`} aria-pressed={amount === value} onClick={() => setLimit(String(value))}>{value}</button>)}</div>
          <div className="app-panel-soft p-3 text-xs leading-6">
            <strong>{summary.dailyLimit > 0 ? `Today: ${summary.todayLimit} limit · ${summary.used} used · ${Math.max(0, summary.todayLimit - summary.used)} available when enabled` : `First day: ${Number(order?.amount) || amount} reactions`}</strong>
            <p className="text-[var(--app-muted)]">{summary.dailyLimit > 0 ? "Changes keep previous usage and the original first day." : "From the next day, the selected daily limit applies."} Resets daily at 00:00.</p>
          </div>
        </> : <p className="text-sm text-[var(--app-muted)]">Reactions require an enabled category and active support.</p>}
        {enabled ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3"><p className="max-w-[240px] text-xs leading-5 text-[var(--app-muted)]">Turn off customer reactions. History and limits are kept.</p><Button type="button" variant="dangerGhost" size="sm" disabled={saving} onClick={() => void saveSettings(true)}>{disabling ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}{disabling ? "Disabling…" : "Disable reactions"}</Button></div> : null}
        {error ? <p className="text-xs text-[var(--app-danger)]" role="alert">{error}</p> : null}
      </div>}
      <div className="confirm-modal-actions"><Button type="button" variant="secondary" disabled={saving} onClick={() => dialogRef.current?.close()}>Cancel</Button><Button type="submit" disabled={loading || saving || !summary?.canConfigure || !Number.isSafeInteger(amount) || amount < minimum}>{saving && !disabling ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{saving && !disabling ? "Saving…" : enabled ? "Save limit" : "Enable reactions"}</Button></div>
    </form>
  </dialog>;
}
