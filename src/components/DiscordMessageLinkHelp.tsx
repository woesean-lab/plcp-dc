import { useId, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, X } from "lucide-react";

export function DiscordMessageLinkHelp() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <>
      <button
        className="monitor-reaction-url-help"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="How to copy a Discord message URL"
        title="How to copy a Discord message URL"
      >
        <CircleHelp aria-hidden="true" />
      </button>

      {open && typeof document !== "undefined" ? createPortal((
        <div className="reaction-help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="reaction-help-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <header>
              <div><span>Discord message URL</span><h2 id={titleId}>Copy the message link</h2></div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"><X aria-hidden="true" /></button>
            </header>
            <div className="reaction-help-visual" data-loaded={imageLoaded || undefined}>
              {!imageLoaded ? <div className="app-skeleton reaction-help-image-skeleton" aria-hidden="true" /> : null}
              <img
                src="/discord-copy-message-link-guide.png"
                alt="Discord message menu with step 1 pointing to the three-dot menu and step 2 pointing to Copy Message Link"
                onLoad={() => setImageLoaded(true)}
              />
            </div>
            <div className="reaction-help-steps">
              <span><b>1</b><small>Click the three-dot menu on the message.</small></span>
              <span><b>2</b><small>Select Copy Message Link.</small></span>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </>
  );
}
