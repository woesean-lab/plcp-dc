import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "./ui/button";

export function RotatingStockRemoveDialog({ count, accountLabel, onConfirm, onClose }: {
  count: number;
  accountLabel?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.current?.showModal();
    cancel.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  function close() { if (!lock.current) dialog.current?.close(); }
  async function submit() {
    if (lock.current || !count) return;
    lock.current = true; setBusy(true); setError("");
    try { await onConfirm(); dialog.current?.close(); }
    catch (error) { setError(error instanceof Error ? error.message : "Accounts could not be removed."); }
    finally { lock.current = false; setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className="confirm-modal fixed inset-0 m-auto max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] overflow-y-auto text-[var(--app-text)] backdrop:bg-[var(--app-overlay-bg)] backdrop:backdrop-blur-md"
    aria-labelledby={id + "-title"} aria-describedby={id + "-description"} aria-busy={busy} onClose={onClose}
    onCancel={event => { if (lock.current) event.preventDefault(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
    <span className="confirm-modal-icon" aria-hidden="true"><Trash2 className="h-5 w-5" /></span>
    <p className="app-kicker text-[var(--app-danger)]">Rotating stock</p>
    <h2 id={id + "-title"}>{count === 1 ? "Remove account?" : `Remove ${count} accounts?`}</h2>
    <p id={id + "-description"}>{count === 1 && accountLabel ? <><strong>{accountLabel}</strong> will be removed from stock. </> : "Selected accounts will be removed from stock. "}Order history will be kept.</p>
    {error ? <p role="alert" className="text-sm text-[var(--app-danger)]">{error}</p> : null}
    <div className="confirm-modal-actions flex-wrap">
      <Button ref={cancel} type="button" variant="secondary" disabled={busy} onClick={close}>Cancel</Button>
      <Button type="button" variant="destructive" disabled={busy || !count} onClick={() => void submit()}>
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        {busy ? "Removing…" : count === 1 ? "Remove account" : `Remove ${count} accounts`}
      </Button>
    </div>
  </dialog>, document.body);
}
