import { useId, useRef, useState } from 'react';
import { ArrowRightLeft, ArrowUpRight, CalendarDays, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { OrderConfirmationDialog } from './OrderConfirmationDialog';
import { getCommunityDeliveryTransfer } from '../../shared/community-delivery-transfer.mjs';
import { getOrderSupportExpiration } from '../lib/order-status';
import type { OrderStatusResponse } from '../types';

export function RemainingMembersTransferCard({ order, onTransfer }: {
  order: OrderStatusResponse;
  onTransfer: (invite: string) => Promise<void>;
}) {
  const inputId = useId();
  const [invite, setInvite] = useState('');
  const [reviewInvite, setReviewInvite] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const eligibility = getCommunityDeliveryTransfer(order, Date.now(), order.deliveryTransferStatuses ?? []);
  const expiration = getOrderSupportExpiration(order);
  const supportText = expiration ? new Date(expiration).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Original support terms';
  const receipt = order.remainingTransfer;
  async function confirm() {
    if (pending.current || !reviewInvite || !eligibility.allowed) return;
    pending.current = true; setBusy(true); setError('');
    try { await onTransfer(reviewInvite); setReviewInvite(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Members could not be transferred. Try again.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="monitor-control-panel monitor-transfer-panel">
    <div className="monitor-panel-heading">
      <span className="monitor-panel-icon" aria-hidden="true"><ArrowRightLeft className="h-4 w-4" /></span>
      <div><p className="app-kicker">Delivery transfer</p><h2>{receipt ? 'Waiting members transferred' : 'Transfer waiting members'}</h2></div>
    </div>
    {receipt ? <>
      <p className="monitor-transfer-copy">{receipt.amount} waiting members moved to {receipt.serverName}. Delivered members stay on this order.</p>
      <Button asChild variant="secondary"><Link to={`/monitor/${encodeURIComponent(receipt.orderId)}`}>Open new monitor<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
    </> : <form onSubmit={event => { event.preventDefault(); setError(''); if (eligibility.allowed && invite.trim()) setReviewInvite(invite.trim()); }}>
      <p className="monitor-transfer-copy">Move {eligibility.count} waiting members to a new order for another server. Delivered members stay here.</p>
      <label className="field-label" htmlFor={inputId}>New Discord invite</label>
      <Input id={inputId} value={invite} onChange={event => setInvite(event.target.value)} placeholder="https://discord.gg/your-server" required maxLength={512} disabled={busy || !eligibility.allowed} autoComplete="off" />
      <Button type="submit" variant="secondary" disabled={busy || !eligibility.allowed || !invite.trim()}>
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />}
        {busy ? 'Transferring...' : 'Transfer to another server'}
      </Button>
      {!eligibility.allowed ? <p className="monitor-transfer-copy" role="status">{eligibility.reason}</p> : null}
    </form>}
    <div className="monitor-safety-note"><CalendarDays className="h-4 w-4" aria-hidden="true" /><p>Support stays unchanged: {supportText}. Each category keeps its original end date.</p></div>
    {error ? <p className="monitor-transfer-error" role="alert">{error}</p> : null}
    {reviewInvite ? <OrderConfirmationDialog title="Transfer waiting members?" confirmLabel="Confirm transfer" busyLabel="Transferring..." service={String(order.categoryName || 'Members')} amount={eligibility.count} invite={reviewInvite}
      description="Waiting deliveries will be cancelled on this order and moved to a new order. Delivered members stay here. Support end dates do not change."
      busy={busy} onClose={() => { if (!busy) { setReviewInvite(null); setError(''); } }} onConfirm={() => void confirm()}>
      <div className="order-confirm-target"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /><span><small>Original support end</small><strong>{supportText}</strong></span></div>
      {error ? <p role="alert" className="monitor-transfer-error">{error}</p> : null}
    </OrderConfirmationDialog> : null}
  </div>;
}
