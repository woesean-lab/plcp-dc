import crypto from "node:crypto";

export const BOT_GATEWAY_PROTOCOL_VERSION = 1;
export function managedWorkerStatus(row, now = Date.now()) {
  return {
    online: row?.status === "online" && now - Date.parse(row.heartbeat_at) < 15_000,
    botGatewaySupported: Boolean(row?.worker_id && row.protocol_worker_id === row.worker_id && Number(row.protocol_version) >= BOT_GATEWAY_PROTOCOL_VERSION),
    paused: row?.connection_paused === true
  };
}
export function createManagedBotStarter({ ownsWorker, reconnect, setCurrentConfig, enqueue }) {
  return async (config, account) => {
    if (!config.enabled) return;
    if (ownsWorker()) {
      reconnect(config, account);
      setCurrentConfig(config);
    } else {
      await enqueue({ accountId: account.id, connectionRevision: account.connectionRevision });
    }
  };
}
const workerProblem = worker => !worker.online ? "The Onliner worker is offline. Start the Onliner service before reconnecting this bot."
  : !worker.botGatewaySupported ? "This Onliner worker has not reported support for the current bot Gateway connection. Update the Onliner worker to the same version as the web service."
    : worker.paused ? "Gateway connections are paused. Continue Onliner before reconnecting this bot." : null;

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
  // GUILDS is the only event intent needed for the Onliner server counter.
  return { op: 2, d: { token: account.botToken, intents: 1,
    properties: { os: process.platform, browser: "Pulcip Onliner", device: "Pulcip Onliner" },
    presence: { ...presence, activities: [] }, compress: false } };
}

export function managedOnlinerAccounts(config, bots) {
  const byToken = new Map(bots.filter(bot => bot?.botToken && /^\d{16,22}$/.test(bot.clientId)).map(bot => [bot.botToken, bot.clientId]));
  return { ...config, accounts: config.accounts.map(account => {
    const clientId = byToken.get(account.botToken);
    return clientId ? { ...account, isBot: true, communityBotClientId: clientId, richPresenceEnabled: false } : account;
  }) };
}

export function onlinerGatewayIdentify(account, presence, { properties, clientState }) {
  if (account.isBot === true || /^\d{16,22}$/.test(String(account.communityBotClientId || ""))) return botGatewayIdentify(account, presence);
  return { op: 2, d: { token: account.botToken, properties, presence, capabilities: 16381, compress: false, client_state: clientState } };
}

export function safeBotConnectionError(message, account) {
  let value = String(message || "");
  for (const secret of [account.botToken, account.proxyUrl]) {
    if (secret) value = value.split(secret).join("[redacted]");
  }
  return value.replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, "$1[redacted]@").slice(0, 600) || null;
}

export function createBotOnlinerManagement({ resolveBot, getConfig, saveConfig, selectProxy, normalize, start, snapshot, getWorkerStatus, limit = 3000 }) {
  let connecting = false;
  const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
  async function status(clientIds) {
    const current = await getConfig();
    const ids = new Set(clientIds);
    const accounts = current.accounts.filter(account => ids.has(account.communityBotClientId));
    const state = accounts.length ? await snapshot({ ...current, accounts }) : null;
    const worker = current.enabled && accounts.length && getWorkerStatus ? await getWorkerStatus() : null;
    return { bots: accounts.map(account => {
      const runtime = state?.accounts?.find(item => item.id === account.id);
      let connectionState = !current.enabled ? "disabled" : state?.worker?.connectionPaused ? "paused"
        : runtime?.connectionState || "disconnected";
      let lastError = connectionState === "connected" ? null : safeBotConnectionError(runtime?.lastError, account);
      if (worker) {
        const problem = workerProblem(worker);
        if (problem && connectionState !== "connected") {
          connectionState = !worker.online ? "disconnected" : worker.paused ? "paused" : "error";
          lastError = lastError ? `${lastError} ${problem}` : problem;
        }
        else if (worker.botGatewaySupported && account.connectionRevision && runtime?.connectionRevision !== account.connectionRevision) {
          const waiting = Date.now() - Date.parse(account.connectionRequestedAt) < 30_000;
          connectionState = waiting ? "connecting" : "error";
          lastError = waiting ? null : "This bot's reconnect request has not been acknowledged. Check its Onliner connection logs.";
        }
      }
      return { clientId: account.communityBotClientId, linked: true, state: connectionState,
        lastError };
    }) };
  }
  async function connect(clientId) {
    if (connecting) throw fail("A bot connection is already being saved. Try again shortly.");
    connecting = true;
    try {
      const bot = await resolveBot(clientId);
      const current = await getConfig();
      if (current.enabled && getWorkerStatus) {
        const worker = await getWorkerStatus();
        const problem = !worker.online || worker.paused ? workerProblem(worker) : null;
        if (problem) throw fail(problem);
      }
      const existing = current.accounts.find(account => account.communityBotClientId === bot.clientId || account.botToken === bot.botToken);
      if (!existing && current.accounts.length >= limit) throw fail("Onliner capacity reached. Remove a profile before connecting this bot.");
      const proxyUrl = existing?.proxyUrl || selectProxy(current);
      if (!proxyUrl) throw fail("Add at least one proxy to the Onliner proxy pool first.");
      const account = { ...existing, id: existing?.id || crypto.randomUUID(), botToken: bot.botToken, proxyUrl,
        isBot: true, communityBotClientId: bot.clientId, connectionRevision: crypto.randomUUID(), connectionRequestedAt: new Date().toISOString(), richPresenceEnabled: false };
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
