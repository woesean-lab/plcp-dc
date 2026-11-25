import crypto from "node:crypto";

export const BOT_POOL_STORAGE_SQL = `
CREATE TABLE IF NOT EXISTS community_bot_pool (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_assigned_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS community_bot_pool_reservations (
  order_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES community_bot_pool(client_id),
  amount INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS community_bot_pool_credentials (
  client_id TEXT NOT NULL REFERENCES community_bot_pool(client_id),
  discord_user_id TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  PRIMARY KEY (client_id, discord_user_id)
);
CREATE TABLE IF NOT EXISTS community_bot_pool_credential_leases (
  client_id TEXT NOT NULL REFERENCES community_bot_pool(client_id),
  discord_user_id TEXT NOT NULL,
  owner_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (client_id, discord_user_id)
);`;

const ACTIVE = "('NEW','WAITING','PROCESS','RECOVERING','PAUSED','INVITES PAUSED')";
const ORDER_METRICS = `COUNT(*) FILTER (WHERE UPPER(payload->>'status') IN ${ACTIVE}) AS active_orders,
    SUM(CASE WHEN UPPER(payload->>'status') IN ${ACTIVE} THEN
      GREATEST(COALESCE((payload->>'amount')::int,0) - COALESCE((payload->>'added')::int,0),0) ELSE 0 END) AS pending_members,
    COUNT(*) AS total_orders,
    SUM(GREATEST(COALESCE((payload->>'added')::int,0),0)) AS delivered_members`;
const metrics = row => ({ activeOrders: Number(row?.active_orders) || 0, pendingMembers: Number(row?.pending_members) || 0,
  totalOrders: Number(row?.total_orders) || 0, deliveredMembers: Number(row?.delivered_members) || 0 });

export async function loadBotDeliveryMetrics(pool, clientId, { includeLegacy = false } = {}) {
  const result = await pool.query(`SELECT ${ORDER_METRICS} FROM tracked_orders
    WHERE payload->>'provider'='community' AND COALESCE(payload->>'joinMethod','') <> 'directly'
      AND (payload->>'botApplicationId'=$1 OR ($2::boolean AND NULLIF(payload->>'botApplicationId','') IS NULL
        AND COALESCE(payload->>'customBot','false') <> 'true'))`, [clientId, includeLegacy]);
  return metrics(result.rows[0]);
}
export const BOT_POOL_LOAD_SQL = `SELECT b.*,
  COALESCE(work.active_orders, 0)::int AS active_orders,
  COALESCE(work.pending_members, 0)::int AS pending_members,
  COALESCE(work.total_orders, 0)::int AS total_orders,
  COALESCE(work.delivered_members, 0)::bigint AS delivered_members,
  COALESCE(leases.reservations, 0)::int AS reservations,
  COALESCE(leases.pending_members, 0)::int AS reserved_members
FROM community_bot_pool b
LEFT JOIN LATERAL (
  SELECT ${ORDER_METRICS}
  FROM tracked_orders WHERE payload->>'provider' = 'community' AND payload->>'botApplicationId' = b.client_id
    AND COALESCE(payload->>'joinMethod','') <> 'directly'
) work ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS reservations, SUM(amount) AS pending_members
  FROM community_bot_pool_reservations r WHERE r.client_id = b.client_id AND r.expires_at > NOW()
) leases ON TRUE`;

export function createCommunityBotPool({ pool, encrypt, decrypt, verify, getSharedConfig, getBotIdentity }) {
  const identities = new Map();
  async function identity(row) {
    if (!getBotIdentity) return null;
    const cached = identities.get(row.client_id);
    if (cached?.encrypted === row.encrypted_value && cached.expiresAt > Date.now()) return cached.value;
    const value = Promise.resolve().then(() => {
      const config = JSON.parse(decrypt(row.encrypted_value));
      if (config.clientId !== row.client_id) return null;
      return getBotIdentity(config);
    }).catch(() => null);
    if (identities.size >= 200) identities.delete(identities.keys().next().value);
    identities.set(row.client_id, { encrypted: row.encrypted_value, expiresAt: Date.now() + 60_000, value });
    return value;
  }
  const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
  const safe = row => ({ clientId: row.client_id, name: row.name, enabled: row.enabled,
    ...metrics(row), hasBotToken: true, hasClientSecret: true,
    createdAt: row.created_at, updatedAt: row.updated_at });

  async function list() {
    const result = await pool.query(`${BOT_POOL_LOAD_SQL} ORDER BY b.created_at, b.client_id`);
    const grants = await pool.query("SELECT client_id, encrypted_value FROM community_bot_pool_credentials");
    const counts = new Map();
    for (const grant of grants.rows) {
      const count = counts.get(grant.client_id) || { authorizedAccounts: 0, activeAccounts: 0, expiredAccounts: 0 };
      count.authorizedAccounts++;
      try {
        const value = JSON.parse(decrypt(grant.encrypted_value));
        if (value.accessToken && Date.parse(value.expiresAt) > Date.now()) count.activeAccounts++;
        else count.expiredAccounts++;
      } catch { count.expiredAccounts++; }
      counts.set(grant.client_id, count);
    }
    return Promise.all(result.rows.map(async row => {
      const bot = await identity(row);
      return { ...safe(row), avatarUrl: bot?.avatarUrl || null,
        ...(counts.get(row.client_id) || { authorizedAccounts: 0, activeAccounts: 0, expiredAccounts: 0 }) };
    }));
  }

  async function save(input, expectedId = null) {
    let previous = null;
    if (expectedId) {
      const result = await pool.query("SELECT * FROM community_bot_pool WHERE client_id = $1", [expectedId]);
      if (!result.rows[0]) throw fail("Pool bot not found.", 404);
      previous = JSON.parse(decrypt(result.rows[0].encrypted_value));
    }
    const shared = await getSharedConfig();
    const config = await verify({ botToken: input?.botToken || previous?.botToken, clientSecret: input?.clientSecret || previous?.clientSecret },
      { clientId: shared.clientId, guildId: shared.guildId }, { orderId: "pool-verification" });
    if (expectedId && config.clientId !== expectedId) throw fail("Replacement credentials must belong to the same Discord application.");
    const name = String(input?.name ?? config.botName).trim().slice(0, 100) || config.botName;
    const encrypted = encrypt(JSON.stringify({ clientId: config.clientId, botToken: config.botToken, clientSecret: config.clientSecret, botName: config.botName }));
    if (expectedId) {
      await pool.query("UPDATE community_bot_pool SET name = $2, encrypted_value = $3, updated_at = NOW() WHERE client_id = $1", [expectedId, name, encrypted]);
    } else {
      const inserted = await pool.query(`INSERT INTO community_bot_pool (client_id, name, encrypted_value) VALUES ($1,$2,$3)
        ON CONFLICT (client_id) DO NOTHING RETURNING client_id`, [config.clientId, name, encrypted]);
      if (!inserted.rowCount) throw fail("This application is already in the bot pool.", 409);
    }
    return list();
  }

  async function setEnabled(clientId, enabled) {
    if (typeof enabled !== "boolean") throw fail("Choose whether the pool bot is enabled.");
    const result = await pool.query("UPDATE community_bot_pool SET enabled = $2, updated_at = NOW() WHERE client_id = $1 RETURNING client_id", [clientId, enabled]);
    if (!result.rowCount) throw fail("Pool bot not found.", 404);
    return list();
  }

  async function grantUserIds(clientId = null, queryable = pool) {
    const result = await queryable.query(`SELECT g.client_id,g.discord_user_id,g.encrypted_value FROM community_bot_pool_credentials g
      JOIN community_bot_pool b ON b.client_id=g.client_id WHERE ($1::text IS NULL AND b.enabled=TRUE) OR g.client_id=$1`, [clientId]);
    return result.rows.flatMap(row => {
      try { const grant = JSON.parse(decrypt(row.encrypted_value));
        return grant.clientId === row.client_id && ((grant.accessToken && Date.parse(grant.expiresAt)>Date.now()) || grant.refreshToken) ? [row.discord_user_id] : [];
      } catch { return []; }
    });
  }

  async function acquire({ orderId, amount, base, redirectUri, stockAllocations, excludedUserIds = [], accountTokenOnly = false }) {
    if (base.configured === false) throw fail("Configure Members Stock before using the bot pool.", 409);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize assignments only for this short transaction, not during Discord network calls.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('community-bot-pool-assignment'))");
      await client.query("DELETE FROM community_bot_pool_reservations WHERE expires_at <= NOW()");
      const result = await client.query(`${BOT_POOL_LOAD_SQL}
        WHERE b.enabled = TRUE AND b.client_id <> $1
        ORDER BY COALESCE(work.pending_members,0) + COALESCE(leases.pending_members,0),
          COALESCE(work.active_orders,0) + COALESCE(leases.reservations,0),
          COALESCE(work.total_orders,0), b.last_assigned_at NULLS FIRST, b.created_at, b.client_id
        ${stockAllocations ? "" : "LIMIT 1"} FOR UPDATE OF b`, [base.clientId]);
      let bot = result.rows[0];
      if (stockAllocations) {
        if (!Array.isArray(stockAllocations) || !stockAllocations.length || stockAllocations.some(item => !item.categoryId || !Number.isInteger(item.amount) || item.amount<1)) throw fail("Choose valid stock allocations.");
        const stock = await client.query(`SELECT discord_user_id,stock_type,encrypted_account_token IS NOT NULL AS has_account_token
          FROM community_oauth_joins WHERE guild_id=$1 AND status='authorized' AND NOT(discord_user_id=ANY($2::text[]))`, [base.guildId,excludedUserIds]);
        bot = null;
        for (const candidate of result.rows) {
          const grants = new Set(accountTokenOnly ? [] : await grantUserIds(candidate.client_id,client));
          if (stockAllocations.every(allocation => stock.rows.filter(row => row.stock_type === allocation.categoryId && (row.has_account_token || grants.has(row.discord_user_id))).length >= allocation.amount)) { bot=candidate; break; }
        }
      }
      if (!bot) throw fail("No enabled pool bot has enough eligible accounts for this order. Authorize more stock accounts or enable another bot.", 409);
      const credentials = JSON.parse(decrypt(bot.encrypted_value));
      if (credentials.clientId !== bot.client_id) throw fail("Pool credentials belong to another application.");
      await client.query(`INSERT INTO community_bot_pool_reservations (order_id, client_id, amount, expires_at)
        VALUES ($1,$2,$3,NOW() + INTERVAL '10 minutes')`, [orderId, bot.client_id, amount]);
      await client.query("UPDATE community_bot_pool SET last_assigned_at = NOW() WHERE client_id = $1", [bot.client_id]);
      await client.query("COMMIT");
      return { ...credentials, botName: bot.name, poolBotId: bot.client_id, orderBotId: orderId,
        guildId: base.guildId, stockGuildId: base.guildId, redirectUri, configured: true, missing: [] };
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async function load(clientId) {
    // Disabled bots remain usable by their existing orders; they cannot receive new assignments.
    const result = await pool.query("SELECT encrypted_value FROM community_bot_pool WHERE client_id = $1", [clientId]);
    if (!result.rows[0]) throw fail("This order's pool bot is unavailable.", 409);
    const credentials = JSON.parse(decrypt(result.rows[0].encrypted_value));
    if (credentials.clientId !== clientId) throw fail("Pool credentials belong to another application.");
    return credentials;
  }

  async function release(orderId) { await pool.query("DELETE FROM community_bot_pool_reservations WHERE order_id = $1", [orderId]); }

  async function withGrantLock(clientId, userId, run) {
    const owner = crypto.randomUUID();
    let claimed = false;
    // Never hold a database connection while waiting for Discord authorization.
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await pool.query(`INSERT INTO community_bot_pool_credential_leases (client_id,discord_user_id,owner_token,expires_at)
        VALUES ($1,$2,$3,NOW() + INTERVAL '3 minutes')
        ON CONFLICT (client_id,discord_user_id) DO UPDATE SET owner_token = EXCLUDED.owner_token, expires_at = EXCLUDED.expires_at
        WHERE community_bot_pool_credential_leases.expires_at <= NOW() RETURNING owner_token`, [clientId,userId,owner]);
      if (result.rowCount) { claimed = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!claimed) throw fail("This member's bot authorization is already running. Wait before resuming delivery.", 429);
    const heartbeat = setInterval(() => {
      void pool.query("UPDATE community_bot_pool_credential_leases SET expires_at = NOW() + INTERVAL '3 minutes' WHERE client_id = $1 AND discord_user_id = $2 AND owner_token = $3", [clientId,userId,owner]).catch(() => {});
    }, 30_000);
    heartbeat.unref();
    try { return await run(); }
    finally {
      clearInterval(heartbeat);
      await pool.query("DELETE FROM community_bot_pool_credential_leases WHERE client_id = $1 AND discord_user_id = $2 AND owner_token = $3", [clientId,userId,owner]);
    }
  }
  return { list, save, setEnabled, acquire, release, load, withGrantLock, grantUserIds };
}

export function registerCommunityBotPool(app, requireSession, service) {
  const route = action => async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json({ bots: await action(req) }); } catch (error) { next(error); }
  };
  app.get("/api/community/bot-pool", requireSession, route(() => service.list()));
  app.post("/api/community/bot-pool", requireSession, route(req => service.save(req.body)));
  app.put("/api/community/bot-pool/:clientId", requireSession, route(req => service.save(req.body, req.params.clientId)));
  app.patch("/api/community/bot-pool/:clientId", requireSession, route(req => service.setEnabled(req.params.clientId, req.body?.enabled)));
}
