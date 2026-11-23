import crypto from "node:crypto";

const settingsPath = "/api/admin/eldorado-integration";
export const integrationKeyHash = key => crypto.createHash("sha256").update(key).digest("hex");

export function normalizeMonitorOrigin(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw Object.assign(new Error("Enter the HTTPS public monitor origin, without a path."), { statusCode: 400 });
  }
}

export async function ensureEldoradoIntegrationSettings(pool, env = process.env) {
  await pool.query(`CREATE TABLE IF NOT EXISTS eldorado_integration_config (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    key_hash TEXT NOT NULL DEFAULT '', key_suffix TEXT NOT NULL DEFAULT '',
    public_base TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  // Import legacy environment settings once. A later rotation never falls back to them.
  const legacyKey = String(env.PLCP_MNG_INTEGRATION_KEY || "");
  let origin = "";
  try { if (env.PLCP_PUBLIC_URL) origin = normalizeMonitorOrigin(env.PLCP_PUBLIC_URL); } catch { /* Admin can correct an invalid legacy URL. */ }
  await pool.query(`INSERT INTO eldorado_integration_config (singleton,key_hash,key_suffix,public_base)
    VALUES (TRUE,$1,$2,$3) ON CONFLICT (singleton) DO NOTHING`,
  [legacyKey.length >= 32 ? integrationKeyHash(legacyKey) : "", legacyKey.length >= 32 ? legacyKey.slice(-4) : "", origin]);
}

export async function readEldoradoIntegrationSettings(pool) {
  const result = await pool.query("SELECT key_hash,key_suffix,public_base,revision,updated_at FROM eldorado_integration_config WHERE singleton=TRUE");
  if (!result.rows[0]) throw new Error("Integration settings have not been initialized.");
  return result.rows[0];
}

export function integrationKeyMatches(supplied, settings) {
  if (supplied.length < 32 || supplied.length > 512 || !/^[a-f0-9]{64}$/.test(settings.key_hash)) return false;
  return crypto.timingSafeEqual(Buffer.from(integrationKeyHash(supplied), "hex"), Buffer.from(settings.key_hash, "hex"));
}

const metadata = settings => ({ configured: Boolean(settings.key_hash), keySuffix: settings.key_suffix,
  publicBase: settings.public_base, revision: settings.revision, updatedAt: settings.updated_at });

export function registerEldoradoIntegrationSettings(app, { pool, requireSession }) {
  const privateResponse = (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); };
  app.get(settingsPath, privateResponse, requireSession, async (_req, res, next) => {
    try { res.json(metadata(await readEldoradoIntegrationSettings(pool))); } catch (error) { next(error); }
  });
  async function update(req, res, next, generate) {
    try {
      const { revision, publicBase, rotate } = req.body || {};
      if (!Number.isSafeInteger(revision) || revision < 0) return res.status(400).json({ message: "Refresh settings before saving." });
      const origin = normalizeMonitorOrigin(publicBase);
      const current = await readEldoradoIntegrationSettings(pool);
      if (current.revision !== revision) return res.status(409).json({ message: "Settings changed in another session. Refresh and try again." });
      if (generate && current.key_hash && rotate !== true) return res.status(409).json({ message: "Confirm replacement of the existing API key." });
      const key = generate ? `plcp_${crypto.randomBytes(32).toString("base64url")}` : null;
      const result = await pool.query(`UPDATE eldorado_integration_config SET
        key_hash=COALESCE($1,key_hash), key_suffix=COALESCE($2,key_suffix), public_base=$3,
        revision=revision+1, updated_at=NOW() WHERE singleton=TRUE AND revision=$4 RETURNING *`,
      [key ? integrationKeyHash(key) : null, key ? key.slice(-4) : null, origin, revision]);
      if (!result.rows.length) return res.status(409).json({ message: "Settings changed in another session. Refresh and try again." });
      // Only this response contains the generated key; storage and GET contain no plaintext.
      res.json({ ...metadata(result.rows[0]), ...(key ? { apiKey: key } : {}) });
    } catch (error) {
      if (error.statusCode === 400) return res.status(400).json({ message: error.message });
      next(error);
    }
  }
  app.put(settingsPath, privateResponse, requireSession, (req, res, next) => update(req, res, next, false));
  app.post(`${settingsPath}/key`, privateResponse, requireSession, (req, res, next) => update(req, res, next, true));
}
