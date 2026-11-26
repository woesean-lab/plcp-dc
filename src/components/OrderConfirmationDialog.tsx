import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, ExternalLink, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";

export function OrderConfirmationDialog({ service, amount, invite, description = "Creates the order and reserves its stock.", busy = false, onClose, onConfirm, children }: {
  service: string; amount: number; invite: string; description?: string; busy?: boolean;
  onClose: () => void; onConfirm: () => void; children?: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancel.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(<div className="confirm-modal-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div ref={root} className="confirm-modal order-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }
      if (event.key === "Tab") {
        const controls = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])];
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <span className="confirm-modal-icon is-success" aria-hidden="true"><Check className="h-5 w-5" /></span>
      <p className="app-kicker text-[var(--app-accent)]">Order confirmation</p>
      <h2 id={`${id}-title`}>Create this order?</h2>
      <p id={`${id}-description`}>{description}</p>
      <div className="order-confirm-summary">
        <div className="order-confirm-primary"><span className="order-confirm-service-icon" aria-hidden="true"><Bot className="h-4 w-4" /></span><span className="order-confirm-primary-copy"><small>Service</small><strong>{service}</strong></span><span className="order-confirm-amount"><small>Amount</small><strong>{amount}</strong></span></div>
        <div className="order-confirm-target"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /><span><small>Discord invite</small><strong>{invite}</strong></span></div>
        {children}
      </div>
      <div className="confirm-modal-actions"><Button ref={cancel} type="button" variant="secondary" disabled={busy} onClick={onClose}>Go back</Button><Button type="button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}{busy ? "Creating..." : "Confirm order"}</Button></div>
    </div>
  </div>, document.body);
}
