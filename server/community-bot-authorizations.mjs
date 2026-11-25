import crypto from "node:crypto";

export const BOT_AUTHORIZATION_STORAGE_SQL = `CREATE TABLE IF NOT EXISTS community_bot_authorization_jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES community_bot_pool(client_id),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  worker_token TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_bot_authorization_one_active ON community_bot_authorization_jobs(client_id) WHERE status IN ('queued','running','paused');`;

export function createBotAuthorizations({ pool, getConfig, loadBot, token, encrypt, decrypt, request, refresh, parseExpiry, withGrantLock }) {
  let running = false;
  const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
  const validId = value => /^\d{16,22}$/.test(String(value));
  const safe = row => { if (!row) return null; const { memberIds: _ids, redirectUri: _redirect, guildId: _guild, ...payload } = row.payload;
    return { id: row.id, clientId: row.client_id, status: row.status, ...payload }; };
  async function validate(clientId, categoryId) {
    if (!validId(clientId)) throw fail("Choose a pool bot.");
    const credentials = await loadBot(clientId);
    const base = await getConfig();
    const category = await pool.query("SELECT id FROM community_stock_categories WHERE guild_id=$1 AND id=$2", [base.guildId, categoryId]);
    if (!category.rowCount) throw fail("Choose a valid stock category.");
    return { ...credentials, clientId, poolBotId: clientId, guildId: base.guildId, configured: true };
  }
  async function latest(clientId) {
    const result = await pool.query("SELECT * FROM community_bot_authorization_jobs WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1", [clientId]);
    return safe(result.rows[0]);
  }
  async function start(clientId, input, redirectUri) {
    const config = await validate(clientId, input?.categoryId);
    const ids = input?.discordUserIds;
    if (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some(id => !validId(id)))) throw fail("Select between 1 and 5000 valid accounts.");
    const members = await pool.query(`SELECT discord_user_id FROM community_oauth_joins WHERE guild_id=$1 AND stock_type=$2
      AND encrypted_account_token IS NOT NULL AND ($3::text[] IS NULL OR discord_user_id=ANY($3::text[])) ORDER BY sort_position, discord_user_id`,
    [config.guildId, input.categoryId, ids || null]);
    if (!members.rowCount) throw fail("No accounts with saved account tokens are available in this category.", 409);
    if (members.rowCount > 10000) throw fail("Select up to 10000 accounts per authorization job.");
    const id = crypto.randomUUID();
    const payload = { categoryId: input.categoryId, guildId: config.guildId, redirectUri,
      memberIds: members.rows.map(row => row.discord_user_id), total: members.rowCount, processed: 0, succeeded: 0, failed: 0, errors: [] };
    try {
      const saved = await pool.query("INSERT INTO community_bot_authorization_jobs (id,client_id,payload) VALUES ($1,$2,$3::jsonb) RETURNING *", [id,clientId,JSON.stringify(payload)]);
      return safe(saved.rows[0]);
    } catch (error) { if (error.code === "23505") throw fail("This bot already has an authorization job. Resume or finish it first.", 409); throw error; }
  }
  async function resume(clientId) {
    const saved = await pool.query("UPDATE community_bot_authorization_jobs SET status='queued', payload=payload-'details', updated_at=NOW() WHERE client_id=$1 AND status='paused' RETURNING *", [clientId]);
    if (!saved.rowCount) throw fail("No paused authorization job found.", 409);
    return safe(saved.rows[0]);
  }
  async function cancel(clientId) {
    const saved = await pool.query("UPDATE community_bot_authorization_jobs SET status='cancelled', updated_at=NOW() WHERE client_id=$1 AND status IN ('queued','running','paused') RETURNING *", [clientId]);
    if (!saved.rowCount) throw fail("No active authorization job found.", 409);
    return safe(saved.rows[0]);
  }
  async function tick() {
    if (running) return;
    running = true;
    let claimed, heartbeat;
    const owner = crypto.randomUUID();
    try {
      const result = await pool.query(`UPDATE community_bot_authorization_jobs SET status='running',worker_token=$1,lease_until=NOW()+INTERVAL '3 minutes'
        WHERE id=(SELECT id FROM community_bot_authorization_jobs WHERE status IN ('queued','running')
          AND (lease_until IS NULL OR lease_until < NOW()) ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [owner]);
      claimed = result.rows[0];
      if (!claimed) return;
      heartbeat = setInterval(() => { void pool.query("UPDATE community_bot_authorization_jobs SET lease_until=NOW()+INTERVAL '3 minutes' WHERE id=$1 AND worker_token=$2", [claimed.id,owner]).catch(() => {}); }, 30_000);
      heartbeat.unref();
      const progress = claimed.payload;
      const userId = progress.memberIds[progress.processed];
      let status = "queued";
      try {
        const config = { ...(await loadBot(claimed.client_id)), poolBotId: claimed.client_id, guildId: progress.guildId,
          redirectUri: progress.redirectUri, configured: true };
        const members = await pool.query("SELECT discord_user_id, encrypted_account_token FROM community_oauth_joins WHERE guild_id=$1 AND discord_user_id=$2", [progress.guildId,userId]);
        if (!members.rows[0]?.encrypted_account_token) throw fail("Account token is no longer available.");
        await token(config, members.rows[0]);
        progress.succeeded++;
      } catch (error) {
        if (error.statusCode === 429 || error.oauthRefreshTransient) {
          status = "paused";
          progress.details = "Discord limited authorizations. Wait before resuming this job.";
        } else {
          progress.failed++;
          if (progress.errors.length < 25) progress.errors.push({ userId, message: error.message || "Authorization failed." });
        }
      }
      if (status !== "paused") progress.processed++;
      if (progress.processed >= progress.total) status = "completed";
      await pool.query(`UPDATE community_bot_authorization_jobs SET payload=$2::jsonb,status=$3,worker_token=NULL,lease_until=NULL,updated_at=NOW()
        WHERE id=$1 AND worker_token=$4 AND status='running'`, [claimed.id,JSON.stringify(progress),status,owner]);
    } finally { if (heartbeat) clearInterval(heartbeat); running = false; }
  }

  async function importRecords(clientId, input) {
    const config = await validate(clientId, input?.categoryId);
    const records = input?.records;
    if (!Array.isArray(records) || !records.length || records.length > 250) throw fail("Import between 1 and 250 OAuth records per batch.");
    const result = { total: records.length, imported: 0, failed: 0, skipped: 0, errors: [], errorCounts: {} };
    const seen = new Set();
    for (const [index, record] of records.entries()) {
      const userId = String(record?.user_id ?? record?.userId ?? "");
      const label = validId(userId) ? userId : `row ${index+1}`;
      try {
        if (!validId(userId)) throw fail("A valid Discord user ID is required.");
        if (seen.has(userId)) { result.skipped++; continue; }
        seen.add(userId);
        const known = await pool.query("SELECT discord_user_id FROM community_oauth_joins WHERE guild_id=$1 AND stock_type=$2 AND discord_user_id=$3", [config.guildId,input.categoryId,userId]);
        if (!known.rowCount) throw fail("Add this account to the selected stock category before importing its pool-bot authorization.");
        await importGrant(config, record, userId);
        result.imported++;
      } catch (error) {
        result.failed++;
        const message = error.statusCode === 429 ? "Discord is rate limiting OAuth checks. Retry later." : error.message || "OAuth import failed.";
        result.errorCounts[message] = (result.errorCounts[message] || 0) + 1;
        if (result.errors.length < 25) result.errors.push({ record: label, message });
        if (error.statusCode === 429) { result.skipped += records.length - index - 1; break; }
      }
    }
    return result;
  }
  async function importGrant(config, record, userId) {
    let accessToken = String(record?.access_token ?? record?.accessToken ?? "").trim();
    let refreshToken = String(record?.refresh_token ?? record?.refreshToken ?? "").trim();
    let expiresAt = parseExpiry(record);
    if (accessToken.length < 20 || accessToken.length > 4096 || refreshToken.length > 4096 || !expiresAt) throw fail("A valid access token and expiration are required.");
    const execute = async () => {
      if (expiresAt.getTime() <= Date.now()) {
        if (!refreshToken) throw fail("The imported OAuth token has expired.");
        const updated = await refresh(config, refreshToken);
        accessToken=updated.accessToken; refreshToken=updated.refreshToken; expiresAt=updated.expiresAt;
      }
      const identity = await request("oauth2/@me", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (identity.response.status === 429) throw fail("Discord is rate limiting OAuth checks.", 429);
      if (!identity.response.ok || String(identity.payload?.user?.id) !== userId) throw fail("The OAuth token is invalid or belongs to another account.");
      if (String(identity.payload?.application?.id) !== config.clientId) throw fail("The OAuth record belongs to another bot application.");
      if (!Array.isArray(identity.payload.scopes) || !identity.payload.scopes.includes("guilds.join")) throw fail("The OAuth record requires guilds.join permission.");
      await pool.query(`INSERT INTO community_bot_pool_credentials (client_id,discord_user_id,encrypted_value) VALUES ($1,$2,$3)
        ON CONFLICT (client_id,discord_user_id) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value`,
      [config.clientId,userId,encrypt(JSON.stringify({ clientId: config.clientId, accessToken, refreshToken, expiresAt: expiresAt.toISOString() }))]);
    };
    await withGrantLock(config.clientId,userId,execute);
  }
  async function exportRecords(clientId, categoryId) {
    const config = await validate(clientId,categoryId);
    const saved = await pool.query(`SELECT g.discord_user_id,g.encrypted_value FROM community_bot_pool_credentials g
      JOIN community_oauth_joins s ON s.discord_user_id=g.discord_user_id
      WHERE g.client_id=$1 AND s.guild_id=$2 AND s.stock_type=$3 ORDER BY s.sort_position,g.discord_user_id`, [clientId,config.guildId,categoryId]);
    return saved.rows.map(row => {
      const grant = JSON.parse(decrypt(row.encrypted_value));
      const now = Math.floor(Date.now()/1000);
      return { user_id: row.discord_user_id, access_token: grant.accessToken, ...(grant.refreshToken ? { refresh_token: grant.refreshToken } : {}),
        authed_timestamp: now, expires_in: Math.max(0,Math.floor(Date.parse(grant.expiresAt)/1000)-now) };
    });
  }
  return { latest, start, resume, cancel, tick, importRecords, exportRecords };
}

export function registerBotAuthorizations(app, requireSession, service) {
  const wrap = action => async (req,res,next) => { try { res.set("Cache-Control","no-store").json(await action(req)); } catch(error) { next(error); } };
  const base = "/api/community/bot-pool/:clientId/authorizations";
  app.get(base, requireSession, wrap(req => service.latest(req.params.clientId)));
  app.post(base, requireSession, wrap(req => service.start(req.params.clientId,req.body,`${req.protocol}://${req.get("host")}/api/community/oauth/callback`)));
  app.post(`${base}/resume`, requireSession, wrap(req => service.resume(req.params.clientId)));
  app.post(`${base}/cancel`, requireSession, wrap(req => service.cancel(req.params.clientId)));
  app.post(`${base}/import`, requireSession, wrap(req => service.importRecords(req.params.clientId,req.body)));
}
