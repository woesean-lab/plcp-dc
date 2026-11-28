import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { planCommunityDeliveryTransfer, createCommunityDeliveryTransferHandler, COMMUNITY_DELIVERY_TRANSFER_GUARD_SQL } from './community-delivery-transfer.mjs';
import { getCommunityDeliveryTransfer } from '../shared/community-delivery-transfer.mjs';
import { COMMUNITY_ORDER_CATEGORY_GUARD_SQL } from './community-order-category-guard.mjs';

const now = Date.parse('2026-11-28T12:00:00Z');
const original = (overrides = {}) => ({
  uniqid: 'source', provider: 'community', status: 'INVITES PAUSED', service: 'COMMUNITY-OFFLINE',
  amount: 3, added: 1, serverId: '123456789012345678', serverName: 'Old server',
  customBot: true, poolBotId: 'bot', botApplicationId: 'bot', botName: 'Peach', delay: 60, speedProfile: 'custom',
  createdAt: '2026-11-01T12:00:00Z', expiredAt: '2026-12-01T12:00:00Z',
  categoryId: 'offline', categoryName: 'Offline', categoryIsPeriodic: true,
  categoryAllocations: [{ allocationId: 'first', categoryId: 'offline', amount: 2, added: 1, isPeriodic: true, expiredAt: '2026-12-01T12:00:00Z' },
    { allocationId: 'second', categoryId: 'offline', amount: 1, added: 0, isPeriodic: true, expiredAt: '2026-12-15T12:00:00Z' }],
  reactionRequests: [{ id: 'old-request' }], reactionDailyLimit: 500,
  communityResults: [
    { discordUserId: '111111111111111111', allocationId: 'first', state: 'joined', completedAt: '2026-11-01', membershipStatus: 'present' },
    { discordUserId: '222222222222222222', allocationId: 'first', state: 'queued', reactionState: 'pending', reactionEmoji: 'x' },
    { discordUserId: '333333333333333333', allocationId: 'second', state: 'queued' }
  ], ...overrides
});
const destination = { serverInfo: { guildId: '987654321098765432', guildName: 'New server' }, inviteValue: 'https://discord.gg/new', config: { clientId: 'bot', botToken: 'test-secret', orderBotId: 'source' } };

test('only queued members move; original dates and separate purchased portions survive chained transfers', () => {
  const source = original();
  const plan = planCommunityDeliveryTransfer(source, destination, 'next', now);
  assert.equal(plan.order.amount, 2); assert.equal(plan.order.added, 0);
  assert.equal(plan.order.expiredAt, source.expiredAt);
  assert.deepEqual(plan.order.categoryAllocations.map(item => [item.allocationId, item.amount, item.expiredAt]), [
    ['first', 1, '2026-12-01T12:00:00Z'], ['second', 1, '2026-12-15T12:00:00Z']
  ]);
  assert.equal(plan.order.createdAt, '2026-11-28T12:00:00.000Z');
  assert.equal(plan.order.supportStartedAt, source.createdAt);
  assert.deepEqual(plan.source.communityResults[0], source.communityResults[0]);
  assert.deepEqual(plan.source.communityResults.map(item => item.state), ['joined', 'cancelled', 'cancelled']);
  assert.equal(plan.source.status, 'PARTIAL'); assert.equal(plan.source.amount, 3);
  assert.deepEqual(plan.order.reactionRequests, []); assert.equal(plan.order.reactionDailyLimit, 0);
  assert.equal(plan.order.communityResults[0].reactionState, undefined);
  assert.equal(source.communityResults[1].state, 'queued');
  const again = planCommunityDeliveryTransfer(plan.order, { ...destination, serverInfo: { guildId: source.serverId, guildName: 'Third' } }, 'third', now + 1000, ['WAITING']);
  assert.equal(again.order.expiredAt, source.expiredAt); assert.equal(again.order.supportStartedAt, source.createdAt);
  assert.equal(again.source.status, 'CANCELLED');
});

test('active joins, expired allocations, duplicate slots, no queued members and same-server transfers are rejected', () => {
  for (const source of [original({ status: 'PROCESS' }), original({ status: 'COMPLETED' }),
    original({ communityResults: [{ state: 'joining' }, { state: 'queued' }] }),
    original({ categoryAllocations: [{ allocationId: 'first', isPeriodic: true, expiredAt: '2026-11-20' }] }),
    original({ communityResults: [{ state: 'joined' }] })]) assert.equal(getCommunityDeliveryTransfer(source, now).allowed, false);
  assert.throws(() => planCommunityDeliveryTransfer(original(), { serverInfo: { guildId: original().serverId } }, 'next', now), /different/);
  const repeated = original(); repeated.communityResults[2].discordUserId = repeated.communityResults[1].discordUserId;
  assert.throws(() => planCommunityDeliveryTransfer(repeated, destination, 'next', now), /refreshed/);
});

test('only Invites paused is enabled by default; selected statuses retain the delivery safety gates', () => {
  for (const status of ['WAITING', 'PAUSED', 'ERROR', 'PARTIAL']) {
    const order = original({ status });
    assert.equal(getCommunityDeliveryTransfer(order, now).statusAllowed, false);
    assert.throws(() => planCommunityDeliveryTransfer(order, destination, 'next', now), /not enabled/);
    assert.equal(getCommunityDeliveryTransfer(order, now, [status]).allowed, true);
    assert.equal(planCommunityDeliveryTransfer(order, destination, 'next', now, [status]).order.expiredAt, order.expiredAt);
  }
  assert.equal(getCommunityDeliveryTransfer(original(), now).allowed, true);
  assert.equal(getCommunityDeliveryTransfer(original(), now, []).statusAllowed, false);
  assert.equal(getCommunityDeliveryTransfer(original({ status: 'PROCESS' }), now, ['PROCESS']).allowed, false);
  assert.equal(getCommunityDeliveryTransfer(original({ status: 'PAUSED', communityResults: [{ state: 'queued' }, { state: 'joining' }] }), now, ['PAUSED']).allowed, false);
});

let PGlite;
try { ({ PGlite } = await import(new URL('../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js', import.meta.url))); } catch { /* same isolated runtime as category guard tests */ }
test('real database transaction preserves grants, returns the same order on retries, and rolls back all partial writes', { skip: !PGlite }, async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE tracked_orders (uniqid text PRIMARY KEY, payload jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    CREATE TABLE community_order_worker_leases (order_id text PRIMARY KEY, expires_at timestamptz);
    CREATE TABLE community_oauth_joins (discord_user_id text, guild_id text, reserved_order_id text);
    CREATE TABLE community_order_bot_credentials (order_id text, discord_user_id text, encrypted_value text, PRIMARY KEY (order_id, discord_user_id));
    CREATE TABLE app_settings (setting_key text PRIMARY KEY, encrypted_value text);`);
  await db.exec(COMMUNITY_ORDER_CATEGORY_GUARD_SQL);
  await db.exec(COMMUNITY_DELIVERY_TRANSFER_GUARD_SQL);
  const initial = original({ expiredAt: '2099-12-01', categoryAllocations: [] });
  await db.query('INSERT INTO tracked_orders (uniqid,payload) VALUES ($1,$2)', [initial.uniqid, JSON.stringify(initial)]);
  await db.query('INSERT INTO community_order_bot_credentials VALUES ($1,$2,$3)', ['source', initial.communityResults[1].discordUserId, 'encrypted-grant']);
  let nextId = 'next', injectFailure = false, activationCount = 0, disableDuringResolve = false;
  let transferSettings = { statuses: ['INVITES PAUSED'] };
  const pool = { query: (...args) => db.query(...args), connect: async () => ({
    query: async (sql, args) => {
      if (injectFailure && sql.startsWith('UPDATE tracked_orders')) throw new Error('write failed');
      return db.query(sql, args);
    }, release() {}
  }) };
  const handler = createCommunityDeliveryTransferHandler({ pool, makeId: () => nextId,
    readSettings: async () => transferSettings,
    resolveDestination: async () => { if (disableDuringResolve) transferSettings = { statuses: [] }; return destination; },
    prepareStock: async (client, order, target, ids) => { for (const id of ids) await client.query('INSERT INTO community_oauth_joins VALUES ($1,$2,NULL)', [id, target.serverInfo.guildId]); },
    saveBot: (client, config) => client.query('INSERT INTO app_settings VALUES ($1,$2)', [config.orderBotId, JSON.stringify(config)]),
    sanitize: order => { assert.equal(order.botToken, undefined); return order; }, activate: async () => { activationCount++; }
  });
  async function invoke(id = 'source') {
    const res = { set() { return this; }, json(body) { this.body = body; return this; } };
    let error;
    await handler({ params: { uniqid: id }, body: { invite: destination.inviteValue } }, res, err => { error = err; });
    return { body: res.body, error };
  }
  // An in-flight worker must prevent a split even if the status already says paused.
  await db.query("INSERT INTO community_order_worker_leases VALUES ('source',now()+interval '1 minute')");
  assert.match((await invoke()).error.message, /still stopping/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM tracked_orders')).rows[0].count, 1);
  await db.exec('DELETE FROM community_order_worker_leases');
  transferSettings = { statuses: [] };
  assert.match((await invoke()).error.message, /not enabled/);
  transferSettings = { statuses: ['INVITES PAUSED'] }; disableDuringResolve = true;
  assert.match((await invoke()).error.message, /not enabled/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM tracked_orders')).rows[0].count, 1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM community_oauth_joins')).rows[0].count, 0);
  transferSettings = { statuses: ['INVITES PAUSED'] }; disableDuringResolve = false;
  const result = await invoke(); assert.equal(result.error, undefined); assert.equal(result.body.monitorPath, '/monitor/next');
  // Disabling new transfers must still allow a lost response to recover its receipt.
  transferSettings = { statuses: [] };
  assert.equal((await invoke()).body.order.uniqid, 'next'); assert.equal(activationCount, 1);
  transferSettings = { statuses: ['INVITES PAUSED'] };
  const saved = (await db.query("SELECT payload FROM tracked_orders WHERE uniqid='source'")).rows[0].payload;
  assert.equal(saved.remainingTransfer.amount, 2);
  assert.equal((await db.query("SELECT encrypted_value FROM community_order_bot_credentials WHERE order_id='next'")).rows[0].encrypted_value, 'encrypted-grant');
  assert.equal((await db.query("SELECT encrypted_value FROM app_settings WHERE setting_key='next'")).rows[0].encrypted_value.includes('"orderBotId":"next"'), true);
  assert.equal((await db.query('SELECT DISTINCT reserved_order_id FROM community_oauth_joins')).rows[0].reserved_order_id, 'next');
  // A stale worker cannot erase the receipt or requeue cancelled members.
  await db.query("UPDATE tracked_orders SET payload=$1 WHERE uniqid='source'", [JSON.stringify(initial)]);
  const guarded = (await db.query("SELECT payload FROM tracked_orders WHERE uniqid='source'")).rows[0].payload;
  assert.equal(guarded.remainingTransfer.orderId, 'next'); assert.equal(guarded.status, 'PARTIAL');
  assert.equal(guarded.communityResults[1].state, 'cancelled');
  // A shorter stale snapshot must not discard the transferred cancellation audit.
  await db.query("UPDATE tracked_orders SET payload=$1 WHERE uniqid='source'", [JSON.stringify({ ...initial, communityResults: initial.communityResults.slice(0, 1) })]);
  const restored = (await db.query("SELECT payload FROM tracked_orders WHERE uniqid='source'")).rows[0].payload;
  assert.deepEqual(restored.communityResults, guarded.communityResults);
  // Delivered-member checks/support edits must still save after transfer.
  guarded.communityResults[0].membershipStatus = 'removed'; guarded.expiredAt = '2100-01-01';
  await db.query("UPDATE tracked_orders SET payload=$1 WHERE uniqid='source'", [JSON.stringify(guarded)]);
  assert.equal((await db.query("SELECT payload FROM tracked_orders WHERE uniqid='source'")).rows[0].payload.communityResults[0].membershipStatus, 'removed');
  // Source cancellation failure rolls back the new order, bot and copied stock.
  const second = { ...initial, uniqid: 'second' };
  await db.query('INSERT INTO tracked_orders (uniqid,payload) VALUES ($1,$2)', ['second', JSON.stringify(second)]);
  injectFailure = true; nextId = 'rolled-back';
  assert.match((await invoke('second')).error.message, /write failed/);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM tracked_orders WHERE uniqid='rolled-back'")).rows[0].count, 0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM app_settings WHERE setting_key='rolled-back'")).rows[0].count, 0);
  assert.equal((await db.query("SELECT payload FROM tracked_orders WHERE uniqid='second'")).rows[0].payload.communityResults[1].state, 'queued');
  await db.close();
});

test('a real stale delivery worker stops before any Discord join after a transfer', async () => {
  const source = fs.readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('index.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const worker = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runCommunityOrder');
  const progress = worker.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'saveCommunityProgress');
  let rolledBack = false;
  const currentPayload = planCommunityDeliveryTransfer(original(), destination, 'next', now).source;
  const scope = { order: original(), pool: { connect: async () => ({
    query: async sql => { if (sql.startsWith('SELECT payload')) return { rows: [{ payload: currentPayload }] }; if (sql === 'ROLLBACK') rolledBack = true; return {}; }, release() {}
  }) } };
  vm.runInNewContext(`${progress.getText(ast)}; this.save = saveCommunityProgress;`, scope);
  assert.equal(await scope.save(original()), false); assert.equal(rolledBack, true);
});

test('a transferred cancellation cannot be replaced using an old non-Live check', () => {
  const source = fs.readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('index.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const eligible = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isCommunityOnlinerReplacementEligible');
  const scope = {};
  vm.runInNewContext(`${eligible.getText(ast)}; this.eligible = isCommunityOnlinerReplacementEligible;`, scope);
  assert.equal(scope.eligible(original(), { state: 'cancelled', transferredOrderId: 'next', onlinerLive: false, onlinerCheckedAt: new Date().toISOString() }), false);
});
