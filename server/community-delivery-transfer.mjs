import crypto from 'node:crypto';
import { getCommunityDeliveryTransfer, COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES } from '../shared/community-delivery-transfer.mjs';
import { getCommunityResultAllocation, getCommunityCategoryName } from '../shared/community-order-allocations.mjs';

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });

export function planCommunityDeliveryTransfer(order, destination, id, now = Date.now(), allowedStatuses = COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES) {
  const eligibility = getCommunityDeliveryTransfer(order, now, allowedStatuses);
  if (!eligibility.allowed) throw fail(eligibility.reason);
  if (!destination?.serverInfo?.guildId || destination.serverInfo.guildId === order.serverId) throw fail('Choose an invite for a different Discord server.', 400);
  const queued = order.communityResults.filter(member => String(member?.state).toLowerCase() === 'queued');
  const ids = queued.map(member => String(member.discordUserId ?? ''));
  if (ids.some(value => !/^\d{16,22}$/.test(value)) || new Set(ids).size !== ids.length
    || ids.length > Number(order.amount) - Number(order.added || 0)) throw fail('The waiting member list needs to be refreshed before transferring.');
  const transferredAt = new Date(now).toISOString();
  const allocations = (order.categoryAllocations || []).flatMap(allocation => {
    const amount = queued.filter(member => getCommunityResultAllocation(order, member) === allocation).length;
    return amount ? [{ ...allocation, amount, added: 0 }] : [];
  });
  if (order.categoryAllocations?.length && allocations.reduce((sum, item) => sum + item.amount, 0) !== ids.length) throw fail('The waiting members do not match their purchased categories.');
  const target = destination.serverInfo;
  const next = {
    uniqid: id, provider: 'community', amount: ids.length, added: 0,
    status: destination.invitesPaused ? 'INVITES PAUSED' : 'WAITING',
    waitingCode: destination.invitesPaused ? 'discord_guild_invites_limited' : destination.waitingForBot ? (destination.waitingCode || 'discord_missing') : 'delivery_transfer',
    details: destination.invitesPaused || destination.waitingForBot ? destination.waitingDetails || 'Add the Members bot to start delivery.' : 'Preparing transferred members for delivery.',
    serverId: target.guildId, serverName: target.guildName, serverMemberCount: target.approximateMemberCount,
    serverInvite: destination.inviteValue, serverInviteCreatedByBot: false,
    botInvite: destination.botInvite || null, createdAt: transferredAt,
    // Copy absolute dates, never calculate a new support period from createdAt.
    expiredAt: order.expiredAt ?? order.expired_at ?? null,
    supportStartedAt: order.supportStartedAt || order.createdAt || order.created_at,
    categoryAllocations: allocations,
    reactionDailyLimit: 0, reactionCapacity: 0, reactionRequests: [],
    transferredFrom: { orderId: order.uniqid, transferredAt },
    communityResults: queued.map(member => ({
      discordUserId: member.discordUserId, username: member.username, avatarUrl: member.avatarUrl ?? null,
      categoryId: member.categoryId, categoryName: member.categoryName, allocationId: member.allocationId,
      state: 'queued', details: 'Waiting for delivery.'
    }))
  };
  for (const key of ['service', 'stockType', 'categoryId', 'categoryName', 'categoryIsPeriodic', 'categoryCheckReplacementEnabled',
    'durationMonths', 'delay', 'speedProfile', 'joinMethod', 'experimentalJoin', 'botApplicationId', 'botName', 'poolBotId',
    'customBot', 'automaticBot', 'oauthOnly', 'isEldoradoSale']) if (order[key] !== undefined) next[key] = order[key];
  next.categoryName = getCommunityCategoryName(allocations, order.categoryName);
  if (destination.inviteRestriction) next.inviteRestriction = destination.inviteRestriction;
  const receipt = { orderId: id, amount: ids.length, serverName: target.guildName, transferredAt };
  const moved = new Set(ids);
  const source = {
    ...order, status: Number(order.added) > 0 ? 'PARTIAL' : 'CANCELLED', waitingCode: null,
    activeDelay: null, nextMemberAt: null, botInvite: null, remainingTransfer: receipt,
    details: `${ids.length} waiting members transferred to another order. Delivered members remain on this order.`,
    communityResults: order.communityResults.map(member => moved.has(String(member.discordUserId)) ? {
      ...member, state: 'cancelled', details: 'Waiting delivery cancelled and transferred to another order.',
      transferredOrderId: id, completedAt: transferredAt
    } : member)
  };
  return { source, order: next, memberIds: ids };
}

export function createCommunityDeliveryTransferHandler({ pool, resolveDestination, prepareStock, saveBot, sanitize, activate,
  readSettings = async () => ({ statuses: [...COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES] }),
  makeId = () => crypto.randomBytes(16).toString('hex'), onActivationError = console.error }) {
  return async (req, res, next) => {
    let client;
    let committed = false;
    try {
      const id = String(req.params.uniqid || '').trim();
      const invite = String(req.body?.invite || '').trim();
      if (!id || id.length > 160 || !invite || invite.length > 512) throw fail('Enter a valid Discord invite link.', 400);
      const initial = (await pool.query('SELECT payload FROM tracked_orders WHERE uniqid = $1', [id])).rows[0]?.payload;
      if (!initial || initial.provider !== 'community') throw fail('Members order could not be found.', 404);
      const respond = order => res.set('Cache-Control', 'no-store').json({ order: sanitize(order), monitorPath: `/monitor/${encodeURIComponent(order.uniqid)}` });
      // A lost HTTP response or double click must return the same destination.
      if (initial.remainingTransfer) {
        const existing = (await pool.query('SELECT payload FROM tracked_orders WHERE uniqid = $1', [initial.remainingTransfer.orderId])).rows[0]?.payload;
        if (!existing) throw fail('The destination order could not be found. Contact support.');
        return respond(existing);
      }
      const eligibility = getCommunityDeliveryTransfer(initial, Date.now(), (await readSettings()).statuses);
      if (!eligibility.allowed) throw fail(eligibility.reason);
      // Discord reads occur before the short database transaction; no joins here.
      const destination = await resolveDestination(initial, invite);
      client = await pool.connect();
      await client.query('BEGIN');
      const current = (await client.query('SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE', [id])).rows[0]?.payload;
      if (!current) throw fail('Members order could not be found.', 404);
      if (current.remainingTransfer) {
        const existing = (await client.query('SELECT payload FROM tracked_orders WHERE uniqid = $1', [current.remainingTransfer.orderId])).rows[0]?.payload;
        if (!existing) throw fail('The destination order could not be found. Contact support.');
        await client.query('COMMIT'); committed = true;
        return respond(existing);
      }
      if (current.botApplicationId !== initial.botApplicationId || current.serverId !== initial.serverId) throw fail('The order changed. Refresh before transferring.');
      const lease = await client.query('SELECT order_id FROM community_order_worker_leases WHERE order_id = $1 AND expires_at > NOW()', [id]);
      if (lease.rowCount) throw fail('Delivery is still stopping. Wait a moment before transferring.');
      if (['starting', 'running'].includes(current.membersLeaveJob?.status) || ['starting', 'running'].includes(current.autoLeaveJob?.status)) throw fail('Wait for the member operation to finish before transferring.');
      // Re-read after Discord resolution and the order lock: settings may have changed meanwhile.
      const settings = await readSettings();
      const plan = planCommunityDeliveryTransfer(current, { ...destination, inviteValue: invite }, makeId(), Date.now(), settings.statuses);
      await prepareStock(client, current, destination, plan.memberIds);
      await client.query('INSERT INTO tracked_orders (uniqid, payload, created_at, updated_at) VALUES ($1, $2::jsonb, NOW(), NOW())', [plan.order.uniqid, JSON.stringify(plan.order)]);
      if (current.customBot) {
        await saveBot(client, { ...destination.config, orderBotId: plan.order.uniqid });
        await client.query(`INSERT INTO community_order_bot_credentials (order_id, discord_user_id, encrypted_value)
          SELECT $2, discord_user_id, encrypted_value FROM community_order_bot_credentials
          WHERE order_id = $1 AND discord_user_id = ANY($3::text[])`, [id, plan.order.uniqid, plan.memberIds]);
      }
      await client.query('UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1', [id, JSON.stringify(plan.source)]);
      await client.query('UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id = $1 AND discord_user_id = ANY($2::text[])', [id, plan.memberIds]);
      await client.query('UPDATE community_oauth_joins SET reserved_order_id = $2 WHERE guild_id = $1 AND discord_user_id = ANY($3::text[])', [plan.order.serverId, plan.order.uniqid, plan.memberIds]);
      await client.query('COMMIT'); committed = true;
      // Activation failure leaves a durable WAITING order for the existing poller.
      if (plan.order.status === 'WAITING') void Promise.resolve().then(() => activate(plan.order)).catch(onActivationError);
      return respond(plan.order);
    } catch (error) {
      if (client && !committed) await client.query('ROLLBACK').catch(() => {});
      next(error);
    } finally { client?.release(); }
  };
}

// Preserve the transfer receipt and cancelled slots even if an old process saves
// a pre-transfer snapshot. Current support/check updates remain writable.
export const COMMUNITY_DELIVERY_TRANSFER_GUARD_SQL = `
CREATE OR REPLACE FUNCTION pulcip_preserve_delivery_transfer() RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE previous_members jsonb; incoming_ids jsonb;
BEGIN
  IF OLD.payload->'remainingTransfer' IS NULL THEN RETURN NEW; END IF;
  IF NEW.payload->'remainingTransfer' IS DISTINCT FROM OLD.payload->'remainingTransfer' THEN
    NEW.payload := NEW.payload || jsonb_build_object('remainingTransfer', OLD.payload->'remainingTransfer',
      'status', OLD.payload->'status', 'details', OLD.payload->'details', 'waitingCode', OLD.payload->'waitingCode', 'botInvite', OLD.payload->'botInvite');
  END IF;
  SELECT COALESCE(jsonb_object_agg(item->>'discordUserId', item), '{}'::jsonb) INTO previous_members
    FROM jsonb_array_elements(OLD.payload->'communityResults') item WHERE item ? 'transferredOrderId';
  SELECT COALESCE(jsonb_object_agg(item->>'discordUserId', true) FILTER (WHERE item->>'discordUserId' IS NOT NULL), '{}'::jsonb) INTO incoming_ids
    FROM jsonb_array_elements(COALESCE(NEW.payload->'communityResults', '[]'::jsonb)) item;
  NEW.payload := jsonb_set(NEW.payload, '{communityResults}', COALESCE((SELECT jsonb_agg(
    CASE WHEN previous_members ? (item->>'discordUserId') THEN previous_members->(item->>'discordUserId') ELSE item END ORDER BY position)
    FROM jsonb_array_elements(COALESCE(NEW.payload->'communityResults', '[]'::jsonb)) WITH ORDINALITY AS entries(item, position)), '[]'::jsonb)
    || COALESCE((SELECT jsonb_agg(item ORDER BY position)
      FROM jsonb_array_elements(OLD.payload->'communityResults') WITH ORDINALITY AS entries(item, position)
      WHERE item ? 'transferredOrderId' AND NOT (incoming_ids ? (item->>'discordUserId'))), '[]'::jsonb));
  RETURN NEW;
END $guard$;
DROP TRIGGER IF EXISTS preserve_delivery_transfer ON tracked_orders;
CREATE TRIGGER preserve_delivery_transfer BEFORE UPDATE OF payload ON tracked_orders
FOR EACH ROW EXECUTE FUNCTION pulcip_preserve_delivery_transfer();`;
