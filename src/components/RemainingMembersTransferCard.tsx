import { useId, useRef, useState } from 'react';
import { ArrowRightLeft, ArrowUpRight, CalendarDays, LoaderCircle, Server, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from './ui/button';
import { OrderConfirmationDialog } from './OrderConfirmationDialog';
import { MemberActivityAvatar } from './MemberActivityAvatar';
import { getCommunityDeliveryTransfer } from '../../shared/community-delivery-transfer.mjs';
import { getOrderSupportExpiration } from '../lib/order-status';
import { extractDiscordInviteCode } from '../lib/discord';
import type { CommunityDeliveryTransferPreview, OrderStatusResponse } from '../types';

export function RemainingMembersTransferCard({ order, onPreview, onTransfer }: {
  order: OrderStatusResponse;
  onPreview: (invite: string) => Promise<CommunityDeliveryTransferPreview>;
  onTransfer: (invite: string, preview: CommunityDeliveryTransferPreview) => Promise<void>;
}) {
  const inputId = useId();
  const [invite, setInvite] = useState('');
  const [review, setReview] = useState<{ invite: string; server: CommunityDeliveryTransferPreview } | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const eligibility = getCommunityDeliveryTransfer(order, Date.now(), order.deliveryTransferStatuses ?? []);
  const expiration = getOrderSupportExpiration(order);
  const supportText = expiration ? new Date(expiration).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const receipt = order.remainingTransfer;
  const eligibleCount = eligibility.allowed ? eligibility.count : 0;
  const reviewValid = eligibility.allowed && review?.server.amount === eligibility.count;
  async function prepare() {
    if (pending.current || !eligibility.allowed || !invite.trim()) return;
    const code = extractDiscordInviteCode(invite);
    if (!code) { setError('Enter a valid Discord invite.'); return; }
    pending.current = true; setChecking(true); setError('');
    const value = `https://discord.gg/${code}`;
    try { setReview({ invite: value, server: await onPreview(value) }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not check this server. Try again.'); }
    finally { pending.current = false; setChecking(false); }
  }
  async function confirm() {
    if (pending.current || !review || !reviewValid) return;
    pending.current = true; setBusy(true); setError('');
    try { await onTransfer(review.invite, review.server); setReview(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Members could not be transferred. Try again.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="monitor-control-panel monitor-transfer-panel">
    <div className="monitor-panel-heading">
      <span className="monitor-panel-icon" aria-hidden="true"><ArrowRightLeft className="h-4 w-4" /></span>
      <div><p className="app-kicker">Delivery transfer</p><h2>{receipt ? 'Waiting members transferred' : 'Transfer waiting members'}</h2></div>
      {receipt ? <span className="monitor-transfer-count"><span className="app-kicker">Transferred</span><strong className="monitor-current-delay">{receipt.amount.toLocaleString('en-US')}</strong></span> : null}
    </div>
    {receipt ? <>
      <p className="monitor-transfer-copy">Moved to {receipt.serverName}.</p>
      <Button asChild variant="secondary"><Link to={`/monitor/${encodeURIComponent(receipt.orderId)}`} target="_blank" rel="noopener noreferrer">Open new monitor<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
    </> : <form onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <div className="monitor-transfer-fields">
        <label className="boost-order-field" htmlFor={`${inputId}-amount`}>
          <span className="boost-order-label">Number of Members</span>
          <input id={`${inputId}-amount`} className="boost-number-input disabled:cursor-not-allowed disabled:opacity-45" type="number" min={0} value={eligibleCount} disabled />
        </label>
        <label className="boost-order-field" htmlFor={`${inputId}-invite`}>
          <span className="boost-order-label">Server Invite</span>
          <div className="boost-invite-control">
            <span aria-hidden="true">discord.gg/</span>
            <input id={`${inputId}-invite`} value={invite} onChange={event => setInvite(extractDiscordInviteCode(event.target.value) ?? event.target.value)}
              placeholder="yourcode" required maxLength={512} disabled={checking || busy || !eligibility.allowed} autoComplete="off" spellCheck={false} autoCapitalize="none" />
          </div>
        </label>
      </div>
      <Button type="submit" variant="secondary" disabled={checking || busy || !eligibility.allowed || !invite.trim()}>
        {checking || busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />}
        {checking ? 'Checking server…' : busy ? 'Transferring…' : 'Transfer members'}
      </Button>
      {!eligibility.allowed ? <p className="monitor-transfer-copy" role="status">{eligibility.reason}</p> : null}
    </form>}
    {error && !review ? <p className="monitor-transfer-error" role="alert">{error}</p> : null}
    {review ? <OrderConfirmationDialog title="Transfer waiting members?" confirmLabel="Confirm transfer" busyLabel="Transferring…" service={String(order.categoryName || 'Members')} amount={review.server.amount} invite={review.invite}
      description="Waiting members move to this server. Delivered members stay here. Support dates stay unchanged."
      busy={busy} confirmDisabled={!reviewValid} onClose={() => { if (!busy) { setReview(null); setError(''); } }} onConfirm={() => void confirm()}>
      <div className="order-confirm-primary">
        <MemberActivityAvatar className="order-confirm-service-icon" src={review.server.serverIconUrl} fallback={<Server className="h-4 w-4" />} />
        <span className="order-confirm-primary-copy"><small>Destination server</small><strong className="break-words">{review.server.serverName}</strong></span>
      </div>
      <div className="order-confirm-meta"><span><Server className="h-3.5 w-3.5" aria-hidden="true" />{review.server.serverId}</span>
        {review.server.serverMemberCount !== null ? <span><Users className="h-3.5 w-3.5" aria-hidden="true" />~{review.server.serverMemberCount.toLocaleString('en-US')} members</span> : null}
      </div>
      {supportText ? <div className="order-confirm-target"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /><span><small>Original support end</small><strong>{supportText}</strong></span></div> : null}
      {review.server.waitingForBot ? <p className="monitor-transfer-copy">Add the assigned bot to start delivery.</p> : null}
      {!reviewValid ? <p role="status" className="monitor-transfer-error">Member availability changed. Go back and review again.</p> : null}
      {error ? <p role="alert" className="monitor-transfer-error">{error}</p> : null}
    </OrderConfirmationDialog> : null}
  </div>;
}
