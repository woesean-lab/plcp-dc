import crypto from "node:crypto";
import { createBotGateway } from "./bot-onliner-gateway.mjs";

const KEY = "bots_onliner_proxies";
const LOCK = 1746203914; // Separate from the Members Onliner advisory lock.
export const BOTS_ONLINER_SQL = `CREATE TABLE IF NOT EXISTS bots_onliner_accounts (
  client_id TEXT PRIMARY KEY, revision TEXT NOT NULL, encrypted_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS bots_onliner_runtime (
  client_id TEXT PRIMARY KEY REFERENCES bots_onliner_accounts(client_id) ON DELETE CASCADE,
  revision TEXT NOT NULL, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;
const fail = (message, statusCode = 400) => Object.assign(Error(message), { statusCode });

export function parseBotProxies(input) {
  const lines = String(input ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 2000) throw fail("Use at most 2000 bot proxies.");
  return [...new Set(lines.map((line, index) => {
    let value = line;
    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
      const parts = value.split(":");
      if (parts.length === 4 && parts.every(Boolean)) {
        const [host, port, user, password] = parts;
        value = `socks5://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}`;
      } else value = `http://${value}`;
    }
    try {
      const url = new URL(value);
      if (!["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(url.protocol)
        || !url.hostname || url.pathname !== "/" && url.pathname !== "" || url.search || url.hash) throw Error();
      return url.toString();
    } catch { throw fail(`Invalid bot proxy on line ${index + 1}.`); }
  }))];
}

export function createBotsOnliner({ pool, encrypt, decrypt, resolveBot, gateway = createBotGateway, now = Date.now, onError = () => {} }) {
  const entries = new Map();
  let lockClient = null, timer = null, ticking = null, closed = false, version = 0;
  const decode = row => ({ ...JSON.parse(decrypt(row.encrypted_value)), revision: row.revision });
  async function proxies(db = pool) {
    const result = await db.query("SELECT encrypted_value FROM app_settings WHERE setting_key = $1", [KEY]);
    return result.rows[0] ? JSON.parse(decrypt(result.rows[0].encrypted_value)) : [];
  }
  async function transaction(run) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK + 1]);
      const result = await run(client);
      await client.query("COMMIT");
      version++;
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  function choose(poolProxies, accounts) {
    return [...poolProxies].sort((a, b) => accounts.filter(account => account.proxyUrl === a).length - accounts.filter(account => account.proxyUrl === b).length)[0];
  }
  async function connect(clientId) {
    const bot = await resolveBot(clientId);
    const result = await transaction(async db => {
      const rows = (await db.query("SELECT * FROM bots_onliner_accounts ORDER BY client_id")).rows;
      const accounts = rows.map(decode), existing = accounts.find(account => account.clientId === clientId);
      const poolProxies = await proxies(db);
      const proxyUrl = existing?.proxyUrl && poolProxies.includes(existing.proxyUrl) ? existing.proxyUrl : choose(poolProxies, accounts);
      if (!proxyUrl) throw fail("Add proxies to the Bots Onliner proxy pool first.", 409);
      const revision = existing?.botToken === bot.botToken && existing.proxyUrl === proxyUrl ? existing.revision : crypto.randomUUID();
      await db.query(`INSERT INTO bots_onliner_accounts (client_id,revision,encrypted_value) VALUES ($1,$2,$3)
        ON CONFLICT (client_id) DO UPDATE SET revision=EXCLUDED.revision,encrypted_value=EXCLUDED.encrypted_value,updated_at=NOW()`,
      [clientId, revision, encrypt(JSON.stringify({ clientId, botToken: bot.botToken, proxyUrl }))]);
      return { accountId: `bot-${clientId}`, alreadyExisted: Boolean(existing), onlinerEnabled: true };
    });
    void tick();
    return result;
  }
  async function disconnect(clientId) {
    // Delete only from bot-owned tables. Runtime deletion cascades; member data is never read or written.
    await transaction(db => db.query("DELETE FROM bots_onliner_accounts WHERE client_id=$1", [clientId]));
    entries.get(clientId)?.transport.stop(); entries.delete(clientId);
    return { removed: true };
  }
  async function saveProxies(input) {
    const values = parseBotProxies(input);
    await transaction(async db => {
      const accounts = (await db.query("SELECT * FROM bots_onliner_accounts ORDER BY client_id")).rows.map(decode);
      if (!values.length && accounts.length) throw fail("Disconnect the bots before clearing their proxy pool.", 409);
      for (const account of accounts) {
        if (values.includes(account.proxyUrl)) continue;
        account.proxyUrl = choose(values, accounts); account.revision = crypto.randomUUID();
        await db.query("UPDATE bots_onliner_accounts SET revision=$2,encrypted_value=$3,updated_at=NOW() WHERE client_id=$1",
          [account.clientId, account.revision, encrypt(JSON.stringify(account))]);
      }
      await db.query(`INSERT INTO app_settings (setting_key,encrypted_value) VALUES ($1,$2)
        ON CONFLICT (setting_key) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,updated_at=NOW()`, [KEY, encrypt(JSON.stringify(values))]);
    });
    void tick();
    return { proxies: values };
  }
  async function status() {
    const result = await pool.query(`SELECT a.client_id,a.revision,a.created_at,r.revision AS runtime_revision,r.payload,r.updated_at
      FROM bots_onliner_accounts a LEFT JOIN bots_onliner_runtime r ON r.client_id=a.client_id ORDER BY a.client_id`);
    return { bots: result.rows.map(row => {
      const fresh = row.revision === row.runtime_revision && now() - Date.parse(row.updated_at) < 15000;
      const waiting = now() - Date.parse(row.created_at) < 15000;
      return { clientId: row.client_id, accountId: `bot-${row.client_id}`,
        connectionState: fresh ? row.payload.connectionState : waiting ? "connecting" : "disconnected",
        lastError: fresh ? row.payload.lastError : waiting ? null : "Bot Onliner worker is offline." };
    }) };
  }
  const persist = (account, state) => pool.query(`INSERT INTO bots_onliner_runtime (client_id,revision,payload,updated_at)
    SELECT client_id,revision,$3::jsonb,NOW() FROM bots_onliner_accounts WHERE client_id=$1 AND revision=$2
    ON CONFLICT (client_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,updated_at=NOW()`,
  [account.clientId, account.revision, JSON.stringify(state)]);
  function stopConnections() { for (const entry of entries.values()) entry.transport.stop(); entries.clear(); }
  async function runTick() {
    if (closed) return;
    try {
      if (!lockClient) {
        const candidate = await pool.connect();
        try {
          const acquired = await candidate.query("SELECT pg_try_advisory_lock($1) AS acquired", [LOCK]);
          if (!acquired.rows[0]?.acquired) { candidate.release(); return; }
          if (closed) { await candidate.query("SELECT pg_advisory_unlock($1)", [LOCK]); candidate.release(); return; }
          lockClient = candidate;
          const lost = () => { if (lockClient !== candidate) return; stopConnections(); lockClient = null; candidate.release(true); };
          candidate.once?.("error", lost); candidate.once?.("end", lost);
        } catch (error) { candidate.release(true); throw error; }
      }
      const owner = lockClient;
      try { await owner.query("SELECT 1"); }
      catch (error) { stopConnections(); if (lockClient === owner) { lockClient = null; owner.release(true); } throw error; }
      const epoch = version;
      const accounts = (await pool.query("SELECT * FROM bots_onliner_accounts ORDER BY client_id")).rows.map(decode);
      if (closed || owner !== lockClient || epoch !== version) return;
      const ids = new Set(accounts.map(account => account.clientId));
      for (const [id, entry] of entries) if (!ids.has(id)) { entry.transport.stop(); entries.delete(id); }
      for (const account of accounts) {
        if (closed || owner !== lockClient || epoch !== version) return;
        let entry = entries.get(account.clientId);
        if (entry?.revision !== account.revision) {
          entry?.transport.stop();
          const transport = gateway(account, { publish: state => { void persist(account, state).catch(() => {}); } });
          entry = { revision: account.revision, transport }; entries.set(account.clientId, entry); transport.start();
        }
        await persist(account, entry.transport.snapshot());
      }
    } catch (error) { onError(error); }
  }
  function tick() {
    if (closed) return Promise.resolve();
    if (!ticking) ticking = runTick().finally(() => { ticking = null; });
    return ticking;
  }
  async function start() { await pool.query(BOTS_ONLINER_SQL); closed = false; await tick(); timer = setInterval(() => void tick(), 2000); timer.unref?.(); }
  async function stop() {
    closed = true; clearInterval(timer); stopConnections();
    const owner = lockClient; lockClient = null;
    if (owner) { await owner.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => {}); owner.release(); }
  }
  return { start, stop, tick, status, connect, disconnect, proxies: async () => ({ proxies: await proxies() }), saveProxies };
}

export function registerBotsOnliner(app, requireSession, service) {
  const route = action => async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json(await action(req)); } catch (error) { next(error); }
  };
  app.get("/api/community/bots/onliner", requireSession, route(() => service.status()));
  app.post("/api/community/bots/:clientId/onliner", requireSession, route(req => service.connect(String(req.params.clientId))));
  app.delete("/api/community/bots/:clientId/onliner", requireSession, route(req => service.disconnect(String(req.params.clientId))));
  app.get("/api/community/bots/onliner/proxies", requireSession, route(() => service.proxies()));
  app.put("/api/community/bots/onliner/proxies", requireSession, route(req => service.saveProxies(req.body?.proxies)));
}
