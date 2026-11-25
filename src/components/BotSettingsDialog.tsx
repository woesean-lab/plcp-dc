import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "./ui/button";

export function BotSettingsDialog({ title, busy = false, onClose, children }: {
  title: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="confirm-modal bot-settings-dialog" aria-labelledby={id}
    onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}
    onClick={event => {
      if (busy || event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close();
    }}>
    <header className="settings-card-heading"><div className="settings-card-title"><h3 id={id}>{title}</h3></div><span className="community-member-row-actions"><Button type="button" size="icon-sm" variant="ghost" aria-label="Close dialog" disabled={busy} onClick={() => dialog.current?.close()}><X className="h-3.5 w-3.5" /></Button></span></header>
    {children}
  </dialog>, document.body);
}
