import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ReactionPanel, REACTION_MIXED_VALUE } from "./ReactionPanel";
import { cancelPublicCommunityOrderReactions, getPublicOrderStatus, updatePublicCommunityOrderReactionMessage } from "../lib/integration";
import type { CustomerOrderReactions, OrderStatusResponse } from "../types";

export function CustomerOrderReactionPanel({ uniqid, summary, onUpdate }: {
  uniqid: string;
  summary: CustomerOrderReactions;
  onUpdate: (order: OrderStatusResponse) => void;
}) {
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(1);
  const [emojis, setEmojis] = useState<string[]>([REACTION_MIXED_VALUE]);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const busy = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    const deadline = Math.min(new Date(summary.resetsAt).getTime(), new Date(summary.expiresAt || summary.resetsAt).getTime());
    const timer = window.setTimeout(() => {
      void getPublicOrderStatus(uniqid).then((order) => onUpdateRef.current(order)).catch(() => {});
    }, Math.min(Math.max(0, deadline - Date.now()) + 100, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [uniqid, summary.resetsAt, summary.expiresAt]);

  async function submit() {
    if (busy.current || !summary.ready || !summary.remaining) return;
    busy.current = true; setSaving(true);
    try {
      onUpdateRef.current(await updatePublicCommunityOrderReactionMessage(uniqid, message.trim(), Math.min(amount, summary.remaining), emojis));
      toast.success("Reaction request added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send reactions.");
      void getPublicOrderStatus(uniqid).then((order) => onUpdateRef.current(order)).catch(() => {});
    } finally { busy.current = false; setSaving(false); }
  }

  async function cancel(requestId?: string) {
    if (busy.current) return;
    busy.current = true; setCancelling(true);
    try {
      const result = await cancelPublicCommunityOrderReactions(uniqid, requestId);
      onUpdateRef.current(result.order);
      toast.success(`${result.cancelledCount} queued reactions cancelled.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not cancel reactions."); }
    finally { busy.current = false; setCancelling(false); }
  }

  if (!summary.enabled || (summary.expiresAt && new Date(summary.expiresAt).getTime() <= Date.now())) return null;
  return <ReactionPanel
    description={`${summary.dailyLimit} reactions per day during your support period. Resets at 00:00 Türkiye time.${summary.ready ? "" : " Available after member delivery."}`}
    lockReason={cancelling ? "Cancelling queued reactions…" : summary.ready && !summary.eligibleMembers ? "No members are currently available to react." : undefined}
    limit={summary.dailyLimit} completed={summary.completed} failed={summary.failed}
    remaining={summary.remaining} eligibleMembers={summary.eligibleMembers}
    messageDraft={message} countDraft={Math.min(amount, Math.max(1, summary.remaining))}
    selectedEmojis={emojis} saving={saving}
    requestEnabled={summary.ready && !cancelling && summary.eligibleMembers > 0}
    requests={summary.requests} onMessageChange={setMessage} onCountChange={setAmount}
    onEmojiSelectionChange={setEmojis} onSubmit={() => void submit()}
    onCancelPending={(requestId) => void cancel(requestId)} cancellingPending={cancelling}
  />;
}
