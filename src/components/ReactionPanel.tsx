import { useId, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronDown, Clock3, ExternalLink, LoaderCircle, LockKeyhole, MessageSquareText, Send, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ReactionPanelRequest = {
  id: string;
  messageLink: string;
  requestedCount: number;
  emojiCount?: number;
  assignedCount: number;
  completedCount: number;
  failedCount?: number;
  failureMessages?: string[];
  createdAt: string;
};

type ReactionPanelProps = {
  className?: string;
  limit: number;
  completed: number;
  failed: number;
  remaining: number;
  messageDraft: string;
  countDraft: number;
  emojiCountDraft: number;
  saving: boolean;
  requestEnabled?: boolean;
  requests: ReactionPanelRequest[];
  onMessageChange: (value: string) => void;
  onCountChange: (value: number) => void;
  onEmojiCountChange: (value: number) => void;
  onSubmit: () => void;
  onEditLimit?: () => void;
  limitActionLabel?: string;
};

function formatReactionDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

export function ReactionPanel({
  className = "",
  limit,
  completed,
  failed,
  remaining,
  messageDraft,
  countDraft,
  emojiCountDraft,
  saving,
  requestEnabled = true,
  requests,
  onMessageChange,
  onCountChange,
  onEmojiCountChange,
  onSubmit,
  onEditLimit,
  limitActionLabel = "+ Add reaction limit"
}: ReactionPanelProps) {
  const titleId = useId();
  const [failureRequest, setFailureRequest] = useState<ReactionPanelRequest | null>(null);
  const assigned = Math.max(0, limit - remaining);
  const pending = Math.max(0, assigned - completed);
  const progress = limit > 0 ? Math.min(100, Math.round((completed / limit) * 100)) : 0;
  const statusState = failed > 0 ? "warning" : completed >= limit && limit > 0 ? "complete" : assigned > 0 ? "active" : "ready";
  const progressStyle = { "--reaction-progress": `${progress * 3.6}deg` } as CSSProperties;
  const isValidMessageUrl = /^https:\/\/discord\.com\/channels\/.+/.test(messageDraft.trim());

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (requestEnabled && !saving && isValidMessageUrl && remaining > 0) onSubmit();
  }

  return (
    <section className={`monitor-reaction-panel ${className}`.trim()} data-state={statusState} aria-labelledby={titleId}>
      <div className="monitor-reaction-heading">
        <div className="monitor-reaction-identity">
          <span className="monitor-reaction-icon" aria-hidden="true"><Sparkles /></span>
          <div>
            <span className="monitor-reaction-kicker">Reaction delivery</span>
            <h2 id={titleId}>Message reactions</h2>
            <p>Send real account reactions to a Discord message.</p>
          </div>
        </div>

        <div className="monitor-reaction-heading-actions">
          {onEditLimit ? (
            <button className="monitor-reaction-message-link" type="button" onClick={onEditLimit}>
              <MessageSquareText aria-hidden="true" /> {limitActionLabel}
            </button>
          ) : null}
        </div>
      </div>

      <div className="monitor-reaction-dashboard">
        <div className="monitor-reaction-overview">
          <div className="monitor-reaction-progress-ring" style={progressStyle} aria-label={`${completed} of ${limit} reactions completed`}>
            <span><strong>{progress}%</strong><small>complete</small></span>
          </div>

          <div className="monitor-reaction-overview-copy">
            <span className="monitor-reaction-overline">Delivery progress</span>
            <strong>{completed} of {limit} reactions delivered</strong>
            <p>{remaining > 0 ? `${remaining} reactions are still available for new requests.` : "The full reaction allowance has been assigned."}</p>
            <span className="monitor-reaction-progress-track"><i style={{ width: `${progress}%` }} /></span>
          </div>
        </div>

        <div className="monitor-reaction-metrics" aria-label="Reaction delivery summary">
          <div data-tone="success">
            <span><CheckCircle2 aria-hidden="true" /> Delivered</span>
            <strong>{completed}</strong>
            <small>successful reactions</small>
          </div>
          <div data-tone="pending">
            <span><Clock3 aria-hidden="true" /> In queue</span>
            <strong>{pending}</strong>
            <small>assigned and pending</small>
          </div>
          <div data-tone="available">
            <span><Sparkles aria-hidden="true" /> Available</span>
            <strong>{remaining}</strong>
            <small>ready to assign</small>
          </div>
        </div>
      </div>

      {remaining > 0 ? (
        <form className="monitor-reaction-form" data-locked={!requestEnabled || undefined} onSubmit={handleSubmit}>
          <div className="monitor-reaction-form-copy">
            <span className="monitor-reaction-form-icon" aria-hidden="true"><MessageSquareText /></span>
            <div><strong>Create reaction request</strong><small>Paste a Discord message link and choose the amount.</small></div>
          </div>
          <label className="boost-order-field monitor-reaction-field monitor-reaction-url-field">
            <span className="boost-order-label">Discord Message URL</span>
            <input
              className="boost-number-input"
              type="url"
              value={messageDraft}
              onChange={(event) => onMessageChange(event.target.value)}
              placeholder="https://discord.com/channels/..."
              pattern="https://discord[.]com/channels/.+"
              title="Link must start with https://discord.com/channels/"
              aria-label="Discord message URL"
              disabled={!requestEnabled}
              required
            />
          </label>
          <label className="boost-order-field monitor-reaction-field">
            <span className="boost-order-label">Amount</span>
            <input
              className="boost-number-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={remaining}
              value={Math.min(countDraft, remaining)}
              aria-label="Reaction amount"
              disabled={!requestEnabled}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                onCountChange(Number.isFinite(next) ? Math.min(remaining, Math.max(1, next)) : 1);
              }}
            />
          </label>
          <label className="boost-order-field monitor-reaction-field">
            <span className="boost-order-label">Emoji count</span>
            <input
              className="boost-number-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={Math.min(20, countDraft)}
              value={Math.min(emojiCountDraft, countDraft, 20)}
              aria-label="Distinct emoji count"
              disabled={!requestEnabled}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                onEmojiCountChange(Number.isFinite(next) ? Math.min(20, countDraft, Math.max(1, next)) : 1);
              }}
            />
          </label>
          <Button className="monitor-reaction-submit" type="submit" disabled={!requestEnabled || saving || !messageDraft.trim()}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {saving ? "Queuing..." : "Queue reactions"}
          </Button>
          {!requestEnabled ? (
            <div className="monitor-reaction-form-lock" role="status">
              <span aria-hidden="true"><LockKeyhole /></span>
              <div>
                <strong>Reaction requests are locked</strong>
                <small>The order isn’t complete yet. You can use reactions when delivery is Partial or Completed.</small>
              </div>
            </div>
          ) : null}
        </form>
      ) : (
        <div className="monitor-reaction-allowance-complete">
          <CheckCircle2 aria-hidden="true" />
          <span><strong>Reaction allowance assigned</strong><small>All available reactions are already connected to requests.</small></span>
        </div>
      )}

      {requests.length ? (
        <details className="monitor-reaction-history">
          <summary>
            <span><Clock3 aria-hidden="true" /><strong>Request history</strong><small>{requests.length} total</small></span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div>
            {[...requests].reverse().map((request, index) => {
              const requestProgress = request.assignedCount > 0 ? Math.min(100, Math.round((request.completedCount / request.assignedCount) * 100)) : 0;
              return (
                <div key={request.id} className="monitor-reaction-history-row">
                  <span className="monitor-reaction-history-index">{String(requests.length - index).padStart(2, "0")}</span>
                  <span className="monitor-reaction-history-copy">
                    <strong>{request.requestedCount} reactions{request.emojiCount ? ` · ${request.emojiCount} emoji` : ""}</strong>
                    <small>{formatReactionDate(request.createdAt)}</small>
                  </span>
                  <span className="monitor-reaction-history-progress">
                    <span><i style={{ width: `${requestProgress}%` }} /></span>
                    <small>{request.completedCount}/{request.assignedCount}</small>
                  </span>
                  {(request.failedCount ?? 0) > 0 && request.failureMessages?.length ? (
                    <button className="monitor-reaction-history-failure-button" type="button" onClick={() => setFailureRequest(request)} aria-label={`Show ${request.failedCount} failed reaction details`} title={`${request.failedCount} failed`}>
                      <TriangleAlert aria-hidden="true" />
                    </button>
                  ) : <span className="monitor-reaction-history-failure-placeholder" />}
                  <a className="monitor-reaction-history-link" href={request.messageLink} target="_blank" rel="noreferrer" aria-label="Open Discord message">
                    <ExternalLink aria-hidden="true" />
                  </a>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      {failureRequest && typeof document !== "undefined" ? createPortal((
        <div className="reaction-failure-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setFailureRequest(null); }}>
          <div className="reaction-failure-dialog" role="dialog" aria-modal="true" aria-labelledby={`${titleId}-failure-title`}>
            <header>
              <span className="reaction-failure-dialog-icon" aria-hidden="true"><TriangleAlert /></span>
              <div>
                <h2 id={`${titleId}-failure-title`}>Failure details</h2>
                <p>{failureRequest.failedCount} reaction{failureRequest.failedCount === 1 ? "" : "s"} failed</p>
              </div>
            </header>
            <div className="reaction-failure-dialog-list">
              {failureRequest.failureMessages?.map((message, index) => (
                <div key={`${message}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{message}</p></div>
              ))}
            </div>
          </div>
        </div>
      ), document.body) : null}
    </section>
  );
}
