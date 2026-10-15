import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, CircleAlert, ExternalLink, LoaderCircle, MessageSquareText, RefreshCw, Server, Sparkles, Users } from "lucide-react";
import toast from "react-hot-toast";
import { REACTION_MIXED_VALUE, ReactionPanel, type ReactionPanelRequest } from "@/components/ReactionPanel";
import { DiscordMessageLinkHelp } from "@/components/DiscordMessageLinkHelp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { extractBotInviteFromError } from "../lib/bot-invite";
import { cancelReactionWorkspaceRequest, checkReactionWorkspaceMembers, createReactionWorkspaceRequest, getReactionWorkspaceMemberCheckProgress, inspectReactionWorkspace } from "../lib/integration";
import type { ReactionMemberCheckProgress, ReactionWorkspaceSummary } from "../types";

const DISCORD_MESSAGE_LINK = /^https:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/\d{16,22}\/\d{16,22}\/\d{16,22}(?:[/?#].*)?$/i;
const PAGE_SKELETON_DELAY = 300;

function normalizeReactionEmojiKey(emoji: string) {
  const customEmoji = emoji.match(/^<a?:([\w~]{1,64}):(\d{16,22})>$/);
  return customEmoji ? `${customEmoji[1]}:${customEmoji[2]}` : emoji;
}

function getReactionCapacity(summary: ReactionWorkspaceSummary, selectedEmojis: string[]) {
  if (selectedEmojis.includes(REACTION_MIXED_VALUE)) return summary.availableForMessage;
  return selectedEmojis.reduce((total, emoji) => {
    const used = summary.usedReactionCounts?.[normalizeReactionEmojiKey(emoji)] ?? 0;
    return total + Math.max(0, summary.eligibleMembers - used);
  }, 0);
}

function isReactionBotRequiredError(error: unknown) {
  if (!error || typeof error !== "object" || !("payload" in error)) return false;
  const payload = (error as { payload?: unknown }).payload;
  return Boolean(payload && typeof payload === "object" && "code" in payload && payload.code === "REACTION_BOT_REQUIRED");
}

function ReactionsPageSkeleton() {
  return (
    <section className="reactions-page tab-slide-in" role="status" aria-live="polite" aria-busy="true" aria-label="Loading reactions">
      <span className="sr-only">Loading reactions</span>
      <div className="reactions-page-heading" aria-hidden="true">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-3 h-10 w-52" />
          <Skeleton className="mt-3 h-4 w-full max-w-[720px]" />
        </div>
        <Skeleton className="h-[52px] w-[420px] max-w-full rounded-[14px]" />
      </div>
      <div className="reactions-lookup-card" aria-hidden="true">
        <Skeleton className="h-12 w-12 shrink-0 rounded-[14px]" />
        <div className="min-w-0">
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
        <div className="min-w-0">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-[46px] w-full rounded-xl" />
        </div>
        <Skeleton className="h-[46px] w-full rounded-xl" />
      </div>
    </section>
  );
}

function toPanelRequests(summary: ReactionWorkspaceSummary): ReactionPanelRequest[] {
  return summary.requests.map((request) => {
    const assignments = Array.isArray(request.assignments) ? request.assignments : [];
    const failedAssignments = assignments.filter((assignment) => assignment.reactionState === "failed");
    return {
      id: request.id,
      messageLink: request.messageLink,
      requestedCount: request.requestedCount,
      assignedCount: request.assignedCount,
      emojiCount: request.emojiCount,
      emojis: request.emojis,
      createdAt: request.createdAt,
      autoStopReason: request.autoStopReason,
      completedCount: assignments.filter((assignment) => assignment.reactionState === "completed").length,
      failedCount: failedAssignments.length,
      cancelledCount: assignments.filter((assignment) => assignment.reactionState === "cancelled").length,
      failureMessages: [...new Set(failedAssignments.map((assignment) => `${assignment.reactionEmoji ?? "Reaction"}${assignment.discordUserId ? ` · ${assignment.discordUserId}` : ""}: ${assignment.reactionDetails || "Discord returned no detail."}`))]
    };
  });
}

export default function ReactionsPage() {
  const [pageReady, setPageReady] = useState(false);
  const [messageLink, setMessageLink] = useState("");
  const [summary, setSummary] = useState<ReactionWorkspaceSummary | null>(null);
  const [inspectError, setInspectError] = useState("");
  const [botInvite, setBotInvite] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [count, setCount] = useState(1);
  const [emojis, setEmojis] = useState<string[]>([REACTION_MIXED_VALUE]);
  const [submitting, setSubmitting] = useState(false);
  const [checkingMembers, setCheckingMembers] = useState(false);
  const [memberCheckAmount, setMemberCheckAmount] = useState("");
  const [memberCheckProgress, setMemberCheckProgress] = useState<ReactionMemberCheckProgress | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState("");
  const [inspectNonce, setInspectNonce] = useState(0);

  const normalizedLink = messageLink.trim();
  const validLink = DISCORD_MESSAGE_LINK.test(normalizedLink);
  const requests = useMemo(() => summary ? toPanelRequests(summary) : [], [summary]);
  const reactionCapacity = useMemo(() => summary ? getReactionCapacity(summary, emojis) : 0, [emojis, summary]);
  const activeRequestCount = requests.filter((request) => request.assignedCount > request.completedCount + (request.failedCount ?? 0) + (request.cancelledCount ?? 0)).length;

  useEffect(() => {
    const timer = window.setTimeout(() => setPageReady(true), PAGE_SKELETON_DELAY);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!validLink) {
      setSummary(null);
      setBotInvite(null);
      setInspectError(normalizedLink ? "Paste a complete Discord message link." : "");
      setInspecting(false);
      return;
    }
    let active = true;
    setInspecting(true);
    setInspectError("");
    setBotInvite(null);
    const timer = window.setTimeout(() => {
      void inspectReactionWorkspace(normalizedLink)
        .then((nextSummary) => {
          if (!active) return;
          setSummary(nextSummary);
          setCount((current) => Math.max(1, Math.min(current, Math.max(1, getReactionCapacity(nextSummary, emojis)))));
        })
        .catch((error) => {
          if (!active) return;
          setSummary(null);
          if (isReactionBotRequiredError(error)) {
            setBotInvite(extractBotInviteFromError(error));
            setInspectError("");
          } else {
            setInspectError(error instanceof Error ? error.message : "The Discord message could not be inspected.");
          }
        })
        .finally(() => {
          if (active) setInspecting(false);
        });
    }, 450);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [inspectNonce, normalizedLink, validLink]);

  useEffect(() => {
    if (!summary || activeRequestCount <= 0) return;
    let active = true;
    const timer = window.setInterval(() => {
      void inspectReactionWorkspace(summary.messageLink).then((nextSummary) => {
        if (active) setSummary(nextSummary);
      }).catch(() => {});
    }, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeRequestCount, summary?.messageLink]);

  useEffect(() => {
    if (!checkingMembers || !summary?.messageLink) return;
    let active = true;
    const refreshProgress = () => {
      void getReactionWorkspaceMemberCheckProgress(summary.messageLink).then((progress) => {
        if (active && progress.active && progress.total > 0) setMemberCheckProgress(progress);
      }).catch(() => {});
    };
    refreshProgress();
    const timer = window.setInterval(refreshProgress, 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [checkingMembers, summary?.messageLink]);

  function handleMessageChange(value: string) {
    setMessageLink(value);
    setBotInvite(null);
    if (summary && value.trim() !== summary.messageLink) setSummary(null);
  }

  async function handleSubmit() {
    if (!summary || !reactionCapacity || submitting) return;
    try {
      setSubmitting(true);
      const reactionCount = Math.min(count, reactionCapacity);
      const next = await createReactionWorkspaceRequest(summary.messageLink, reactionCount, emojis.slice(0, Math.min(reactionCount, 20)));
      setSummary(next);
      setCount(1);
      setEmojis([REACTION_MIXED_VALUE]);
      toast.success(`${reactionCount} reactions were queued.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reactions could not be queued.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckMembers() {
    if (!summary || checkingMembers) return;
    const requestedCheckCount = Number.parseInt(memberCheckAmount, 10);
    if (!Number.isInteger(requestedCheckCount) || requestedCheckCount < 1) {
      toast.error("Enter how many members to check.");
      return;
    }
    try {
      setMemberCheckProgress({ active: true, total: requestedCheckCount, checked: 0, remaining: requestedCheckCount, stage: "starting" });
      setCheckingMembers(true);
      const next = await checkReactionWorkspaceMembers(summary.messageLink, requestedCheckCount);
      setMemberCheckProgress({ active: false, total: next.lastBatchChecked, checked: next.lastBatchChecked, remaining: 0, stage: "complete" });
      setSummary(next);
      setCount((current) => Math.max(1, Math.min(current, Math.max(1, getReactionCapacity(next, emojis)))));
      setMemberCheckAmount(String(next.remainingUncheckedMembers));
      toast.success(next.memberCheckComplete
        ? `All ${next.checkedMembers} delivered members were checked. ${next.eligibleMembers} are ready to react.`
        : `${next.lastBatchChecked} members checked. ${next.eligibleMembers} are ready; ${next.remainingUncheckedMembers} remain.`);
    } catch (error) {
      if (isReactionBotRequiredError(error)) {
        setSummary(null);
        setBotInvite(extractBotInviteFromError(error));
      }
      toast.error(error instanceof Error ? error.message : "Members could not be checked.");
    } finally {
      setCheckingMembers(false);
    }
  }

  async function handleCancel(requestId?: string) {
    if (!requestId || cancellingRequestId) return;
    try {
      setCancellingRequestId(requestId);
      const result = await cancelReactionWorkspaceRequest(requestId);
      const next = await inspectReactionWorkspace(normalizedLink);
      setSummary(next);
      toast.success(result.cancelledCount ? `${result.cancelledCount} queued reactions were cancelled.` : "No queued reactions remained to cancel.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The reaction request could not be cancelled.");
    } finally {
      setCancellingRequestId("");
    }
  }

  if (!pageReady) return <ReactionsPageSkeleton />;

  return (
    <section className="reactions-page tab-slide-in">
      <div className="reactions-page-heading">
        <div>
          <p className="app-kicker text-[var(--app-accent)]">Members-powered delivery</p>
          <h1 className="page-title">Reactions</h1>
          <p className="page-description">Paste a Discord message link. We’ll match every Members order delivered to that server and show the accounts ready to react.</p>
        </div>
        <div className="reactions-flow" aria-label="Reaction workflow">
          <span><Users aria-hidden="true" /> Deliver members</span>
          <ArrowRight aria-hidden="true" />
          <span><MessageSquareText aria-hidden="true" /> Paste message</span>
          <ArrowRight aria-hidden="true" />
          <span><Sparkles aria-hidden="true" /> Queue reactions</span>
        </div>
      </div>

      {!summary ? (
        <div className="reactions-lookup-card">
          <span className="reactions-lookup-icon" aria-hidden="true"><Server /></span>
          <div className="reactions-lookup-copy">
            <strong>Find the server’s delivered members</strong>
            <p>The server ID is read from the message link. Multiple Members orders for the same server are combined automatically.</p>
          </div>
          <div className="reactions-lookup-field">
            <span className="boost-order-label monitor-reaction-url-label">
              <label htmlFor="reactions-message-url">Discord Message URL</label>
              <DiscordMessageLinkHelp />
            </span>
            <Input
              id="reactions-message-url"
              autoFocus
              type="url"
              value={messageLink}
              onChange={(event) => handleMessageChange(event.target.value)}
              placeholder="https://discord.com/channels/server/channel/message"
              aria-invalid={Boolean(inspectError)}
            />
          </div>
          <Button type="button" disabled={!validLink || inspecting} onClick={() => setInspectNonce((current) => current + 1)}>
            {inspecting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="h-4 w-4" aria-hidden="true" />}
            {inspecting ? "Matching..." : "Match members"}
          </Button>
          {botInvite ? (
            <div className="reactions-bot-required" role="alert">
              <span className="reactions-bot-required-icon" aria-hidden="true"><Bot /></span>
              <div className="reactions-bot-required-copy">
                <strong>Reaction işlemi için botu yeniden sunucuya ekleyin.</strong>
                <p>Bot sunucuda algılandıktan sonra teslim edilmiş uygun üyeler yüklenir.</p>
              </div>
              <div className="reactions-bot-required-actions">
                <Button asChild type="button">
                  <a href={botInvite} target="_blank" rel="noreferrer">
                    <Bot className="h-4 w-4" aria-hidden="true" /> Botu Ekle <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </Button>
                <Button type="button" variant="secondary" disabled={inspecting} onClick={() => setInspectNonce((current) => current + 1)}>
                  <RefreshCw className={`h-4 w-4${inspecting ? " animate-spin" : ""}`} aria-hidden="true" /> Tekrar Kontrol Et
                </Button>
              </div>
            </div>
          ) : null}
          {inspectError ? (
            <div className="reactions-lookup-error" role="alert">
              <span className="reactions-lookup-error-icon" aria-hidden="true"><CircleAlert /></span>
              <span>
                <strong>Members couldn’t be matched</strong>
                <small>{inspectError}</small>
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <ReactionPanel
          className="is-workspace"
          limit={summary.eligibleMembers}
          completed={requests.reduce((total, request) => total + request.completedCount, 0)}
          failed={requests.reduce((total, request) => total + (request.failedCount ?? 0), 0)}
          remaining={reactionCapacity}
          eligibleMembers={summary.eligibleMembers}
          messageDraft={messageLink}
          countDraft={count}
          selectedEmojis={emojis}
          saving={submitting}
          requestEnabled={!inspecting && !checkingMembers && !summary.membersCheckRequired}
          requests={requests}
          onMessageChange={handleMessageChange}
          onCountChange={setCount}
          onEmojiSelectionChange={setEmojis}
          onSubmit={() => void handleSubmit()}
          onRefreshEligibleMembers={() => void handleCheckMembers()}
          refreshingEligibleMembers={checkingMembers}
          memberCheckAmount={memberCheckAmount}
          memberCheckProgress={memberCheckProgress}
          onMemberCheckAmountChange={setMemberCheckAmount}
          onCancelPending={(requestId) => void handleCancel(requestId)}
          cancellingPending={Boolean(cancellingRequestId)}
          workspaceSummary={summary}
        />
      )}
    </section>
  );
}
