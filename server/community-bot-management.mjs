import crypto from "node:crypto";

export function createManagedBotResolver({ getSharedConfig, loadPoolConfig }) {
  return async clientId => {
    const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
    if (!/^\d{16,22}$/.test(String(clientId || ""))) throw fail("A valid bot application is required.", 400);
    const shared = await getSharedConfig();
    const config = clientId === shared.clientId ? shared : { ...await loadPoolConfig(clientId), guildId: shared.guildId };
    if (config.clientId !== clientId || !config.botToken) throw fail("Configure this bot before managing it.", 409);
    return { ...config, configured: true };
  };
}

export function botGatewayIdentify(account, presence) {
  // https://github.com/discord/discord-api-docs/blob/main/developers/events/gateway-events.mdx#identify
  return { op: 2, d: { token: account.botToken, intents: 0,
    properties: { os: process.platform, browser: "Pulcip Onliner", device: "Pulcip Onliner" },
    presence: { ...presence, activities: [] }, compress: false } };
}

export function safeBotConnectionError(message, account) {
  let value = String(message || "");
  for (const secret of [account.botToken, account.proxyUrl]) {
    if (secret) value = value.split(secret).join("[redacted]");
  }
  return value.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@").slice(0, 600) || null;
}

export function createBotOnlinerManagement({ resolveBot, getConfig, saveConfig, selectProxy, normalize, start, snapshot, limit = 3000 }) {
  let connecting = false;
  const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
  async function status(clientIds) {
    const current = await getConfig();
    const ids = new Set(clientIds);
    const accounts = current.accounts.filter(account => ids.has(account.communityBotClientId));
    const state = accounts.length ? await snapshot({ ...current, accounts }) : null;
    return { bots: accounts.map(account => {
      const runtime = state?.accounts?.find(item => item.id === account.id);
      const connectionState = !current.enabled ? "disabled" : state?.worker?.connectionPaused ? "paused"
        : runtime?.connectionState || "disconnected";
      return { clientId: account.communityBotClientId, linked: true, state: connectionState,
        lastError: connectionState === "connected" ? null : safeBotConnectionError(runtime?.lastError, account) };
    }) };
  }
  async function connect(clientId) {
    if (connecting) throw fail("A bot connection is already being saved. Try again shortly.");
    connecting = true;
    try {
      const bot = await resolveBot(clientId);
      const current = await getConfig();
      const existing = current.accounts.find(account => account.communityBotClientId === bot.clientId || account.botToken === bot.botToken);
      if (!existing && current.accounts.length >= limit) throw fail("Onliner capacity reached. Remove a profile before connecting this bot.");
      const proxyUrl = existing?.proxyUrl || selectProxy(current);
      if (!proxyUrl) throw fail("Add at least one proxy to the Onliner proxy pool first.");
      const account = { ...existing, id: existing?.id || crypto.randomUUID(), botToken: bot.botToken, proxyUrl,
        isBot: true, communityBotClientId: bot.clientId, connectionRevision: crypto.randomUUID(), richPresenceEnabled: false };
      const candidate = normalize({ ...current, accounts: existing
        ? current.accounts.map(item => item.id === existing.id ? account : item) : [...current.accounts, account] });
      await saveConfig(candidate);
      await start(candidate, candidate.accounts.find(item => item.id === account.id));
      return { linked: true, enabled: Boolean(candidate.enabled), clientId: bot.clientId };
    } finally { connecting = false; }
  }
  return { connect, status };
}

export function registerBotOnlinerManagement(app, requireSession, service) {
  app.get("/api/community/bots/onliner", requireSession, async (req, res, next) => {
    try {
      const ids = String(req.query.clientIds || "").split(",").filter(id => /^\d{16,22}$/.test(id)).slice(0, 200);
      res.set("Cache-Control", "no-store").json(await service.status(ids));
    } catch (error) { next(error); }
  });
  app.post("/api/community/bots/:clientId/onliner", requireSession, async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json(await service.connect(req.params.clientId)); }
    catch (error) { next(error); }
  });
}
