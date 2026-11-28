import { COMMUNITY_DELIVERY_TRANSFER_STATUSES, COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES } from '../shared/community-delivery-transfer.mjs';

export function validateDeliveryTransferSettings(value) {
  if (!Array.isArray(value?.statuses) || value.statuses.some(status => !COMMUNITY_DELIVERY_TRANSFER_STATUSES.includes(status))) {
    throw Object.assign(new Error('Select valid Members delivery statuses.'), { statusCode: 400 });
  }
  return { statuses: COMMUNITY_DELIVERY_TRANSFER_STATUSES.filter(status => value.statuses.includes(status)) };
}

export function registerDeliveryTransferSettings(app, { requireSession, load, save }) {
  const read = async () => {
    const stored = await load('community_delivery_transfer');
    return stored ? validateDeliveryTransferSettings(JSON.parse(stored)) : { statuses: [...COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES] };
  };
  app.get('/api/settings/delivery-transfer', requireSession, async (_req, res, next) => {
    try { res.set('Cache-Control', 'no-store').json(await read()); } catch (error) { next(error); }
  });
  app.put('/api/settings/delivery-transfer', requireSession, async (req, res, next) => {
    try {
      const settings = validateDeliveryTransferSettings(req.body);
      await save('community_delivery_transfer', JSON.stringify(settings));
      res.set('Cache-Control', 'no-store').json(settings);
    } catch (error) { next(error); }
  });
  return read;
}
