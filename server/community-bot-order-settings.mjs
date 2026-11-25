const key = "community_bot_new_orders";
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export function createBotOrderSettings({ load, save, getConfig, bots }) {
  async function read(base) {
    base ??= await getConfig();
    const raw = await load(key);
    const stored = raw ? JSON.parse(raw) : null;
    return { defaultClientId: base.clientId || "", defaultUseForNewOrders: Boolean(stored?.clientId === base.clientId && stored?.useForNewOrders === true) };
  }
  async function update(input) {
    if (!input || typeof input.clientId !== "string" || !/^\d{16,22}$/.test(input.clientId) || typeof input.useForNewOrders !== "boolean") throw fail("Choose a bot and whether to use it for new orders.");
    const base = await getConfig();
    if (input.clientId === base.clientId) {
      if (!base.configured) throw fail("Configure the default bot before using it for new orders.", 409);
      await save(key, JSON.stringify({ clientId: input.clientId, useForNewOrders: input.useForNewOrders }));
    } else await bots.setEnabled(input.clientId, input.useForNewOrders);
    return { clientId: input.clientId, useForNewOrders: input.useForNewOrders };
  }
  return { read, update };
}

export function registerBotOrderSettings(app, requireSession, service) {
  const route = action => async (req, res, next) => { try { res.set("Cache-Control", "no-store").json(await action(req)); } catch (error) { next(error); } };
  app.get("/api/community/bots/order-settings", requireSession, route(() => service.read()));
  app.put("/api/community/bots/order-settings", requireSession, route(req => service.update(req.body)));
}
