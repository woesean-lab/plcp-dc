import { useId, type FormEvent } from "react";
import { ExternalLink, LoaderCircle, MessageSquareText } from "lucide-react";
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
  const progress = limit > 0 ? Math.min(100, Math.round((completed / limit) * 100)) : 0;
  const status = failed > 0 ? `${failed} failed` : completed === limit ? "Complete" : latestMessageLink ? "Active" : "Ready";
  const statusState = failed > 0 ? "warning" : completed === limit ? "complete" : "active";

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!saving && messageDraft.trim() && remaining > 0) onSubmit();
  }

  return (
    <section className={`monitor-reaction-panel ${className}`.trim()} aria-labelledby={titleId}>
      <div className="monitor-reaction-heading">
        <span className="monitor-reaction-icon" aria-hidden="true"><MessageSquareText /></span>
        <div>
          <h2 id={titleId}>Message reactions</h2>
          <p>{remaining > 0 ? `${remaining} reactions available` : "Reaction allowance fully assigned"}</p>
        </div>
        <span className="monitor-reaction-status" data-state={statusState}>{status}</span>
      </div>

      <div className="monitor-reaction-summary">
        <span><small>Limit</small><strong>{limit}</strong></span>
        <span><small>Reacted</small><strong>{completed}</strong></span>
        <span><small>Remaining</small><strong>{remaining}</strong></span>
        <div className="monitor-reaction-progress" aria-label={`${completed} of ${limit} reactions completed`}>
          <span className="monitor-reaction-progress-track"><i style={{ width: `${progress}%` }} /></span>
          <strong>{progress}%</strong>
        </div>
      </div>

      {remaining > 0 ? (
        <form className="monitor-reaction-form" onSubmit={handleSubmit}>
          <Input type="url" value={messageDraft} onChange={(event) => onMessageChange(event.target.value)} placeholder="Discord message URL" aria-label="Discord message link" />
          <Input className="monitor-reaction-count" type="number" min={1} max={remaining} value={Math.min(countDraft, remaining)} onChange={(event) => onCountChange(Math.min(remaining, Math.max(1, Number.parseInt(event.target.value, 10) || 1)))} aria-label="Reaction amount" />
          <Button type="submit" size="sm" disabled={saving || !messageDraft.trim()}>
            {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />}
            {saving ? "Sending..." : "Send"}
          </Button>
        </form>
      ) : null}

      {requests.length ? (
        <details className="monitor-reaction-history">
          <summary><span>Request history</span><small>{requests.length}</small></summary>
          <div>
            {[...requests].reverse().map((request) => (
              <a key={request.id} href={request.messageLink} target="_blank" rel="noreferrer">
                <span><MessageSquareText aria-hidden="true" /><strong>{request.requestedCount} reactions</strong></span>
                <small>{request.completedCount}/{request.assignedCount} completed · {formatReactionDate(request.createdAt)}</small>
                <ExternalLink aria-hidden="true" />
              </a>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
