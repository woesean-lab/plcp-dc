import { lazy, Suspense, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { Categories, CategoryConfig, EmojiClickData, EmojiStyle, Theme } from "emoji-picker-react";
import { CheckCircle2, ChevronDown, CircleHelp, Clock3, ExternalLink, Flame, LoaderCircle, LockKeyhole, MessageSquareText, Pause, RefreshCw, Send, ShoppingCart, Sparkles, TriangleAlert, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export const REACTION_MIXED_VALUE = "mixed";
export const REACTION_POPULAR_VALUE = "popular";
const REACTION_EMOJI_SELECTION_LIMIT = 20;
const DISCORD_POPULAR_EMOJIS = ["👍", "❤️", "😂", "🔥", "🎉", "💯", "✅", "👀", "😭", "🤣", "😍", "🙏", "💀", "🥰", "😎", "🤔", "👎", "😢", "🚀", "🤝"];
const EMOJI_PICKER_CATEGORIES: CategoryConfig[] = [
  { category: "smileys_people" as Categories, name: "Smileys & People" },
  { category: "animals_nature" as Categories, name: "Animals & Nature" },
  { category: "food_drink" as Categories, name: "Food & Drink" },
  { category: "travel_places" as Categories, name: "Travel & Places" },
  { category: "activities" as Categories, name: "Activities" },
  { category: "objects" as Categories, name: "Objects" },
  { category: "symbols" as Categories, name: "Symbols" },
  { category: "flags" as Categories, name: "Flags" }
];
const EmojiPicker = lazy(() => import("emoji-picker-react"));

export type ReactionPanelRequest = {
  id: string;
  messageLink: string;
  requestedCount: number;
  emojiCount?: number;
  emojis?: string[];
  assignedCount: number;
  completedCount: number;
  failedCount?: number;
  cancelledCount?: number;
  failureMessages?: string[];
  autoStopReason?: string;
  createdAt: string;
};

type ReactionPanelProps = {
  className?: string;
  limit: number;
  completed: number;
  failed: number;
  remaining: number;
  eligibleMembers: number;
  onRefreshEligibleMembers?: () => void;
  refreshingEligibleMembers?: boolean;
  onCancelPending?: () => void;
  cancellingPending?: boolean;
  messageDraft: string;
  countDraft: number;
  selectedEmojis: string[];
  saving: boolean;
  requestEnabled?: boolean;
  requests: ReactionPanelRequest[];
  onMessageChange: (value: string) => void;
  onCountChange: (value: number) => void;
  onEmojiSelectionChange: (value: string[]) => void;
  onSubmit: () => void;
  onEditLimit?: () => void;
  limitActionLabel?: string;
  limitActionVariant?: "default" | "purchase";
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
  eligibleMembers,
  onRefreshEligibleMembers,
  refreshingEligibleMembers = false,
  onCancelPending,
  cancellingPending = false,
  messageDraft,
  countDraft,
  selectedEmojis,
  saving,
  requestEnabled = true,
  requests,
  onMessageChange,
  onCountChange,
  onEmojiSelectionChange,
  onSubmit,
  onEditLimit,
  limitActionLabel = "+ Add reaction limit",
  limitActionVariant = "default"
}: ReactionPanelProps) {
  const titleId = useId();
  const [failureRequest, setFailureRequest] = useState<ReactionPanelRequest | null>(null);
  const [messageLinkHelpOpen, setMessageLinkHelpOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiPickerMounted, setEmojiPickerMounted] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const assigned = Math.max(0, limit - remaining);
  const pending = Math.max(0, assigned - completed);
  const progress = limit > 0 ? Math.min(100, Math.round((completed / limit) * 100)) : 0;
  const statusState = failed > 0 ? "warning" : completed >= limit && limit > 0 ? "complete" : assigned > 0 ? "active" : "ready";
  const progressStyle = { "--reaction-progress": `${progress * 3.6}deg` } as CSSProperties;
  const isValidMessageUrl = /^https:\/\/discord\.com\/channels\/.+/.test(messageDraft.trim());

  useEffect(() => {
    if (!emojiPickerOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!emojiPickerRef.current?.contains(event.target as Node)) setEmojiPickerOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEmojiPickerOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [emojiPickerOpen]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (requestEnabled && !saving && isValidMessageUrl && remaining > 0 && selectedEmojis.length > 0) onSubmit();
  }

  function toggleEmoji(emoji: string) {
    const selected = selectedEmojis.includes(emoji);
    const explicitSelections = selectedEmojis.filter((value) => ![REACTION_MIXED_VALUE, REACTION_POPULAR_VALUE].includes(value));
    const selectionFull = !selected && explicitSelections.length >= Math.min(REACTION_EMOJI_SELECTION_LIMIT, countDraft);
    if (selectionFull) return;
    const next = selected
      ? explicitSelections.filter((value) => value !== emoji)
      : [...explicitSelections, emoji];
    onEmojiSelectionChange(next.length ? next : [REACTION_MIXED_VALUE]);
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
            <button className={`monitor-reaction-message-link${limitActionVariant === "purchase" ? " is-purchase" : ""}`} type="button" onClick={onEditLimit}>
              {limitActionVariant === "purchase" ? <ShoppingCart aria-hidden="true" /> : <MessageSquareText aria-hidden="true" />} {limitActionLabel}
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
          <div data-tone="members">
            <span><Users aria-hidden="true" /> Eligible
              {onRefreshEligibleMembers ? (
                <button className="monitor-reaction-metric-refresh" type="button" onClick={onRefreshEligibleMembers} disabled={refreshingEligibleMembers} aria-label="Refresh online members" title="Check members and refresh the online count">
                  <RefreshCw className={refreshingEligibleMembers ? "animate-spin" : ""} aria-hidden="true" />
                </button>
              ) : null}
            </span>
            <strong>{eligibleMembers}</strong>
            <small>{refreshingEligibleMembers ? "checking members" : "members can react"}</small>
          </div>
        </div>
      </div>

      {remaining > 0 ? (
        <form className="monitor-reaction-form" data-locked={!requestEnabled || undefined} onSubmit={handleSubmit}>
          <div className="monitor-reaction-form-copy">
            <span className="monitor-reaction-form-icon" aria-hidden="true"><MessageSquareText /></span>
            <div><strong>Create reaction request</strong><small>Paste a Discord message link and choose the amount.</small></div>
          </div>
          <div className="boost-order-field monitor-reaction-field monitor-reaction-url-field">
            <span className="boost-order-label monitor-reaction-url-label">
              <label htmlFor={`${titleId}-message-url`}>Discord Message URL</label>
              <button className="monitor-reaction-url-help" type="button" onClick={() => setMessageLinkHelpOpen(true)} aria-label="How to copy a Discord message URL" title="How to copy a Discord message URL">
                <CircleHelp aria-hidden="true" />
              </button>
            </span>
            <input
              id={`${titleId}-message-url`}
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
          </div>
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
                const nextCount = Number.isFinite(next) ? Math.min(remaining, Math.max(1, next)) : 1;
                onCountChange(nextCount);
                if (selectedEmojis.length > nextCount) onEmojiSelectionChange(selectedEmojis.slice(0, nextCount));
              }}
            />
          </label>
          <div className="boost-order-field monitor-reaction-field monitor-reaction-emoji-field">
            <span className="boost-order-label">Emojis</span>
            <div className="monitor-reaction-emoji-picker" data-open={emojiPickerOpen} ref={emojiPickerRef}>
              <button
                type="button"
                className="monitor-reaction-emoji-trigger"
                aria-expanded={emojiPickerOpen}
                aria-controls={`${titleId}-emoji-picker`}
                onClick={() => {
                  if (!emojiPickerOpen) setEmojiPickerMounted(true);
                  setEmojiPickerOpen((current) => !current);
                }}
              >
                <span>{selectedEmojis.includes(REACTION_POPULAR_VALUE) ? <><Flame aria-hidden="true" /> Popular</> : selectedEmojis.includes(REACTION_MIXED_VALUE) ? <><Sparkles aria-hidden="true" /> Mixed</> : <><span>{selectedEmojis.slice(0, 4).join(" ")}</span>{selectedEmojis.length > 4 ? ` +${selectedEmojis.length - 4}` : ""}</>}</span>
                <ChevronDown className="monitor-reaction-emoji-chevron" aria-hidden="true" />
              </button>
              <div id={`${titleId}-emoji-picker`} className="monitor-reaction-emoji-popover" aria-hidden={!emojiPickerOpen}>
                <div className="monitor-reaction-emoji-selection">
                  <button
                    type="button"
                    className={`monitor-reaction-popular-option${selectedEmojis.includes(REACTION_POPULAR_VALUE) ? " is-selected" : ""}`}
                    aria-pressed={selectedEmojis.includes(REACTION_POPULAR_VALUE)}
                    onClick={() => onEmojiSelectionChange([REACTION_POPULAR_VALUE])}
                  >
                    <Flame aria-hidden="true" />
                    <span>Popular</span>
                  </button>
                  <button
                    type="button"
                    className={`monitor-reaction-mixed-option${selectedEmojis.includes(REACTION_MIXED_VALUE) ? " is-selected" : ""}`}
                    aria-pressed={selectedEmojis.includes(REACTION_MIXED_VALUE)}
                    onClick={() => onEmojiSelectionChange([REACTION_MIXED_VALUE])}
                  >
                    <span className="monitor-reaction-mixed-preview" aria-hidden="true">👍 ❤️ 😂 🔥</span>
                    <span>Mixed</span>
                  </button>
                  {selectedEmojis.filter((emoji) => ![REACTION_MIXED_VALUE, REACTION_POPULAR_VALUE].includes(emoji)).map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="monitor-reaction-selected-emoji"
                      aria-label={`Remove ${emoji}`}
                      title={`Remove ${emoji}`}
                      onClick={() => toggleEmoji(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <div className="monitor-reaction-popular-emojis">
                  <span>Top emojis</span>
                  <div>
                    {DISCORD_POPULAR_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className={selectedEmojis.includes(emoji) ? "is-selected" : undefined}
                        aria-label={`Select ${emoji}`}
                        aria-pressed={selectedEmojis.includes(emoji)}
                        onClick={() => toggleEmoji(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
                {emojiPickerMounted ? <Suspense fallback={<div className="monitor-reaction-emoji-loading">Loading emojis...</div>}><EmojiPicker
                    theme={"dark" as Theme}
                    emojiStyle={"native" as EmojiStyle}
                    width="100%"
                    height={280}
                    lazyLoadEmojis
                    searchDisabled
                    categories={EMOJI_PICKER_CATEGORIES}
                    previewConfig={{ showPreview: false }}
                    onEmojiClick={({ emoji }: EmojiClickData) => toggleEmoji(emoji)}
                  /></Suspense> : null}
              </div>
            </div>
          </div>
          <Button className="monitor-reaction-submit" type="submit" disabled={!requestEnabled || saving || !messageDraft.trim() || !selectedEmojis.length}>
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
              const requestPending = Math.max(0, request.assignedCount - request.completedCount - (request.failedCount ?? 0) - (request.cancelledCount ?? 0));
              return (
                <div key={request.id} className="monitor-reaction-history-row">
                  <span className="monitor-reaction-history-index">{String(requests.length - index).padStart(2, "0")}</span>
                  <span className="monitor-reaction-history-copy">
                    <strong>{request.requestedCount} reactions{request.emojis?.includes(REACTION_POPULAR_VALUE) ? " · Popular" : request.emojis?.includes(REACTION_MIXED_VALUE) ? " · Mixed" : request.emojis?.length ? ` · ${request.emojis.join(" ")}` : request.emojiCount ? ` · ${request.emojiCount} emoji` : ""}</strong>
                    <small>{formatReactionDate(request.createdAt)}</small>
                    {request.autoStopReason ? <small className="monitor-reaction-history-stop">{request.autoStopReason}</small> : null}
                  </span>
                  <span className="monitor-reaction-history-progress">
                    <span><i style={{ width: `${requestProgress}%` }} /></span>
                    <small>{request.completedCount}/{request.assignedCount}{request.cancelledCount ? ` · ${request.cancelledCount} cancelled` : ""}</small>
                  </span>
                  {requestPending > 0 && onCancelPending ? (
                    <button className="monitor-reaction-history-cancel" type="button" onClick={onCancelPending} disabled={cancellingPending} aria-label={`Cancel ${requestPending} remaining reactions`} title={`Cancel remaining (${requestPending})`}>
                      {cancellingPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Pause aria-hidden="true" />}
                    </button>
                  ) : <span className="monitor-reaction-history-action-placeholder" />}
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
              <button className="reaction-failure-dialog-close" type="button" onClick={() => setFailureRequest(null)} aria-label="Close">
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="reaction-failure-dialog-list">
              {failureRequest.failureMessages?.map((message, index) => (
                <div key={`${message}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p>{message}</p></div>
              ))}
            </div>
          </div>
        </div>
      ), document.body) : null}

      {messageLinkHelpOpen && typeof document !== "undefined" ? createPortal((
        <div className="reaction-help-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setMessageLinkHelpOpen(false); }}>
          <div className="reaction-help-dialog" role="dialog" aria-modal="true" aria-labelledby={`${titleId}-message-link-help-title`}>
            <header>
              <div><span>Discord message URL</span><h2 id={`${titleId}-message-link-help-title`}>Copy the message link</h2></div>
              <button type="button" onClick={() => setMessageLinkHelpOpen(false)} aria-label="Close"><X aria-hidden="true" /></button>
            </header>
            <img src="/discord-copy-message-link-guide.png" alt="Discord message menu with step 1 pointing to the three-dot menu and step 2 pointing to Copy Message Link" />
            <div className="reaction-help-steps">
              <span><b>1</b><small>Click the three-dot menu on the message.</small></span>
              <span><b>2</b><small>Select Copy Message Link.</small></span>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </section>
  );
}
