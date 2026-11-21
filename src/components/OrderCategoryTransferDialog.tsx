import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, LoaderCircle } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { FilterDropdown } from "./ui/filter-dropdown";
import { transferCommunityOrderCategory, type CommunityOrderCategoryTransfer, type CommunityStockCategory } from "../lib/community";

export default function OrderCategoryTransferDialog({ source, categories, onClose, onMoved }: {
  source: CommunityStockCategory;
  categories: CommunityStockCategory[];
  onClose: () => void;
  onMoved: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<CommunityOrderCategoryTransfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);

  async function submit() {
    if (busy || !target) return;
    setBusy(true); setError("");
    try {
      const result = await transferCommunityOrderCategory(source.id, target, preview?.previewToken);
      if (!preview) setPreview(result);
      else {
        toast.success(`${result.moved} orders moved to ${result.targetName}.${result.blockedCount ? ` ${result.blockedCount} orders were left unchanged.` : ""}`);
        await onMoved().catch(() => toast.error("Orders moved. Refresh the page to load the updated list."));
        dialogRef.current?.close();
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Orders could not be moved."); setPreview(null); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialogRef} className="confirm-modal fixed inset-0 m-auto max-h-[calc(100dvh-32px)] overflow-y-auto text-[var(--app-text)] backdrop:bg-[var(--app-overlay-bg)] backdrop:backdrop-blur-md" onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault(); }} aria-labelledby="move-category-orders-title" aria-describedby="move-category-orders-description">
    <span className="confirm-modal-icon" aria-hidden="true"><ArrowRightLeft className="h-5 w-5" /></span>
    <p className="app-kicker">Move existing orders</p><h2 id="move-category-orders-title">Move {source.name} orders</h2>
    <p id="move-category-orders-description">Changes the replacement category. Order history and support stay unchanged.</p>
    <div className="mt-5 grid gap-3"><FilterDropdown label="Destination category" placement="top" disabled={busy} value={target} onChange={(value) => { setTarget(value); setPreview(null); setError(""); }} options={[{ value: "", label: "Choose destination" }, ...categories.filter((category) => category.id !== source.id).map((category) => ({ value: category.id, label: category.name }))]} />
      {preview ? <div className="app-panel-soft p-3 text-xs leading-6"><strong>{preview.transferable} orders will move to {preview.targetName}.</strong>{preview.blockedCount > 0 ? <><p className="text-[var(--app-muted)]">{preview.blockedCount} orders will stay unchanged:</p><ul className="grid gap-2">{preview.blocked.map((order) => <li key={order.uniqid}><code>{order.uniqid}</code><p className="text-[var(--app-muted)]">{order.reason}</p></li>)}</ul></> : null}{!preview.matched ? <p className="text-[var(--app-muted)]">This category has no orders to move.</p> : null}</div> : null}
      {error ? <p role="alert" className="text-xs leading-5 text-[var(--app-danger)]">{error}</p> : null}
    </div>
    <div className="confirm-modal-actions"><Button type="button" variant="secondary" disabled={busy} onClick={() => dialogRef.current?.close()}>Cancel</Button><Button type="button" disabled={busy || !target || Boolean(preview && !preview.transferable)} onClick={() => void submit()}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}{busy ? "Please wait…" : preview ? `Move ${preview.transferable} orders` : "Preview transfer"}</Button></div>
  </dialog>;
}
