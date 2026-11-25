export const ORDER_BOT_STORAGE_SQL = `
CREATE TABLE IF NOT EXISTS community_order_bot_credentials (
  order_id TEXT NOT NULL REFERENCES tracked_orders(uniqid) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  PRIMARY KEY (order_id, discord_user_id)
);`;

export function createOrderBotService({ pool, request, encrypt, decrypt, authorize, refresh, loadPoolConfig, withPoolGrantLock,
  requestIdentity = accessToken => request("oauth2/@me", { headers: { Authorization: `Bearer ${accessToken}` } }) }) {
  const pending = new Map();
  const key = id => `community_order_bot:${id}`;
  const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

  async function inspect(botToken, guildId = "") {
    botToken = String(botToken ?? "").trim();
    if (botToken.length < 20 || botToken.length > 4096) throw fail("Enter a valid bot token.");
    const app = await request("oauth2/applications/@me", { headers: { Authorization: `Bot ${botToken}` } });
    if (app.response.status === 429) throw fail("Discord is limiting bot checks. Try again later.", 429);
    if (!app.response.ok || !/^\d{16,22}$/.test(String(app.payload?.id ?? ""))) throw fail("Bot token could not be verified.");
    let guild = null;
    if (/^\d{16,22}$/.test(guildId)) {
      const result = await request(`guilds/${guildId}?with_counts=true`, { headers: { Authorization: `Bot ${botToken}` } });
      if (result.response.ok) guild = result.payload;
    }
    return { clientId: String(app.payload.id), botName: String(app.payload.bot?.username ?? app.payload.name ?? "Discord bot"),
      guildId, guildName: guild?.name ?? null, botInGuild: Boolean(guild) };
  }

  async function prepare(input, base, { orderId, guildId, redirectUri }) {
    if (base.configured === false) throw fail("Configure Members Stock before creating an order with a new bot.");
    if (!input || typeof input !== "object") throw fail("Enter the new bot credentials.");
    const clientSecret = String(input.clientSecret ?? "").trim();
    if (!clientSecret || clientSecret.length > 4096) throw fail("Enter the new bot's client secret.");
    const botToken = String(input.botToken ?? "").trim();
    const identity = await inspect(botToken, guildId);
    if (identity.clientId === base.clientId) throw fail("New bot must use a different Discord application from the shared Members bot.");
    const verification = await request("oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: identity.clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "applications.commands.update" }).toString() });
    if (verification.response.status === 429) throw fail("Discord is limiting OAuth checks. Try again later.", 429);
    if (!verification.response.ok) throw fail("The new bot's client secret could not be verified.");
    return { ...identity, clientSecret, botToken, guildId: guildId || base.guildId, orderBotId: orderId, redirectUri,
      stockGuildId: base.guildId, configured: true, missing: [] };
  }

  async function save(client, config) {
    await client.query(`INSERT INTO app_settings (setting_key, encrypted_value, updated_at) VALUES ($1, $2, NOW())
      ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
    [key(config.orderBotId), encrypt(JSON.stringify(config))]);
  }

  async function load(order, base) {
    if (!order?.customBot) return base;
    const result = await pool.query("SELECT encrypted_value FROM app_settings WHERE setting_key = $1 LIMIT 1", [key(order.uniqid)]);
    if (!result.rows[0]) throw Object.assign(new Error("This order's bot configuration is missing."), { statusCode: 409 });
    const config = JSON.parse(decrypt(result.rows[0].encrypted_value));
    if (config.orderBotId !== order.uniqid || config.clientId !== order.botApplicationId) throw fail("The order bot configuration does not match this order.");
    const pooled = config.poolBotId ? await loadPoolConfig(config.poolBotId) : {};
    if (config.poolBotId && config.poolBotId !== config.clientId) throw fail("The order pool bot does not match its application.");
    return { ...config, ...pooled, guildId: order.serverId, stockGuildId: config.stockGuildId || base.guildId };
  }

  async function token(config, member, { force = false, allowAuthorize = true } = {}) {
    allowAuthorize = allowAuthorize && config.oauthOnly !== true;
    const userId = String(member?.discord_user_id ?? "");
    if (!/^\d{16,22}$/.test(userId)) throw fail("A valid member is required for bot authorization.");
    const pooled = Boolean(config.poolBotId);
    const grantId = config.poolBotId || config.orderBotId;
    const table = pooled ? "community_bot_pool_credentials" : "community_order_bot_credentials";
    const keyColumn = pooled ? "client_id" : "order_id";
    const jobKey = `${table}:${grantId}:${userId}`;
    if (pending.has(jobKey)) return pending.get(jobKey);
    const run = async () => {
      const result = await pool.query(`SELECT encrypted_value FROM ${table} WHERE ${keyColumn} = $1 AND discord_user_id = $2`, [grantId, userId]);
      const stored = result.rows[0] ? JSON.parse(decrypt(result.rows[0].encrypted_value)) : null;
      if (stored && stored.clientId !== config.clientId) throw fail("Member authorization belongs to another application.");
      const reuseUntil = Date.now() + (config.oauthOnly && !stored?.refreshToken ? 0 : 48 * 60 * 60 * 1000);
      if (!force && stored?.accessToken && Date.parse(stored.expiresAt) > reuseUntil) return stored.accessToken;
      let oauth;
      if (stored?.refreshToken) {
        try { oauth = await refresh(config, stored.refreshToken); }
        catch (error) {
          if (!allowAuthorize || !error.oauthRefreshInvalid) throw error;
          oauth = await authorize(config, member);
        }
      }
      else {
        if (!allowAuthorize) throw Object.assign(new Error("This member has not authorized the order bot."), { oauthAccessInvalid: true });
        oauth = await authorize(config, member);
      }
      const identity = await requestIdentity(oauth.accessToken, oauth);
      if (identity.response.status === 429) throw fail("Discord is limiting order bot authorizations. Wait before resuming delivery.", 429);
      if (!identity.response.ok || String(identity.payload?.user?.id) !== userId || String(identity.payload?.application?.id) !== config.clientId
        || !Array.isArray(identity.payload?.scopes) || !identity.payload.scopes.includes("guilds.join")) throw fail("Discord returned an authorization for a different member or application, or without guilds.join.");
      await pool.query(`INSERT INTO ${table} (${keyColumn}, discord_user_id, encrypted_value) VALUES ($1, $2, $3)
        ON CONFLICT (${keyColumn}, discord_user_id) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value`,
      [grantId, userId, encrypt(JSON.stringify({ accessToken: oauth.accessToken, refreshToken: oauth.refreshToken, expiresAt: oauth.expiresAt, clientId: config.clientId }))]);
      return oauth.accessToken;
    };
    const job = (pooled && withPoolGrantLock ? withPoolGrantLock(grantId, userId, run) : run()).finally(() => pending.delete(jobKey));
    pending.set(jobKey, job);
    return job;
  }
  return { inspect, prepare, save, load, token };
}
