import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pg from "pg";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const sessionCookie = "plcp_session";
const sessionDurationMs = 12 * 60 * 60 * 1000;
const legacyApiPrefix = "/api/tokenu";
const integrationApiPrefix = "/api/integration";
const tokenuApiBase = process.env.TOKENU_API_BASE_URL ?? "https://dev.tokenu.net/api/v1/reseller";
const tokenuOauthApiBase = process.env.TOKENU_OAUTH_API_BASE_URL ?? "https://api.tokenu.net/api/oauth2";
const tokenuDataApiBase = process.env.TOKENU_DATA_API_BASE_URL ?? "https://api.tokenu.net/api/data";
const dcordApiBase = process.env.DCORD_API_BASE_URL ?? "https://capheaven.dcord.co";
const dcordDashboardApiBase = process.env.DCORD_DASHBOARD_API_BASE_URL ?? "https://app.dcord.co/api";
const dcordJoinPath = process.env.DCORD_JOIN_PATH ?? "join";
const publicDelayCooldownMs = 60 * 1000;
const publicDelayCooldowns = new Map();
const publicRestartCooldownMs = 60 * 1000;
const publicRestartCooldowns = new Map();

function isDiscordGuildId(value) {
  return /^\d{17,20}$/.test(value);
}

function extractDiscordInviteCode(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if (hostname === "discord.gg") return segments[0] ?? null;
    if ((hostname === "discord.com" || hostname === "discordapp.com") && segments[0] === "invite") {
      return segments[1] ?? null;
    }
  } catch {
    // Fall through to raw invite-code handling.
  }

  return /^[A-Za-z0-9_-]{3,}$/.test(trimmed) ? trimmed : null;
}

async function resolveDiscordInvite(inviteValue) {
  const inviteCode = extractDiscordInviteCode(inviteValue);
  if (!inviteCode) {
    const error = new Error("Enter a Discord server ID or invite link.");
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch(
    `https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true`,
    { signal: AbortSignal.timeout(10_000) }
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(response.status === 404
      ? "Discord invite could not be found."
      : "Discord invite could not be resolved right now.");
    error.statusCode = response.status === 404 ? 400 : 502;
    throw error;
  }

  const guildId = payload?.guild?.id;
  if (!isDiscordGuildId(String(guildId ?? ""))) {
    const error = new Error("That invite does not resolve to a Discord server ID.");
    error.statusCode = 400;
    throw error;
  }

  return {
    guildId: String(guildId),
    approximateMemberCount: Number.isFinite(payload?.approximate_member_count)
      ? payload.approximate_member_count
      : undefined
  };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_URL ? undefined : process.env.PGHOST,
  port: process.env.DATABASE_URL ? undefined : Number(process.env.PGPORT ?? 5432),
  user: process.env.DATABASE_URL ? undefined : process.env.PGUSER,
  password: process.env.DATABASE_URL ? undefined : process.env.PGPASSWORD,
  database: process.env.DATABASE_URL ? undefined : process.env.PGDATABASE,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
});

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqual(value, expected) {
  const left = Buffer.from(String(value));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getCredentialEncryptionKey() {
  const secret = process.env.ADMIN_PASSWORD ?? process.env.VITE_ADMIN_PASSWORD;
  if (!secret) {
    const error = new Error("Admin credentials are not configured.");
    error.statusCode = 503;
    throw error;
  }

  return crypto.scryptSync(secret, "pulcip-members-tokenu-credential-v1", 32);
}

function encryptCredential(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getCredentialEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptCredential(value) {
  const [version, ivValue, tagValue, encryptedValue] = String(value).split(":");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored credential format is invalid.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getCredentialEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

async function loadTokenuApiKey() {
  const result = await pool.query("SELECT encrypted_value FROM app_settings WHERE setting_key = 'tokenu_api_key' LIMIT 1");
  if (!result.rowCount) {
    const error = new Error("Tokenu API key has not been configured in Admin settings.");
    error.statusCode = 503;
    throw error;
  }
  return decryptCredential(result.rows[0].encrypted_value);
}

async function loadEncryptedSetting(settingKey) {
  const result = await pool.query("SELECT encrypted_value FROM app_settings WHERE setting_key = $1 LIMIT 1", [settingKey]);
  return result.rowCount ? decryptCredential(result.rows[0].encrypted_value) : null;
}

async function saveEncryptedSetting(settingKey, value) {
  await pool.query(
    `INSERT INTO app_settings (setting_key, encrypted_value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
    [settingKey, encryptCredential(value)]
  );
}

async function loadDcordApiKey() {
  const apiKey = await loadEncryptedSetting("dcord_api_key");
  if (!apiKey) {
    const error = new Error("Dcord API key has not been configured in Admin settings.");
    error.statusCode = 503;
    throw error;
  }
  return apiKey;
}

function normalizeBoostTokenList(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(/\r?\n/);
  return Array.from(new Set(items.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function normalizeBoostTokenStock(value) {
  const stock = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    oneMonth: normalizeBoostTokenList(stock.oneMonthTokens ?? stock.oneMonth),
    threeMonth: normalizeBoostTokenList(stock.threeMonthTokens ?? stock.threeMonth)
  };
}

function summarizeBoostTokenStock(stock) {
  return {
    oneMonth: stock.oneMonth.length,
    threeMonth: stock.threeMonth.length
  };
}

async function loadBoostTokenStock() {
  const raw = await loadEncryptedSetting("dcord_boost_token_stock");
  if (!raw) return { oneMonth: [], threeMonth: [] };

  try {
    return normalizeBoostTokenStock(JSON.parse(raw));
  } catch {
    return { oneMonth: [], threeMonth: [] };
  }
}

async function saveBoostTokenStock(stock) {
  const normalized = normalizeBoostTokenStock(stock);
  await saveEncryptedSetting("dcord_boost_token_stock", JSON.stringify(normalized));
  return normalized;
}

async function requestTokenuWithKey(apiKey, baseUrl, pathname, init = {}) {

  const response = await fetch(new URL(pathname, `${baseUrl.replace(/\/$/, "")}/`), {
    ...init,
    headers: {
      Authorization: apiKey,
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let payload = text;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Preserve non-JSON upstream error messages.
  }

  if (!response.ok) {
    const error = new Error(
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : typeof payload === "string" && payload
          ? payload
          : `Tokenu request failed with ${response.status}.`
    );
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function requestTokenu(baseUrl, pathname, init = {}) {
  return requestTokenuWithKey(await loadTokenuApiKey(), baseUrl, pathname, init);
}

async function requestDcord(pathname, init = {}) {
  const response = await fetch(new URL(pathname, `${dcordApiBase.replace(/\/$/, "")}/`), {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(620_000),
    headers: {
      "X-API-Key": await loadDcordApiKey(),
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let payload = text;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Preserve non-JSON upstream error messages.
  }

  if (!response.ok) {
    const error = new Error(
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : typeof payload === "string" && payload
          ? payload
          : `Dcord request failed with ${response.status}.`
    );
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function requestDcordDashboard(pathname, init = {}) {
  const response = await fetch(new URL(pathname, `${dcordDashboardApiBase.replace(/\/$/, "")}/`), {
    ...init,
    headers: {
      "X-API-Key": await loadDcordApiKey(),
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let payload = text;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Preserve non-JSON upstream error messages.
  }

  if (!response.ok) {
    const error = new Error(
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : typeof payload === "string" && payload
          ? payload
          : `Dcord dashboard request failed with ${response.status}.`
    );
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

function getOrderIdFromPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["uniqid", "orderId", "order_id", "id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  if (payload.data && typeof payload.data === "object") return getOrderIdFromPayload(payload.data);
  return null;
}

function redactToken(token) {
  const value = String(token ?? "");
  return value.length <= 10 ? "***" : `${value.slice(0, 4)}...${value.slice(-6)}`;
}

function createDcordOrderId() {
  return `dcord_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

async function saveTrackedOrderPayload(payload) {
  await pool.query(
    `INSERT INTO tracked_orders (uniqid, payload, created_at, updated_at)
     VALUES ($1, $2::jsonb, COALESCE(($2::jsonb->>'createdAt')::timestamptz, NOW()), NOW())
     ON CONFLICT (uniqid) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [payload.uniqid, JSON.stringify(payload)]
  );
}

function normalizeDcordJoinResult(result, token) {
  const boostMessage = String(result?.boost_message ?? "").trim();
  const boosted = result?.boost === true || boostMessage.toLowerCase().includes("boosted");
  return {
    token: redactToken(token),
    success: Boolean(result?.success),
    status: typeof result?.status === "string" ? result.status : boosted ? "boosted" : "unknown",
    boost: Boolean(result?.boost),
    boostMessage,
    httpStatus: Number.isFinite(result?.http_status) ? result.http_status : undefined,
    boosted
  };
}

async function processDcordBoostOrder(order, tokens, invite) {
  const results = [];
  let added = 0;

  for (const token of tokens) {
    try {
      const result = await requestDcord(dcordJoinPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, invite, boost: true })
      });
      const normalized = normalizeDcordJoinResult(result, token);
      results.push(normalized);
      if (normalized.boosted) added += 2;
    } catch (error) {
      results.push({
        token: redactToken(token),
        success: false,
        status: "error",
        boost: false,
        boostMessage: error instanceof Error ? error.message : "Dcord join failed.",
        boosted: false
      });
    }

    const inProgress = {
      ...order,
      added,
      status: added >= order.amount ? "COMPLETED" : "PROCESS",
      details: `${added}/${order.amount} boosts completed.`,
      dcordResults: results
    };
    await saveTrackedOrderPayload(inProgress);
  }

  const completed = added >= order.amount;
  await saveTrackedOrderPayload({
    ...order,
    added,
    status: completed ? "COMPLETED" : added > 0 ? "PARTIAL" : "ERROR",
    details: completed
      ? `${added}/${order.amount} boosts completed.`
      : `${added}/${order.amount} boosts completed. Review failed tokens in the payload.`,
    dcordResults: results
  });
}

async function requestTokenuPublicData(pathname, init = {}) {
  const response = await fetch(new URL(pathname, `${tokenuDataApiBase.replace(/\/$/, "")}/`), init);
  const text = await response.text();
  let payload = text;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Preserve non-JSON upstream error messages.
  }

  if (!response.ok) {
    const upstreamMessage =
      typeof payload === "object" && payload && "message" in payload
        ? String(payload.message)
        : typeof payload === "string" && payload
          ? payload
          : `Tokenu request failed with ${response.status}.`;
    const error = new Error(
      upstreamMessage.trim().toLowerCase() === "invalid action"
        ? "Restart is not available yet. Make sure the Discord server restriction has been removed, then try again."
        : upstreamMessage
    );
    error.statusCode = upstreamMessage.trim().toLowerCase() === "invalid action" ? 409 : response.status;
    throw error;
  }

  return payload;
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracked_orders (
      uniqid TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx ON admin_sessions (expires_at)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
}

async function requireSession(req, res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[sessionCookie];
    if (!token) return res.status(401).json({ message: "Authentication required." });

    const result = await pool.query(
      "SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1",
      [hashToken(token)]
    );
    if (!result.rowCount) return res.status(401).json({ message: "Session expired." });
    next();
  } catch (error) {
    next(error);
  }
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

app.get("/api/public/orders/:uniqid/status", async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    const cacheBuster = Date.now();
    const payload = await requestTokenu(
      tokenuApiBase,
      `status?uniqid=${encodeURIComponent(uniqid)}&_=${cacheBuster}`,
      { cache: "no-store" }
    );
    const cooldownKey = `${req.ip}:${uniqid}`;
    const cooldownUntil = publicDelayCooldowns.get(cooldownKey) ?? 0;
    const delayUpdateCooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
    const restartCooldownUntil = publicRestartCooldowns.get(cooldownKey) ?? 0;
    const restartCooldownSeconds = Math.max(0, Math.ceil((restartCooldownUntil - Date.now()) / 1000));
    const responsePayload = typeof payload === "object" && payload && !Array.isArray(payload)
      ? { ...payload, delayUpdateCooldownSeconds, restartCooldownSeconds }
      : { data: payload, delayUpdateCooldownSeconds, restartCooldownSeconds };
    res.set("Cache-Control", "no-store").json(responsePayload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/orders/:uniqid/delay", async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const delay = Number.parseInt(req.body?.delay, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isFinite(delay) || delay <= 0 || delay > 1200) {
      return res.status(400).json({ message: "A valid order ID and delay are required." });
    }

    const cooldownKey = `${req.ip}:${uniqid}`;
    const cooldownUntil = publicDelayCooldowns.get(cooldownKey) ?? 0;
    if (cooldownUntil > Date.now()) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds before updating again.`
      });
    }

    const payload = await requestTokenu(tokenuOauthApiBase, "delay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uniqid, delay })
    });
    publicDelayCooldowns.set(cooldownKey, Date.now() + publicDelayCooldownMs);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/orders/:uniqid/restart", async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    const cooldownKey = `${req.ip}:${uniqid}`;
    const cooldownUntil = publicRestartCooldowns.get(cooldownKey) ?? 0;
    if (cooldownUntil > Date.now()) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds before restarting again.`
      });
    }

    const currentStatus = await requestTokenu(
      tokenuApiBase,
      `status?uniqid=${encodeURIComponent(uniqid)}&_=${Date.now()}`,
      { cache: "no-store" }
    );
    const normalizedStatus = String(currentStatus?.status ?? "").trim().toUpperCase();
    if (!normalizedStatus.includes("INVITE") || !normalizedStatus.includes("PAUSED")) {
      return res.status(409).json({ message: "Order is not in Invites Paused status." });
    }

    const payload = await requestTokenu(
      tokenuOauthApiBase,
      `restart?uniqid=${encodeURIComponent(uniqid)}`,
      { method: "GET", cache: "no-store" }
    );
    publicRestartCooldowns.set(cooldownKey, Date.now() + publicRestartCooldownMs);
    res.set("Cache-Control", "no-store").json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/healthz", async (_req, res, next) => {
  try {
    await pool.query("SELECT 1");
    res.type("text").send("ok");
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const configuredUsername = process.env.ADMIN_USERNAME ?? process.env.VITE_ADMIN_USERNAME;
    const configuredPassword = process.env.ADMIN_PASSWORD ?? process.env.VITE_ADMIN_PASSWORD;
    if (!configuredUsername || !configuredPassword) {
      return res.status(503).json({ message: "Admin credentials are not configured." });
    }

    if (!safeEqual(req.body?.username?.trim() ?? "", configuredUsername) || !safeEqual(req.body?.password ?? "", configuredPassword)) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionDurationMs);
    await pool.query("INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)", [hashToken(token), expiresAt]);
    res.cookie(sessionCookie, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "strict",
      path: "/",
      maxAge: sessionDurationMs
    });
    res.json({ authenticated: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/session", requireSession, (_req, res) => {
  res.json({ authenticated: true });
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = parseCookies(req.headers.cookie)[sessionCookie];
    if (token) await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [hashToken(token)]);
    res.clearCookie(sessionCookie, { httpOnly: true, secure: isProduction, sameSite: "strict", path: "/" });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get([`${legacyApiPrefix}/config`, `${integrationApiPrefix}/config`], requireSession, async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT setting_key FROM app_settings WHERE setting_key = ANY($1::text[])",
      [["tokenu_api_key", "dcord_api_key"]]
    );
    const configuredKeys = new Set(result.rows.map((row) => row.setting_key));
    const tokenuConfigured = configuredKeys.has("tokenu_api_key");
    const dcordConfigured = configuredKeys.has("dcord_api_key");
    res.json({
      configured: tokenuConfigured,
      tokenuConfigured,
      dcordConfigured,
      boostStock: summarizeBoostTokenStock(await loadBoostTokenStock())
    });
  } catch (error) {
    next(error);
  }
});

app.put([`${legacyApiPrefix}/config`, `${integrationApiPrefix}/config`], requireSession, async (req, res, next) => {
  try {
    const apiKey = String(req.body?.apiKey ?? "").trim();
    if (!apiKey || apiKey.length > 2000) {
      return res.status(400).json({ message: "A valid Tokenu API key is required." });
    }

    const balance = await requestTokenuWithKey(apiKey, tokenuApiBase, "balance");
    await pool.query(
      `INSERT INTO app_settings (setting_key, encrypted_value, updated_at)
       VALUES ('tokenu_api_key', $1, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
      [encryptCredential(apiKey)]
    );
    res.json({ configured: true, balance: balance?.balance });
  } catch (error) {
    next(error);
  }
});

app.delete([`${legacyApiPrefix}/config`, `${integrationApiPrefix}/config`], requireSession, async (_req, res, next) => {
  try {
    await pool.query("DELETE FROM app_settings WHERE setting_key = 'tokenu_api_key'");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.put("/api/dcord/config", requireSession, async (req, res, next) => {
  try {
    const apiKey = String(req.body?.apiKey ?? "").trim();
    if (!apiKey || apiKey.length > 2000) {
      return res.status(400).json({ message: "A valid Dcord API key is required." });
    }

    await saveEncryptedSetting("dcord_api_key", apiKey);
    res.json({ configured: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/dcord/config", requireSession, async (_req, res, next) => {
  try {
    await pool.query("DELETE FROM app_settings WHERE setting_key = 'dcord_api_key'");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/dcord/balance", requireSession, async (_req, res, next) => {
  try {
    const payload = await requestDcordDashboard("me", { cache: "no-store" });
    const balance = Number(payload?.balance);
    const creditsConsumed = Number(payload?.stats?.credits_consumed);
    res.set("Cache-Control", "no-store").json({
      balance: Number.isFinite(balance) ? balance : null,
      creditsConsumed: Number.isFinite(creditsConsumed) ? creditsConsumed : null,
      raw: payload
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/dcord/boost-stock", requireSession, async (req, res, next) => {
  try {
    const duration = Number.parseInt(req.query.duration, 10);
    const stock = await loadBoostTokenStock();
    const summary = summarizeBoostTokenStock(stock);
    const availableTokens = duration === 3 ? summary.threeMonth : summary.oneMonth;
    if (String(req.query.includeTokens ?? "") === "true") {
      return res.json({
        stock: summary,
        oneMonthTokens: stock.oneMonth,
        threeMonthTokens: stock.threeMonth
      });
    }
    res.json({ ...summary, available: availableTokens * 2, maximum: availableTokens * 2 });
  } catch (error) {
    next(error);
  }
});

app.put("/api/dcord/boost-stock", requireSession, async (req, res, next) => {
  try {
    const existing = await loadBoostTokenStock();
    const incoming = normalizeBoostTokenStock(req.body);
    const stock = await saveBoostTokenStock({
      oneMonth: [...existing.oneMonth, ...incoming.oneMonth],
      threeMonth: [...existing.threeMonth, ...incoming.threeMonth]
    });
    res.json({ stock: summarizeBoostTokenStock(stock) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/dcord/boost-stock/delete", requireSession, async (req, res, next) => {
  try {
    const duration = Number.parseInt(req.body?.duration, 10);
    if (![1, 3].includes(duration)) {
      return res.status(400).json({ message: "A valid boost duration is required." });
    }

    const tokensToRemove = new Set(normalizeBoostTokenList(req.body?.tokens));
    if (!tokensToRemove.size) {
      return res.status(400).json({ message: "At least one token is required." });
    }

    const stock = await loadBoostTokenStock();
    const stockKey = duration === 3 ? "threeMonth" : "oneMonth";
    const nextStock = await saveBoostTokenStock({
      ...stock,
      [stockKey]: stock[stockKey].filter((token) => !tokensToRemove.has(token))
    });

    res.json({
      stock: summarizeBoostTokenStock(nextStock),
      oneMonthTokens: nextStock.oneMonth,
      threeMonthTokens: nextStock.threeMonth
    });
  } catch (error) {
    next(error);
  }
});

app.get([`${legacyApiPrefix}/balance`, `${integrationApiPrefix}/balance`], requireSession, async (_req, res, next) => {
  try {
    res.json(await requestTokenu(tokenuApiBase, "balance"));
  } catch (error) {
    next(error);
  }
});

app.post("/api/discord/resolve", requireSession, async (req, res, next) => {
  try {
    const value = String(req.body?.value ?? "").trim();
    if (!value || value.length > 256) {
      return res.status(400).json({ message: "Server ID or Discord invite link is required." });
    }

    if (isDiscordGuildId(value)) {
      return res.json({ guildId: value });
    }

    res.json(await resolveDiscordInvite(value));
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError" || error instanceof TypeError) {
      return res.status(502).json({ message: "Discord could not be reached. Please try again." });
    }
    next(error);
  }
});

app.post([`${legacyApiPrefix}/orders`, `${integrationApiPrefix}/orders`], requireSession, async (req, res, next) => {
  try {
    const { service, id, amount, delay, billingCycle } = req.body ?? {};
    if (typeof service !== "string" || typeof id !== "string" || !id.trim() || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "Valid service, server ID, and amount are required." });
    }

    const payload = { service, id: id.trim(), amount };
    if (Number.isFinite(delay)) payload.delay = delay;
    if (Number.isFinite(billingCycle)) payload.billingCycle = billingCycle;

    res.json(await requestTokenu(tokenuApiBase, "order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/dcord/boost-orders", requireSession, async (req, res, next) => {
  try {
    const invite = extractDiscordInviteCode(req.body?.id);
    const amount = Number.parseInt(req.body?.amount, 10);
    const duration = Number.parseInt(req.body?.duration, 10);

    if (!invite || !Number.isFinite(amount) || amount <= 0 || amount % 2 !== 0 || ![1, 3].includes(duration)) {
      return res.status(400).json({ message: "A valid Discord invite, even boost amount, and duration are required." });
    }

    const serverInfo = await resolveDiscordInvite(invite);
    const stock = await loadBoostTokenStock();
    const stockKey = duration === 3 ? "threeMonth" : "oneMonth";
    const requiredTokens = amount / 2;
    if (stock[stockKey].length < requiredTokens) {
      return res.status(409).json({ message: `Only ${stock[stockKey].length * 2} ${duration} month boosts are in stock.` });
    }

    const selectedTokens = stock[stockKey].slice(0, requiredTokens);
    const nextStock = await saveBoostTokenStock({
      ...stock,
      [stockKey]: stock[stockKey].slice(requiredTokens)
    });
    const uniqid = createDcordOrderId();
    const order = {
      uniqid,
      provider: "dcord",
      service: "DCORD-BOOSTS",
      serverId: serverInfo.guildId,
      serverInvite: String(req.body?.id ?? "").trim(),
      serverMemberCount: serverInfo.approximateMemberCount,
      amount,
      added: 0,
      duration,
      tokenCount: requiredTokens,
      createdAt: new Date().toISOString(),
      status: "PROCESS",
      details: `0/${amount} boosts completed.`
    };

    await saveTrackedOrderPayload(order);
    void processDcordBoostOrder(order, selectedTokens, invite).catch((error) => {
      console.error(error);
    });
    res.json({
      uniqid,
      stock: summarizeBoostTokenStock(nextStock)
    });
  } catch (error) {
    next(error);
  }
});

app.get([`${legacyApiPrefix}/orders/:uniqid/status`, `${integrationApiPrefix}/orders/:uniqid/status`], requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    const payload = await requestTokenu(
      tokenuApiBase,
      `status?uniqid=${encodeURIComponent(uniqid)}&_=${Date.now()}`,
      { cache: "no-store" }
    );
    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    let trackedPayload = tracked.rows[0]?.payload;
    if (
      trackedPayload &&
      typeof trackedPayload === "object" &&
      !Array.isArray(trackedPayload) &&
      !Number.isFinite(trackedPayload.serverMemberCount) &&
      typeof trackedPayload.serverInvite === "string" &&
      trackedPayload.serverInvite.trim()
    ) {
      try {
        const inviteInfo = await resolveDiscordInvite(trackedPayload.serverInvite);
        trackedPayload = {
          ...trackedPayload,
          serverId: trackedPayload.serverId ?? inviteInfo.guildId,
          serverMemberCount: inviteInfo.approximateMemberCount
        };
        await pool.query("UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [
          uniqid,
          JSON.stringify(trackedPayload)
        ]);
      } catch {
        // Keep the order lookup available even if Discord count lookup fails.
      }
    }
    const responsePayload =
      typeof payload === "object" && payload && !Array.isArray(payload) && typeof trackedPayload === "object" && trackedPayload && !Array.isArray(trackedPayload)
        ? { ...trackedPayload, ...payload }
        : payload;
    res.set("Cache-Control", "no-store").json(responsePayload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/dcord/boost-orders/:uniqid/status", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    if (!tracked.rowCount) {
      return res.status(404).json({ message: "Boost order could not be found." });
    }

    res.set("Cache-Control", "no-store").json(tracked.rows[0].payload);
  } catch (error) {
    next(error);
  }
});

app.post([`${legacyApiPrefix}/orders/:uniqid/restart`, `${integrationApiPrefix}/orders/:uniqid/restart`], requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    const cooldownKey = `${req.ip}:${uniqid}`;
    const cooldownUntil = publicRestartCooldowns.get(cooldownKey) ?? 0;
    if (cooldownUntil > Date.now()) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds before restarting again.`
      });
    }

    const currentStatus = await requestTokenu(
      tokenuApiBase,
      `status?uniqid=${encodeURIComponent(uniqid)}&_=${Date.now()}`,
      { cache: "no-store" }
    );
    const normalizedStatus = String(currentStatus?.status ?? "").trim().toUpperCase();
    if (!normalizedStatus.includes("INVITE") || !normalizedStatus.includes("PAUSED")) {
      return res.status(409).json({ message: "Order is not in Invites Paused status." });
    }

    const payload = await requestTokenu(
      tokenuOauthApiBase,
      `restart?uniqid=${encodeURIComponent(uniqid)}`,
      { method: "GET", cache: "no-store" }
    );
    publicRestartCooldowns.set(cooldownKey, Date.now() + publicRestartCooldownMs);
    res.set("Cache-Control", "no-store").json(payload);
  } catch (error) {
    next(error);
  }
});

app.get([`${legacyApiPrefix}/check`, `${integrationApiPrefix}/check`], requireSession, async (req, res, next) => {
  try {
    const service = String(req.query.service ?? "").trim();
    const id = String(req.query.id ?? "").trim();
    if (!service || !id || service.length > 80 || id.length > 160) {
      return res.status(400).json({ message: "A valid service and server ID are required." });
    }

    res.json(await requestTokenu(
      tokenuApiBase,
      `check?service=${encodeURIComponent(service)}&id=${encodeURIComponent(id)}`
    ));
  } catch (error) {
    next(error);
  }
});

app.post([`${legacyApiPrefix}/orders/:uniqid/delay`, `${integrationApiPrefix}/orders/:uniqid/delay`], requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const delay = Number.parseInt(req.body?.delay, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isFinite(delay) || delay <= 0 || delay > 1200) {
      return res.status(400).json({ message: "A valid order ID and delay are required." });
    }

    const cooldownKey = `admin:${uniqid}`;
    const cooldownUntil = publicDelayCooldowns.get(cooldownKey) ?? 0;
    if (cooldownUntil > Date.now()) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds before updating again.`
      });
    }

    const payload = await requestTokenu(tokenuOauthApiBase, "delay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uniqid, delay })
    });
    publicDelayCooldowns.set(cooldownKey, Date.now() + publicDelayCooldownMs);
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/orders", requireSession, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT payload FROM tracked_orders ORDER BY created_at DESC");
    res.json(result.rows.map((row) => row.payload));
  } catch (error) {
    next(error);
  }
});

app.put("/api/orders", requireSession, async (req, res, next) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : null;
  if (!orders || orders.some((order) => !order || typeof order.uniqid !== "string" || !order.uniqid.trim())) {
    return res.status(400).json({ message: "A valid orders array is required." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [];
    for (const order of orders) {
      const uniqid = order.uniqid.trim();
      ids.push(uniqid);
      await client.query(
        `INSERT INTO tracked_orders (uniqid, payload, created_at, updated_at)
         VALUES ($1, $2::jsonb, COALESCE(($2::jsonb->>'createdAt')::timestamptz, NOW()), NOW())
         ON CONFLICT (uniqid) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [uniqid, JSON.stringify({ ...order, uniqid })]
      );
    }

    if (ids.length) {
      await client.query("DELETE FROM tracked_orders WHERE NOT (uniqid = ANY($1::text[]))", [ids]);
    } else {
      await client.query("DELETE FROM tracked_orders");
    }
    await client.query("COMMIT");
    res.json({ saved: orders.length });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.use(express.static(distDir, { index: false }));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(distDir, "index.html")));

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({
      message: "Invalid JSON body. Property names must use double quotes."
    });
  }

  console.error(error);
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  res.status(statusCode).json({ message: statusCode >= 500 ? "Service is temporarily unavailable." : error.message });
});

await initializeDatabase();
app.listen(port, "0.0.0.0", () => {
  console.log(`Pulcip Members listening on port ${port}`);
});
