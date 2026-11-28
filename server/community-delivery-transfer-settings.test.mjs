import test from 'node:test';
import assert from 'node:assert/strict';
import { registerDeliveryTransferSettings, validateDeliveryTransferSettings } from './community-delivery-transfer-settings.mjs';

test('settings accept only safe statuses and an empty selection, with canonical deduplication', () => {
  assert.deepEqual(validateDeliveryTransferSettings({ statuses: ['PARTIAL', 'INVITES PAUSED', 'PARTIAL'] }), { statuses: ['INVITES PAUSED', 'PARTIAL'] });
  assert.deepEqual(validateDeliveryTransferSettings({ statuses: [] }), { statuses: [] });
  for (const value of [null, {}, { statuses: 'INVITES PAUSED' }, { statuses: ['PROCESS'] }, { statuses: ['COMPLETED'] }, { statuses: ['CANCELLED'] }, { statuses: [null] }]) {
    assert.throws(() => validateDeliveryTransferSettings(value), { statusCode: 400 });
  }
});

test('authenticated settings persist across readers and invalid writes preserve the saved policy', async () => {
  const routes = new Map();
  const requireSession = () => {};
  let stored = null;
  const io = {
    requireSession,
    load: async key => { assert.equal(key, 'community_delivery_transfer'); return stored; },
    save: async (key, value) => { assert.equal(key, 'community_delivery_transfer'); stored = value; }
  };
  const app = Object.fromEntries(['get', 'put'].map(method => [method, (path, auth, handler) => { assert.equal(auth, requireSession); routes.set(`${method} ${path}`, handler); }]));
  const read = registerDeliveryTransferSettings(app, io);
  assert.deepEqual(await read(), { statuses: ['INVITES PAUSED'] });
  const secondRead = registerDeliveryTransferSettings({ get() {}, put() {} }, io);
  async function invoke(method, body) {
    const res = { set(name, value) { assert.equal(name, 'Cache-Control'); assert.equal(value, 'no-store'); return this; }, json(value) { this.body = value; return this; } };
    let error;
    await routes.get(`${method} /api/settings/delivery-transfer`)({ body }, res, err => { error = err; });
    return { body: res.body, error };
  }
  assert.deepEqual((await invoke('get')).body, { statuses: ['INVITES PAUSED'] });
  assert.deepEqual((await invoke('put', { statuses: ['PAUSED', 'ERROR'] })).body, { statuses: ['PAUSED', 'ERROR'] });
  assert.deepEqual(await secondRead(), { statuses: ['PAUSED', 'ERROR'] });
  assert.equal((await invoke('put', { statuses: ['PROCESS'] })).error.statusCode, 400);
  assert.deepEqual(await read(), { statuses: ['PAUSED', 'ERROR'] });
  assert.deepEqual((await invoke('put', { statuses: [] })).body, { statuses: [] });
  assert.deepEqual(await secondRead(), { statuses: [] });
});
