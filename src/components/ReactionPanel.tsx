import { useId, type CSSProperties, type FormEvent } from "react";
import { CheckCircle2, ChevronDown, Clock3, ExternalLink, Link2, LoaderCircle, MessageSquareText, Minus, Plus, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ReactionPanelRequest = {
  id: string;
  messageLink: string;
  requestedCount: number;
  assignedCount: number;
  completedCount: number;
  createdAt: string;
};

type ReactionPanelProps = {
  className?: string;
  limit: number;
  completed: number;
  failed: number;
  remaining: number;
  latestMessageLink?: string;
  messageDraft: string;
  countDraft: number;
  saving: boolean;
  requests: ReactionPanelRequest[];
  onMessageChange: (value: string) => void;
  onCountChange: (value: number) => void;
  onSubmit: () => void;
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
  latestMessageLink,
  messageDraft,
  countDraft,
  saving,
  requests,
  onMessageChange,
  onCountChange,
  onSubmit
}: ReactionPanelProps) {
  const titleId = useId();
  const assigned = Math.max(0, limit - remaining);
  const pending = Math.max(0, assigned - completed - failed);
  const progress = limit > 0 ? Math.min(100, Math.round((completed / limit) * 100)) : 0;
  const status = failed > 0 ? `${failed} failed` : completed >= limit && limit > 0 ? "Complete" : assigned > 0 ? "In progress" : "Ready";
  const statusState = failed > 0 ? "warning" : completed >= limit && limit > 0 ? "complete" : assigned > 0 ? "active" : "ready";
  const progressStyle = { "--reaction-progress": `${progress * 3.6}deg` } as CSSProperties;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!saving && messageDraft.trim() && remaining > 0) onSubmit();
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
          {latestMessageLink ? (
            <a className="monitor-reaction-message-link" href={latestMessageLink} target="_blank" rel="noreferrer">
              <Link2 aria-hidden="true" /> Latest message <ExternalLink aria-hidden="true" />
            </a>
          ) : null}
          <span className="monitor-reaction-status" data-state={statusState}>
            <i aria-hidden="true" /> {status}
          </span>
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
        <form className="monitor-reaction-form" onSubmit={handleSubmit}>
          <div className="monitor-reaction-form-copy">
            <span className="monitor-reaction-form-icon" aria-hidden="true"><MessageSquareText /></span>
            <div><strong>Create reaction request</strong><small>Paste a Discord message link and choose the amount.</small></div>
          </div>
          <label className="monitor-reaction-field monitor-reaction-url-field">
            <span>Message URL</span>
            <span className="monitor-reaction-input-shell"><Link2 aria-hidden="true" /><Input type="url" value={messageDraft} onChange={(event) => onMessageChange(event.target.value)} placeholder="https://discord.com/channels/..." aria-label="Discord message link" /></span>
          </label>
          <label className="monitor-reaction-field">
            <span>Amount</span>
            <span className="boost-amount-control monitor-reaction-amount-control">
              <button type="button" aria-label="Decrease reaction amount" disabled={countDraft <= 1} onClick={() => onCountChange(Math.max(1, countDraft - 1))}>
                <Minus aria-hidden="true" />
              </button>
              <span className="boost-amount-value" aria-live="polite">{Math.min(countDraft, remaining)}</span>
              <button type="button" aria-label="Increase reaction amount" disabled={countDraft >= remaining} onClick={() => onCountChange(Math.min(remaining, countDraft + 1))}>
                <Plus aria-hidden="true" />
              </button>
            </span>
          </label>
          <Button type="submit" disabled={saving || !messageDraft.trim()}>
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {saving ? "Queuing..." : "Queue reactions"}
          </Button>
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
                <a key={request.id} href={request.messageLink} target="_blank" rel="noreferrer">
                  <span className="monitor-reaction-history-index">{String(requests.length - index).padStart(2, "0")}</span>
                  <span className="monitor-reaction-history-copy">
                    <strong>{request.requestedCount} reactions requested</strong>
                    <small>{formatReactionDate(request.createdAt)}</small>
                  </span>
                  <span className="monitor-reaction-history-progress">
                    <span><i style={{ width: `${requestProgress}%` }} /></span>
                    <small>{request.completedCount}/{request.assignedCount}</small>
                  </span>
                  <ExternalLink aria-hidden="true" />
                </a>
              );
            })}
          </div>
        </details>
      ) : null}
    </section>
  );
}
