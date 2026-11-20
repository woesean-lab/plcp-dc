import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ReactionPanel, REACTION_MIXED_VALUE } from "./ReactionPanel";
import { cancelCommunityOrderReactions, cancelPublicCommunityOrderReactions, getOrderStatus, getPublicOrderStatus, updateCommunityOrderReactionMessage, updatePublicCommunityOrderReactionMessage } from "../lib/integration";
import type { CustomerOrderReactions, OrderStatusResponse } from "../types";

export function CustomerOrderReactionPanel({ uniqid, summary, onUpdate, access = "public", onEditSettings }: {
  uniqid: string;
  summary: CustomerOrderReactions;
  onUpdate: (order: OrderStatusResponse) => void;
  access?: "public" | "admin";
  onEditSettings?: () => void;
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
    let active = true;
    const deadline = Math.min(new Date(summary.resetsAt).getTime(), new Date(summary.expiresAt || summary.resetsAt).getTime());
    let timer: number;
    const refresh = async () => {
      try {
        const order = await (access === "admin" ? getOrderStatus(uniqid, "community") : getPublicOrderStatus(uniqid));
        if (!active) return;
        onUpdateRef.current(order);
        if (order.customerReactions?.enabled && order.customerReactions.resetsAt === summary.resetsAt) timer = window.setTimeout(refresh, 5000);
      } catch { if (active) timer = window.setTimeout(refresh, 5000); }
    };
    timer = window.setTimeout(() => void refresh(), Math.min(Math.max(0, deadline - Date.now()) + 100, 2_147_483_647));
    return () => { active = false; window.clearTimeout(timer); };
  }, [uniqid, summary.resetsAt, summary.expiresAt, access]);

  async function submit() {
    if (busy.current || !summary.ready || !summary.remaining) return;
    busy.current = true; setSaving(true);
    try {
      const order = access === "admin"
        ? await updateCommunityOrderReactionMessage(uniqid, message.trim(), Math.min(amount, summary.remaining), emojis, { customerAllowance: true })
        : await updatePublicCommunityOrderReactionMessage(uniqid, message.trim(), Math.min(amount, summary.remaining), emojis);
      onUpdateRef.current(order);
      toast.success("Reaction request added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send reactions.");
      void (access === "admin" ? getOrderStatus(uniqid, "community") : getPublicOrderStatus(uniqid)).then((order) => onUpdateRef.current(order)).catch(() => {});
    } finally { busy.current = false; setSaving(false); }
  }

  async function cancel(requestId?: string) {
    if (busy.current) return;
    busy.current = true; setCancelling(true);
    try {
      const result = access === "admin"
        ? await cancelCommunityOrderReactions(uniqid, { requestId, customerAllowance: true })
        : await cancelPublicCommunityOrderReactions(uniqid, requestId);
      onUpdateRef.current(result.order);
      toast.success(`${result.cancelledCount} queued reactions cancelled.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not cancel reactions."); }
    finally { busy.current = false; setCancelling(false); }
  }

  if (!summary.enabled || (summary.expiresAt && new Date(summary.expiresAt).getTime() <= Date.now())) return null;
  return <ReactionPanel collapsible
    resetsAt={summary.resetsAt}
    description={`${summary.firstDay ? `First day: ${summary.todayLimit} reactions. Then ` : ""}${summary.dailyLimit} reactions per day during your support period.${summary.ready ? "" : " Available after member delivery."}`}
    onEditLimit={access === "admin" ? onEditSettings : undefined} limitActionLabel="Manage reactions"
    lockReason={cancelling ? "Cancelling queued reactions…" : summary.ready && !summary.eligibleMembers ? "No members are currently available to react." : undefined}
    limit={summary.todayLimit} completed={summary.completed} failed={summary.failed}
    remaining={summary.remaining} eligibleMembers={summary.eligibleMembers}
    messageDraft={message} countDraft={Math.min(amount, Math.max(1, summary.remaining))}
    selectedEmojis={emojis} saving={saving}
    requestEnabled={summary.ready && !cancelling && summary.eligibleMembers > 0}
    requests={summary.requests} onMessageChange={setMessage} onCountChange={setAmount}
    onEmojiSelectionChange={setEmojis} onSubmit={() => void submit()}
    onCancelPending={(requestId) => void cancel(requestId)} cancellingPending={cancelling}
  />;
}
