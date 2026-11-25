import crypto from "node:crypto";

export const BOT_SYNC_STORAGE_SQL = `CREATE TABLE IF NOT EXISTS community_bot_sync_jobs (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL,
  worker_token TEXT, lease_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_bot_sync_one_active ON community_bot_sync_jobs(client_id) WHERE status IN ('queued','running','paused');`;

export function createBotSync({ pool, getConfig, loadBot, decrypt, synchronize, legacy }) {
  let running = false;
  const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
  const safe = row => {
    if (!row) return null;
    const { memberIds, failedIds, guildId, redirectUri, isDefault, ...publicValue } = row.payload;
    return { id: row.id, clientId: row.client_id, status: row.status, ...publicValue };
  };
  async function configFor(clientId) {
    if (!/^\d{16,22}$/.test(String(clientId))) throw fail("Choose a configured bot.", 400);
    const base = await getConfig();
    if (!base.configured) throw fail("Configure Members Stock before syncing accounts.");
    const isDefault = clientId === base.clientId;
    const credentials = isDefault ? base : await loadBot(clientId);
    if (credentials.clientId !== clientId) throw fail("The bot configuration no longer matches this application.");
    return { ...credentials, clientId, guildId: base.guildId, isDefault, configured: true, ...(!isDefault ? { poolBotId: clientId } : {}) };
  }
  async function plan(clientId, onlyIds) {
    const config = await configFor(clientId);
    const records = await pool.query(`SELECT discord_user_id, encrypted_account_token, encrypted_access_token,
      encrypted_refresh_token, access_token_expires_at FROM community_oauth_joins WHERE guild_id=$1
      AND ($2::text[] IS NULL OR discord_user_id=ANY($2::text[])) ORDER BY sort_position, discord_user_id`, [config.guildId, onlyIds || null]);
    const grants = config.isDefault ? [] : (await pool.query("SELECT discord_user_id, encrypted_value FROM community_bot_pool_credentials WHERE client_id=$1", [clientId])).rows;
    const byUser = new Map(grants.map(grant => [grant.discord_user_id, grant.encrypted_value]));
    const ids = []; let upToDate = 0, unavailable = 0;
    for (const record of records.rows) {
      let access = false, refresh = false, expiry = 0;
      try {
        if (config.isDefault) {
          access = Boolean(record.encrypted_access_token); refresh = Boolean(record.encrypted_refresh_token); expiry = Date.parse(record.access_token_expires_at);
        } else if (byUser.has(record.discord_user_id)) {
          const grant = JSON.parse(decrypt(byUser.get(record.discord_user_id)));
          if (grant.clientId === clientId) { access = Boolean(grant.accessToken); refresh = Boolean(grant.refreshToken); expiry = Date.parse(grant.expiresAt); }
        }
      } catch { /* A stored account token can replace an unreadable grant. */ }
      if (access && expiry > Date.now() + 48 * 60 * 60 * 1000) upToDate++;
      else if (record.encrypted_account_token || refresh) ids.push(record.discord_user_id);
      else unavailable++;
    }
    return { config, ids, totalAccounts: records.rows.length, pending: ids.length, upToDate, unavailable };
  }
  async function preview(clientId) {
    const { config, ids, ...summary } = await plan(clientId);
    return summary;
  }
  async function latest(clientId) {
    const config = await configFor(clientId);
    if (!config.isDefault && legacy) {
      const job = await legacy.latest(clientId);
      if (job && ["queued", "running", "paused"].includes(job.status)) return { ...job, legacy: true };
    }
    return safe((await pool.query("SELECT * FROM community_bot_sync_jobs WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1", [clientId])).rows[0]);
  }
  async function start(clientId, input = {}, redirectUri) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Choose a valid sync action.", 400);
    if (input.retryFailed !== undefined && typeof input.retryFailed !== "boolean") throw fail("Choose a valid retry action.", 400);
    let onlyIds;
    if (input.retryFailed) {
      const previous = (await pool.query("SELECT * FROM community_bot_sync_jobs WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1", [clientId])).rows[0];
      if (!previous || !["completed", "cancelled"].includes(previous.status) || !previous.payload.failedIds?.length) throw fail("No failed accounts are available to retry.");
      onlyIds = previous.payload.failedIds;
    }
    const { config, ids, ...summary } = await plan(clientId, onlyIds);
    const occupied = await pool.query(`SELECT id FROM community_bot_sync_jobs WHERE client_id=$1 AND
      (status IN ('queued','running','paused') OR (worker_token IS NOT NULL AND lease_until>NOW()))`, [clientId]);
    if (occupied.rows.length) throw fail("This bot already has a sync in progress. Resume or stop it first.");
    if (!config.isDefault) {
      const earlier = await pool.query("SELECT id FROM community_bot_authorization_jobs WHERE client_id=$1 AND (status IN ('queued','running','paused') OR (worker_token IS NOT NULL AND lease_until>NOW()))", [clientId]);
      if (earlier.rows.length) throw fail("An earlier authorization job is still active for this bot. Wait for it to finish.");
    }
    const payload = { ...summary, memberIds: ids, failedIds: [], guildId: config.guildId, isDefault: config.isDefault, redirectUri,
      total: ids.length, processed: 0, succeeded: 0, failed: 0, errors: [], details: ids.length ? "" : "All eligible accounts are up to date." };
    try {
      return safe((await pool.query("INSERT INTO community_bot_sync_jobs(id,client_id,payload,status) VALUES ($1,$2,$3::jsonb,$4) RETURNING *",
        [crypto.randomUUID(), clientId, JSON.stringify(payload), ids.length ? "queued" : "completed"])).rows[0]);
    } catch (error) { if (error.code === "23505") throw fail("This bot already has a sync in progress."); throw error; }
  }
  async function resume(clientId) {
    await configFor(clientId);
    const current = await latest(clientId);
    if (current?.legacy && current.status === "paused") return { ...await legacy.resume(clientId), legacy: true };
    const result = await pool.query("UPDATE community_bot_sync_jobs SET status='queued',payload=payload-'details',updated_at=NOW() WHERE client_id=$1 AND status='paused' RETURNING *", [clientId]);
    if (!result.rows.length) throw fail("No paused sync was found.");
    return safe(result.rows[0]);
  }
  async function cancel(clientId) {
    await configFor(clientId);
    const current = await latest(clientId);
    if (current?.legacy) return { ...await legacy.cancel(clientId), legacy: true };
    const result = await pool.query("UPDATE community_bot_sync_jobs SET status='cancelled',updated_at=NOW() WHERE client_id=$1 AND status IN ('queued','running','paused') RETURNING *", [clientId]);
    if (!result.rows.length) throw fail("No active sync was found.");
    return safe(result.rows[0]);
  }
  async function tick() {
    if (running) return;
    running = true; let heartbeat;
    try {
      const owner = crypto.randomUUID();
      const row = (await pool.query(`UPDATE community_bot_sync_jobs SET status='running',worker_token=$1,lease_until=NOW()+INTERVAL '3 minutes'
        WHERE id=(SELECT id FROM community_bot_sync_jobs WHERE status IN ('queued','running') AND
        (lease_until IS NULL OR lease_until<NOW()) ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [owner])).rows[0];
      if (!row) return;
      heartbeat = setInterval(() => { void pool.query("UPDATE community_bot_sync_jobs SET lease_until=NOW()+INTERVAL '3 minutes' WHERE id=$1 AND worker_token=$2", [row.id, owner]).catch(() => {}); }, 30_000);
      heartbeat.unref();
      const progress = row.payload;
      const userId = progress.memberIds[progress.processed];
      let status = "queued";
      try {
        let config;
        try {
          config = await configFor(row.client_id);
          if (config.guildId !== progress.guildId || config.isDefault !== progress.isDefault) throw fail("The stock or bot configuration changed. Stop this sync and start a new one.");
        } catch (error) { error.syncConfigurationInvalid = true; throw error; }
        const member = (await pool.query("SELECT * FROM community_oauth_joins WHERE guild_id=$1 AND discord_user_id=$2", [progress.guildId, userId])).rows[0];
        if (!member) throw new Error("This account is no longer in stock.");
        await synchronize({ ...config, redirectUri: progress.redirectUri }, member);
        progress.succeeded++;
      } catch (error) {
        if (error.statusCode === 429 || error.oauthRefreshTransient || error.syncConfigurationInvalid || error.statusCode >= 500) {
          status = "paused"; progress.details = error.syncConfigurationInvalid ? "The bot or stock configuration is unavailable or changed. Review it before resuming." : "Authorization is temporarily unavailable. Wait before resuming.";
        } else {
          progress.failed++; progress.failedIds.push(userId);
          if (progress.errors.length < 25) progress.errors.push({ userId, message: String(error.message || "Authorization failed.").slice(0, 300) });
        }
      }
      if (status !== "paused") progress.processed++;
      if (progress.processed >= progress.total) status = "completed";
      await pool.query(`UPDATE community_bot_sync_jobs SET payload=$2::jsonb,status=CASE WHEN status='cancelled' THEN status ELSE $3 END,
        worker_token=NULL,lease_until=NULL,updated_at=NOW() WHERE id=$1 AND worker_token=$4`, [row.id, JSON.stringify(progress), status, owner]);
    } finally { if (heartbeat) clearInterval(heartbeat); running = false; }
  }
  return { preview, latest, start, resume, cancel, tick };
}

export function registerBotSync(app, requireSession, service) {
  const wrap = action => async (req, res, next) => { try { res.set("Cache-Control", "no-store").json(await action(req)); } catch (error) { next(error); } };
  const base = "/api/community/bots/:clientId/sync";
  app.get(`${base}/preview`, requireSession, wrap(req => service.preview(req.params.clientId)));
  app.get(base, requireSession, wrap(req => service.latest(req.params.clientId)));
  app.post(base, requireSession, wrap(req => service.start(req.params.clientId, req.body, `${req.protocol}://${req.get("host")}/api/community/oauth/callback`)));
  app.post(`${base}/resume`, requireSession, wrap(req => service.resume(req.params.clientId)));
  app.post(`${base}/cancel`, requireSession, wrap(req => service.cancel(req.params.clientId)));
}
