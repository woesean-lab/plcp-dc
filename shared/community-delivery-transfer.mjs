import { getCommunityResultAllocation } from './community-order-allocations.mjs';

export const COMMUNITY_DELIVERY_TRANSFER_STATUSES = Object.freeze(['WAITING', 'PAUSED', 'INVITES PAUSED', 'ERROR', 'PARTIAL']);
export const COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES = Object.freeze(['INVITES PAUSED']);

export function getCommunityDeliveryTransfer(order, now = Date.now(), allowedStatuses = COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES) {
  const members = Array.isArray(order?.communityResults) ? order.communityResults : [];
  const queued = members.filter(member => String(member?.state).toLowerCase() === 'queued');
  const status = String(order?.status).toUpperCase();
  const statusAllowed = COMMUNITY_DELIVERY_TRANSFER_STATUSES.includes(status) && allowedStatuses.includes(status);
  let reason = '';
  if (order?.provider !== 'community') reason = 'Only Members orders can be transferred.';
  else if (order.remainingTransfer) reason = 'The waiting members have already been transferred.';
  else if (!statusAllowed) reason = 'Transfers are not enabled for this order status.';
  else if (members.some(member => ['joining', 'replacing', 'pending_join'].includes(String(member?.state).toLowerCase()))) reason = 'Wait for the current member to finish before transferring.';
  else if (!queued.length) reason = 'No waiting members are available to transfer.';
  else if (queued.some(member => {
    const expiration = getCommunityResultAllocation(order, member)?.expiredAt ?? order.expiredAt ?? order.expired_at;
    return expiration && Number.isFinite(Date.parse(expiration)) && Date.parse(expiration) <= now;
  })) reason = 'The support period for waiting members has expired.';
  return { count: queued.length, statusAllowed, allowed: !reason, reason };
}
