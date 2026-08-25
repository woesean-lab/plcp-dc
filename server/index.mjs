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
const dcordBoostConcurrency = Math.min(Math.max(Number.parseInt(process.env.DCORD_BOOST_CONCURRENCY ?? "5", 10) || 5, 1), 20);
const discordApiBase = "https://discord.com/api/v10";
const defaultCommunityJoinGoal = Math.min(Math.max(Number.parseInt(process.env.COMMUNITY_JOIN_GOAL ?? "50", 10) || 50, 1), 10_000);
const communityOauthStateDurationMs = 10 * 60 * 1000;
const publicDelayCooldownMs = 60 * 1000;
const publicDelayCooldowns = new Map();
const publicRestartCooldownMs = 60 * 1000;
const publicRestartCooldowns = new Map();
const communityOauthStartCooldowns = new Map();

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
    guildName: typeof payload?.guild?.name === "string" && payload.guild.name.trim() ? payload.guild.name.trim() : undefined,
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

function normalizeCommunityOAuthConfig(value = {}) {
  const clientId = String(value.clientId ?? "").trim();
  const clientSecret = String(value.clientSecret ?? "").trim();
  const botToken = String(value.botToken ?? "").trim();
  const redirectUri = String(value.redirectUri ?? "").trim();
  const guildId = String(value.guildId ?? "").trim();
  const goal = Math.min(Math.max(Number.parseInt(value.goal, 10) || defaultCommunityJoinGoal, 1), 10_000);
  const missing = [];

  if (!clientId) missing.push("DISCORD_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("DISCORD_OAUTH_CLIENT_SECRET");
  if (!botToken) missing.push("DISCORD_BOT_TOKEN");
  if (!redirectUri) missing.push("DISCORD_OAUTH_REDIRECT_URI");
  if (!isDiscordGuildId(guildId)) missing.push("DISCORD_TARGET_GUILD_ID");

  if (redirectUri) {
    try {
      const url = new URL(redirectUri);
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        missing.push("DISCORD_OAUTH_REDIRECT_URI_HTTPS");
      }
    } catch {
      missing.push("DISCORD_OAUTH_REDIRECT_URI_VALID");
    }
  }

  return { configured: missing.length === 0, missing: [...new Set(missing)], clientId, clientSecret, botToken, redirectUri, guildId, goal };
}

async function getCommunityOAuthConfig() {
  let stored = null;
  const raw = await loadEncryptedSetting("community_oauth_config");
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = null;
    }
  }

  return normalizeCommunityOAuthConfig(stored ?? {
    clientId: process.env.DISCORD_OAUTH_CLIENT_ID,
    clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET,
    botToken: process.env.DISCORD_BOT_TOKEN,
    redirectUri: process.env.DISCORD_OAUTH_REDIRECT_URI,
    guildId: process.env.DISCORD_TARGET_GUILD_ID,
    goal: process.env.COMMUNITY_JOIN_GOAL
  });
}

async function requestDiscord(pathname, init = {}) {
  const response = await fetch(`${discordApiBase}/${String(pathname).replace(/^\/+/, "")}`, {
    ...init,
    signal: AbortSignal.timeout(15_000)
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  return { response, payload };
}

let communityGuildCache = null;
let communityPoolRunPromise = null;

async function loadCommunityGuild(config) {
  if (communityGuildCache?.guildId === config.guildId && communityGuildCache.expiresAt > Date.now()) {
    return communityGuildCache.value;
  }

  const { response, payload } = await requestDiscord(`guilds/${encodeURIComponent(config.guildId)}?with_counts=true`, {
    headers: { Authorization: `Bot ${config.botToken}` }
  });
  if (!response.ok) {
    const error = new Error("The community bot could not access the configured Discord server.");
    error.statusCode = 502;
    throw error;
  }

  const value = {
    id: String(payload?.id ?? config.guildId),
    name: String(payload?.name ?? "Discord Community"),
    iconUrl: payload?.icon
      ? `https://cdn.discordapp.com/icons/${encodeURIComponent(config.guildId)}/${encodeURIComponent(payload.icon)}.png?size=256`
      : null,
    memberCount: Number.isFinite(payload?.approximate_member_count)
      ? payload.approximate_member_count
      : Number.isFinite(payload?.member_count) ? payload.member_count : null
  };
  communityGuildCache = { guildId: config.guildId, expiresAt: Date.now() + 30_000, value };
  return value;
}

async function loadCommunityJoinSummary(config) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'joined')::int AS joined,
       COUNT(*) FILTER (WHERE status = 'already_member')::int AS already_member,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*)::int AS authorized,
       COUNT(*) FILTER (WHERE status = 'authorized')::int AS ready
     FROM community_oauth_joins
     WHERE guild_id = $1`,
    [config.guildId]
  );
  const row = result.rows[0] ?? {};
  const joined = Number(row.joined ?? 0);
  const authorized = Number(row.authorized ?? 0);
  return {
    goal: config.goal,
    joined,
    remaining: Math.max(0, config.goal - authorized),
    authorized,
    ready: Number(row.ready ?? 0),
    alreadyMember: Number(row.already_member ?? 0),
    failed: Number(row.failed ?? 0),
    syncing: Boolean(communityPoolRunPromise)
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function refreshCommunityAccessToken(config, encryptedRefreshToken) {
  const refreshToken = decryptCredential(encryptedRefreshToken);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  const result = await requestDiscord("oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const accessToken = String(result.payload?.access_token ?? "").trim();
  const nextRefreshToken = String(result.payload?.refresh_token ?? "").trim();
  if (!result.response.ok || !accessToken || !nextRefreshToken) {
    const error = new Error("Discord authorization could not be refreshed.");
    error.statusCode = 401;
    throw error;
  }
  return { accessToken, refreshToken: nextRefreshToken };
}

async function addAuthorizedCommunityMember(config, member) {
  const credentials = await refreshCommunityAccessToken(config, member.encrypted_refresh_token);
  await pool.query(
    "UPDATE community_oauth_joins SET encrypted_refresh_token = $3 WHERE discord_user_id = $1 AND guild_id = $2",
    [member.discord_user_id, config.guildId, encryptCredential(credentials.refreshToken)]
  );

  let addResult = await requestDiscord(`guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(member.discord_user_id)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${config.botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ access_token: credentials.accessToken })
  });
  if (addResult.response.status === 429) {
    const retryAfterMs = Math.min(Math.max(Number(addResult.payload?.retry_after ?? 1) * 1000, 1_000), 60_000);
    await sleep(retryAfterMs);
    addResult = await requestDiscord(`guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(member.discord_user_id)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${config.botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ access_token: credentials.accessToken })
    });
  }

  if (addResult.response.status === 201 || addResult.response.status === 204) {
    const status = addResult.response.status === 201 ? "joined" : "already_member";
    await pool.query(
      `UPDATE community_oauth_joins
       SET status = $3,
           details = NULL,
           encrypted_refresh_token = NULL,
           joined_at = CASE WHEN $3 = 'joined' THEN NOW() ELSE joined_at END
       WHERE discord_user_id = $1 AND guild_id = $2`,
      [member.discord_user_id, config.guildId, status]
    );
    return;
  }

  const error = new Error(`Discord returned ${addResult.response.status}.`);
  error.statusCode = addResult.response.status;
  throw error;
}

async function runCommunityPool(config) {
  const members = await pool.query(
    `SELECT discord_user_id, encrypted_refresh_token
     FROM community_oauth_joins
     WHERE guild_id = $1 AND status = 'authorized' AND encrypted_refresh_token IS NOT NULL
     ORDER BY authorized_at ASC`,
    [config.guildId]
  );

  for (const member of members.rows) {
    try {
      await addAuthorizedCommunityMember(config, member);
    } catch (error) {
      await pool.query(
        `UPDATE community_oauth_joins SET status = 'failed', details = $3
         WHERE discord_user_id = $1 AND guild_id = $2`,
        [member.discord_user_id, config.guildId, error instanceof Error ? error.message.slice(0, 200) : "Join failed."]
      );
    }
    await sleep(350);
  }
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

function getDcordOrderTokensSettingKey(uniqid) {
  return `dcord_order_tokens_${hashToken(String(uniqid ?? "").trim())}`;
}

async function loadDcordOrderTokens(uniqid) {
  if (!uniqid) return [];
  const raw = await loadEncryptedSetting(getDcordOrderTokensSettingKey(uniqid));
  if (!raw) return [];

  try {
    const tokens = JSON.parse(raw);
    return Array.isArray(tokens) ? tokens.map((token) => String(token ?? "").trim()) : [];
  } catch {
    return [];
  }
}

async function saveDcordOrderTokens(uniqid, tokens) {
  const normalized = Array.isArray(tokens) ? tokens.map((token) => String(token ?? "").trim()) : [];
  await saveEncryptedSetting(getDcordOrderTokensSettingKey(uniqid), JSON.stringify(normalized));
  return normalized;
}

async function revealDcordOrderTokens(order) {
  if (!order || typeof order !== "object" || Array.isArray(order) || !Array.isArray(order.dcordResults)) return order;

  const assignedTokens = await loadDcordOrderTokens(order.uniqid);
  const usedTokenIds = order.dcordResults
    .map((result) => result && typeof result === "object" && !Array.isArray(result) ? result.usedTokenId : null)
    .filter(Boolean);
  const usedTokenById = new Map();
  if (usedTokenIds.length) {
    let history = await loadUsedBoostTokenHistory();
    const existingIds = new Set(history.map((item) => item.id));
    const recoveredRows = order.dcordResults.flatMap((result, index) => {
      if (!result || typeof result !== "object" || Array.isArray(result) || !result.usedTokenId || existingIds.has(result.usedTokenId) || !assignedTokens[index]) {
        return [];
      }
      return [{
        id: result.usedTokenId,
        token: assignedTokens[index],
        redactedToken: redactToken(assignedTokens[index]),
        duration: order.duration,
        orderId: order.uniqid,
        serverId: order.serverId,
        serverName: order.serverName,
        usedAt: typeof order.createdAt === "string" ? order.createdAt : new Date().toISOString(),
        resultAt: new Date().toISOString(),
        status: typeof result.status === "string" ? result.status : "unknown",
        success: result.success === true,
        boosted: result.boosted === true,
        boostMessage: typeof result.boostMessage === "string" ? result.boostMessage : undefined
      }];
    });
    if (recoveredRows.length) {
      history = await mutateUsedBoostTokenHistory((current) => {
        const currentIds = new Set(current.map((item) => item.id));
        return [...recoveredRows.filter((item) => !currentIds.has(item.id)), ...current];
      });
    }
    history.forEach((item) => {
      if (usedTokenIds.includes(item.id)) usedTokenById.set(item.id, item.token);
    });
  }

  return {
    ...order,
    dcordResults: order.dcordResults.map((result, index) => {
      if (!result || typeof result !== "object" || Array.isArray(result)) return result;
      const fullToken = assignedTokens[index] || usedTokenById.get(result.usedTokenId);
      return fullToken ? { ...result, token: fullToken } : result;
    })
  };
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

function normalizeUsedBoostTokenHistory(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const token = String(item.token ?? "").trim();
      const duration = Number.parseInt(item.duration, 10);
      const usedAt = String(item.usedAt ?? "").trim();
      if (!token || ![1, 3].includes(duration) || !usedAt) return null;
      return {
        id: String(item.id ?? crypto.randomUUID()),
        token,
        redactedToken: String(item.redactedToken ?? redactToken(token)),
        duration,
        orderId: typeof item.orderId === "string" ? item.orderId : undefined,
        serverId: typeof item.serverId === "string" ? item.serverId : undefined,
        serverName: typeof item.serverName === "string" ? item.serverName : undefined,
        usedAt,
        resultAt: typeof item.resultAt === "string" ? item.resultAt : undefined,
        status: typeof item.status === "string" ? item.status : "pending",
        success: item.success === true,
        boosted: item.boosted === true,
        boostMessage: typeof item.boostMessage === "string" ? item.boostMessage : undefined,
        replacementFor: typeof item.replacementFor === "string" ? item.replacementFor : undefined
      };
    })
    .filter(Boolean);
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

async function loadUsedBoostTokenHistory() {
  const raw = await loadEncryptedSetting("dcord_boost_token_usage");
  if (!raw) return [];

  try {
    return normalizeUsedBoostTokenHistory(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function saveUsedBoostTokenHistory(history) {
  const normalized = normalizeUsedBoostTokenHistory(history).slice(0, 5000);
  await saveEncryptedSetting("dcord_boost_token_usage", JSON.stringify(normalized));
  return normalized;
}

let usedBoostTokenHistoryMutation = Promise.resolve();

async function mutateUsedBoostTokenHistory(mutator) {
  const operation = usedBoostTokenHistoryMutation.then(async () => {
    const history = await loadUsedBoostTokenHistory();
    const nextHistory = await mutator(history);
    return saveUsedBoostTokenHistory(nextHistory);
  });
  usedBoostTokenHistoryMutation = operation.then(() => undefined, () => undefined);
  return operation;
}

async function recordUsedBoostToken({ token, duration, order, replacementFor }) {
  const entry = {
    id: crypto.randomUUID(),
    token,
    redactedToken: redactToken(token),
    duration,
    orderId: order?.uniqid,
    serverId: order?.serverId,
    serverName: order?.serverName,
    usedAt: new Date().toISOString(),
    status: "pending",
    success: false,
    boosted: false,
    replacementFor
  };
  await mutateUsedBoostTokenHistory((history) => [entry, ...history]);
  return entry;
}

async function updateUsedBoostTokenResult(id, result) {
  await mutateUsedBoostTokenHistory((history) => history.map((entry) => {
    if (entry.id !== id) return entry;
    return {
      ...entry,
      resultAt: new Date().toISOString(),
      status: typeof result.status === "string" ? result.status : "unknown",
      success: result.success === true,
      boosted: result.boosted === true,
      boostMessage: typeof result.boostMessage === "string" ? result.boostMessage : undefined
    };
  }));
}

async function getBoostTokenStockSnapshot() {
  const stock = await loadBoostTokenStock();
  return {
    stock: summarizeBoostTokenStock(stock),
    oneMonthTokens: stock.oneMonth,
    threeMonthTokens: stock.threeMonth,
    usedTokens: await loadUsedBoostTokenHistory()
  };
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
  const joined = result?.success === true;
  return {
    token: redactToken(token),
    success: joined,
    status: boosted ? "joined + boosted" : result?.success === true ? "joined" : typeof result?.status === "string" ? result.status : "unknown",
    joinStatus: joined ? "joined" : "failed",
    boostStatus: boosted ? "boosted" : joined ? "failed" : "waiting",
    slots: boosted ? 2 : 0,
    boost: Boolean(result?.boost),
    boostMessage,
    httpStatus: Number.isFinite(result?.http_status) ? result.http_status : undefined,
    boosted
  };
}

function createQueuedDcordResult(token) {
  return {
    token: redactToken(token),
    success: false,
    status: "queued",
    joinStatus: "waiting",
    boostStatus: "waiting",
    slots: null,
    boost: false,
    boostMessage: "Waiting for worker.",
    boosted: false
  };
}

async function runDcordBoostToken(token, invite) {
  try {
    const result = await requestDcord(dcordJoinPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, invite, boost: true })
    });
    return normalizeDcordJoinResult(result, token);
  } catch (error) {
    return {
      token: redactToken(token),
      success: false,
      status: "error",
      joinStatus: "failed",
      boostStatus: "skipped",
      slots: 0,
      boost: false,
      boostMessage: error instanceof Error ? error.message : "Dcord join failed.",
      boosted: false
    };
  }
}

async function processDcordBoostOrder(order, tokens, invite) {
  const results = tokens.map(createQueuedDcordResult);
  let nextIndex = 0;
  let progressSave = Promise.resolve();

  async function saveCurrentProgress() {
    progressSave = progressSave.then(async () => {
      const added = results.reduce((total, item) => total + (item?.boosted ? 2 : 0), 0);
      const finished = results.every((item) => !["queued", "joining"].includes(String(item?.status ?? "").toLowerCase()));
      await saveTrackedOrderPayload({
        ...order,
        added,
        status: finished ? (added >= order.amount ? "COMPLETED" : added > 0 ? "PARTIAL" : "ERROR") : "PROCESS",
        details: finished
          ? added >= order.amount
            ? `${added}/${order.amount} boosts completed.`
            : `${added}/${order.amount} boosts completed. Review failed tokens in the payload.`
          : `${added}/${order.amount} boosts completed.`,
        dcordResults: results
      });
    });
    await progressSave;
  }

  async function runNextToken() {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= tokens.length) return;

    const token = tokens[index];
    results[index] = {
      ...results[index],
      status: "joining",
      joinStatus: "joining",
      boostStatus: "waiting",
      boostMessage: "Join + boost request is running."
    };
    await saveCurrentProgress();

    const usageEntry = await recordUsedBoostToken({ token, duration: order.duration, order });
    const normalized = await runDcordBoostToken(token, invite);
    await updateUsedBoostTokenResult(usageEntry.id, normalized);
    results[index] = { ...normalized, usedTokenId: usageEntry.id };
    await saveCurrentProgress();
    await runNextToken();
  }

  const workerCount = Math.min(tokens.length, dcordBoostConcurrency);
  await Promise.all(Array.from({ length: workerCount }, () => runNextToken()));
  await saveCurrentProgress();
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_oauth_states (
      state_hash TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS community_oauth_states_expires_at_idx ON community_oauth_states (expires_at)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_oauth_joins (
      discord_user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar_url TEXT,
      encrypted_refresh_token TEXT,
      status TEXT NOT NULL,
      details TEXT,
      authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      joined_at TIMESTAMPTZ,
      PRIMARY KEY (discord_user_id, guild_id)
    )
  `);
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT");
  await pool.query("CREATE INDEX IF NOT EXISTS community_oauth_joins_guild_status_idx ON community_oauth_joins (guild_id, status)");
  await pool.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
  await pool.query("DELETE FROM community_oauth_states WHERE expires_at <= NOW()");
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

async function hasActiveSession(req) {
  const token = parseCookies(req.headers.cookie)[sessionCookie];
  if (!token) return false;

  const result = await pool.query(
    "SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1",
    [hashToken(token)]
  );
  return Boolean(result.rowCount);
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

app.get("/api/community/config", requireSession, async (_req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    const storedResult = await pool.query("SELECT 1 FROM app_settings WHERE setting_key = 'community_oauth_config' LIMIT 1");
    res.set("Cache-Control", "no-store").json({
      configured: config.configured,
      stored: Boolean(storedResult.rowCount),
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      guildId: config.guildId,
      goal: config.goal,
      hasClientSecret: Boolean(config.clientSecret),
      hasBotToken: Boolean(config.botToken)
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/community/config", requireSession, async (req, res, next) => {
  try {
    if (communityPoolRunPromise) return res.status(409).json({ message: "Wait for the current member run to finish before changing bot settings." });
    const current = await getCommunityOAuthConfig();
    const candidate = normalizeCommunityOAuthConfig({
      clientId: req.body?.clientId || current.clientId,
      clientSecret: req.body?.clientSecret || current.clientSecret,
      botToken: req.body?.botToken || current.botToken,
      redirectUri: req.body?.redirectUri || current.redirectUri,
      guildId: req.body?.guildId || current.guildId,
      goal: req.body?.goal ?? current.goal
    });
    if (!candidate.configured) {
      return res.status(400).json({ message: "Complete all Discord bot and OAuth fields with valid values." });
    }

    const applicationResult = await requestDiscord("oauth2/applications/@me", {
      headers: { Authorization: `Bot ${candidate.botToken}` }
    });
    if (!applicationResult.response.ok) {
      return res.status(400).json({ message: "Bot token could not be verified." });
    }
    if (String(applicationResult.payload?.id ?? "") !== candidate.clientId) {
      return res.status(400).json({ message: "Bot token and Client ID belong to different Discord applications." });
    }

    const guildResult = await requestDiscord(`guilds/${encodeURIComponent(candidate.guildId)}?with_counts=true`, {
      headers: { Authorization: `Bot ${candidate.botToken}` }
    });
    if (!guildResult.response.ok) {
      return res.status(400).json({ message: "The bot is not able to access the selected Discord server." });
    }

    await saveEncryptedSetting("community_oauth_config", JSON.stringify({
      clientId: candidate.clientId,
      clientSecret: candidate.clientSecret,
      botToken: candidate.botToken,
      redirectUri: candidate.redirectUri,
      guildId: candidate.guildId,
      goal: candidate.goal
    }));
    communityGuildCache = null;
    res.json({
      configured: true,
      stored: true,
      clientId: candidate.clientId,
      redirectUri: candidate.redirectUri,
      guildId: candidate.guildId,
      goal: candidate.goal,
      hasClientSecret: true,
      hasBotToken: true,
      guildName: String(guildResult.payload?.name ?? "Discord server")
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/community/config", requireSession, async (_req, res, next) => {
  try {
    if (communityPoolRunPromise) return res.status(409).json({ message: "Wait for the current member run to finish before removing bot settings." });
    await pool.query("DELETE FROM app_settings WHERE setting_key = 'community_oauth_config'");
    communityGuildCache = null;
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/public", async (_req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.set("Cache-Control", "no-store").json({
        configured: false,
        goal: config.goal,
        joined: 0,
        authorized: 0,
        remaining: config.goal
      });
    }

    const [guild, summary] = await Promise.all([
      loadCommunityGuild(config),
      loadCommunityJoinSummary(config)
    ]);
    res.set("Cache-Control", "no-store").json({ configured: true, guild, ...summary });
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/oauth/start", async (req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.redirect(303, "/join?result=unavailable");

    const cooldownKey = req.ip;
    const cooldownUntil = communityOauthStartCooldowns.get(cooldownKey) ?? 0;
    if (cooldownUntil > Date.now()) return res.redirect(303, "/join?result=wait");

    const summary = await loadCommunityJoinSummary(config);
    if (summary.remaining <= 0) return res.redirect(303, "/join?result=full");

    const state = crypto.randomBytes(32).toString("base64url");
    await pool.query("DELETE FROM community_oauth_states WHERE expires_at <= NOW()");
    await pool.query(
      "INSERT INTO community_oauth_states (state_hash, expires_at) VALUES ($1, $2)",
      [hashToken(state), new Date(Date.now() + communityOauthStateDurationMs)]
    );
    communityOauthStartCooldowns.set(cooldownKey, Date.now() + 2_000);

    const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("scope", "identify guilds.join");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "consent");
    res.redirect(303, authorizeUrl.toString());
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/oauth/callback", async (req, res) => {
  const redirectWithResult = (result) => res.redirect(303, `/join?result=${encodeURIComponent(result)}`);
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return redirectWithResult("unavailable");
    if (req.query.error) return redirectWithResult("cancelled");

    const code = String(req.query.code ?? "").trim();
    const state = String(req.query.state ?? "").trim();
    if (!code || !state || code.length > 2048 || state.length > 256) return redirectWithResult("invalid");

    const consumedState = await pool.query(
      "DELETE FROM community_oauth_states WHERE state_hash = $1 AND expires_at > NOW() RETURNING state_hash",
      [hashToken(state)]
    );
    if (!consumedState.rowCount) return redirectWithResult("expired");

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri
    });
    const tokenResult = await requestDiscord("oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: tokenBody
    });
    const accessToken = String(tokenResult.payload?.access_token ?? "").trim();
    const refreshToken = String(tokenResult.payload?.refresh_token ?? "").trim();
    const grantedScopes = String(tokenResult.payload?.scope ?? "").split(/\s+/).filter(Boolean);
    if (!tokenResult.response.ok || !accessToken || !refreshToken || !grantedScopes.includes("guilds.join")) {
      return redirectWithResult("authorization_failed");
    }

    const userResult = await requestDiscord("users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userId = String(userResult.payload?.id ?? "").trim();
    if (!userResult.response.ok || !isDiscordGuildId(userId)) return redirectWithResult("profile_failed");

    const username = String(userResult.payload?.global_name ?? userResult.payload?.username ?? "Discord member").slice(0, 100);
    const avatarHash = String(userResult.payload?.avatar ?? "").trim();
    const avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(userId)}/${encodeURIComponent(avatarHash)}.png?size=128`
      : null;
    await pool.query(
      `INSERT INTO community_oauth_joins
        (discord_user_id, guild_id, username, avatar_url, encrypted_refresh_token, status, details, authorized_at, joined_at)
       VALUES ($1, $2, $3, $4, $5, 'authorized', NULL, NOW(), NULL)
       ON CONFLICT (discord_user_id, guild_id) DO UPDATE SET
         username = EXCLUDED.username,
         avatar_url = EXCLUDED.avatar_url,
         encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         status = CASE
           WHEN community_oauth_joins.status IN ('joined', 'already_member') THEN community_oauth_joins.status
           ELSE 'authorized'
         END,
         details = NULL,
         authorized_at = NOW()`,
      [userId, config.guildId, username, avatarUrl, encryptCredential(refreshToken)]
    );
    return redirectWithResult("authorized");
  } catch (error) {
    console.error("Community OAuth callback failed:", error instanceof Error ? error.message : error);
    return redirectWithResult("error");
  }
});

app.get("/api/community/status", requireSession, async (_req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.set("Cache-Control", "no-store").json({
        configured: false,
        missing: config.missing,
        goal: config.goal,
        joined: 0,
        remaining: config.goal,
        authorized: 0,
        ready: 0,
        alreadyMember: 0,
        failed: 0,
        syncing: false,
        recent: []
      });
    }

    const [guild, summary, recentResult] = await Promise.all([
      loadCommunityGuild(config),
      loadCommunityJoinSummary(config),
      pool.query(
        `SELECT username, avatar_url, status, details, authorized_at, joined_at
         FROM community_oauth_joins
         WHERE guild_id = $1
         ORDER BY authorized_at DESC
         LIMIT 50`,
        [config.guildId]
      )
    ]);
    res.set("Cache-Control", "no-store").json({
      configured: true,
      guild,
      ...summary,
      recent: recentResult.rows.map((row) => ({
        username: row.username,
        avatarUrl: row.avatar_url,
        status: row.status,
        details: row.details,
        authorizedAt: row.authorized_at,
        joinedAt: row.joined_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/add-members", requireSession, async (_req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Community OAuth is not configured." });
    if (communityPoolRunPromise) return res.status(409).json({ message: "Members are already being added." });

    const summary = await loadCommunityJoinSummary(config);
    if (!summary.ready) return res.status(409).json({ message: "There are no authorized members waiting to be added." });

    communityPoolRunPromise = runCommunityPool(config)
      .catch((error) => console.error("Community member run failed:", error instanceof Error ? error.message : error))
      .finally(() => {
        communityPoolRunPromise = null;
      });
    res.status(202).json({ started: true, count: summary.ready });
  } catch (error) {
    next(error);
  }
});

app.get("/api/public/orders/:uniqid/status", async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    const boostTokenStock = summarizeBoostTokenStock(await loadBoostTokenStock());
    const liveBoostStock = {
      oneMonth: boostTokenStock.oneMonth * 2,
      threeMonth: boostTokenStock.threeMonth * 2
    };

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    let trackedPayload = tracked.rows[0]?.payload;
    if (
      trackedPayload &&
      typeof trackedPayload === "object" &&
      !Array.isArray(trackedPayload) &&
      (trackedPayload.provider === "dcord" || trackedPayload.service === "DCORD-BOOSTS")
    ) {
      if ((!trackedPayload.serverName || !Number.isFinite(trackedPayload.serverMemberCount)) && typeof trackedPayload.serverInvite === "string" && trackedPayload.serverInvite.trim()) {
        try {
          const inviteInfo = await resolveDiscordInvite(trackedPayload.serverInvite);
          trackedPayload = {
            ...trackedPayload,
            serverId: trackedPayload.serverId ?? inviteInfo.guildId,
            serverName: trackedPayload.serverName ?? inviteInfo.guildName,
            serverMemberCount: Number.isFinite(trackedPayload.serverMemberCount) ? trackedPayload.serverMemberCount : inviteInfo.approximateMemberCount
          };
          await saveTrackedOrderPayload(trackedPayload);
        } catch {
          // Keep the public monitor available even if Discord metadata lookup fails.
        }
      }
      const canManageDcordTokens = await hasActiveSession(req);
      if (canManageDcordTokens) {
        const managedPayload = await revealDcordOrderTokens(trackedPayload);
        return res.set("Cache-Control", "no-store").json({ ...managedPayload, liveBoostStock, canManageDcordTokens });
      }

      const { dcordResults, ...publicPayload } = trackedPayload;
      return res.set("Cache-Control", "no-store").json({ ...publicPayload, liveBoostStock, canManageDcordTokens });
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
      ? { ...payload, liveBoostStock, delayUpdateCooldownSeconds, restartCooldownSeconds }
      : { data: payload, liveBoostStock, delayUpdateCooldownSeconds, restartCooldownSeconds };
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
        threeMonthTokens: stock.threeMonth,
        usedTokens: await loadUsedBoostTokenHistory()
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
      threeMonthTokens: nextStock.threeMonth,
      usedTokens: await loadUsedBoostTokenHistory()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/dcord/boost-stock/mark-used", requireSession, async (req, res, next) => {
  try {
    const duration = Number.parseInt(req.body?.duration, 10);
    if (![1, 3].includes(duration)) {
      return res.status(400).json({ message: "A valid boost duration is required." });
    }

    const requestedTokens = new Set(normalizeBoostTokenList(req.body?.tokens));
    if (!requestedTokens.size) {
      return res.status(400).json({ message: "At least one token is required." });
    }

    const stock = await loadBoostTokenStock();
    const stockKey = duration === 3 ? "threeMonth" : "oneMonth";
    const tokensToMove = stock[stockKey].filter((token) => requestedTokens.has(token));
    if (!tokensToMove.length) {
      return res.status(404).json({ message: "Selected tokens could not be found in active stock." });
    }

    const usedAt = new Date().toISOString();
    const manualUsageRows = tokensToMove.map((token) => ({
      id: crypto.randomUUID(),
      token,
      redactedToken: redactToken(token),
      duration,
      usedAt,
      resultAt: usedAt,
      status: "used",
      success: false,
      boosted: false,
      boostMessage: "Moved manually from active stock."
    }));
    const nextHistory = await mutateUsedBoostTokenHistory((history) => [...manualUsageRows, ...history]);
    const nextStock = await saveBoostTokenStock({
      ...stock,
      [stockKey]: stock[stockKey].filter((token) => !requestedTokens.has(token))
    });

    res.json({
      stock: summarizeBoostTokenStock(nextStock),
      oneMonthTokens: nextStock.oneMonth,
      threeMonthTokens: nextStock.threeMonth,
      usedTokens: nextHistory
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/dcord/boost-stock/return-used", requireSession, async (req, res, next) => {
  try {
    const usageIds = normalizeBoostTokenList(req.body?.ids ?? req.body?.id);
    if (!usageIds.length) {
      return res.status(400).json({ message: "At least one used token row is required." });
    }

    const history = await loadUsedBoostTokenHistory();
    const usageIdSet = new Set(usageIds);
    const usedTokens = history.filter((item) => usageIdSet.has(item.id));
    if (!usedTokens.length) {
      return res.status(404).json({ message: "Used token could not be found." });
    }

    const stock = await loadBoostTokenStock();
    const nextStockInput = {
      oneMonth: [...stock.oneMonth],
      threeMonth: [...stock.threeMonth]
    };
    for (const usedToken of usedTokens) {
      const stockKey = usedToken.duration === 3 ? "threeMonth" : "oneMonth";
      if (!nextStockInput[stockKey].includes(usedToken.token)) {
        nextStockInput[stockKey].unshift(usedToken.token);
      }
    }
    const nextStock = await saveBoostTokenStock({
      oneMonth: nextStockInput.oneMonth,
      threeMonth: nextStockInput.threeMonth
    });
    const nextHistory = await mutateUsedBoostTokenHistory((current) => current.filter((item) => !usageIdSet.has(item.id)));

    res.json({
      stock: summarizeBoostTokenStock(nextStock),
      oneMonthTokens: nextStock.oneMonth,
      threeMonthTokens: nextStock.threeMonth,
      usedTokens: nextHistory
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/dcord/boost-stock/delete-used", requireSession, async (req, res, next) => {
  try {
    const usageIds = normalizeBoostTokenList(req.body?.ids);
    if (!usageIds.length) {
      return res.status(400).json({ message: "At least one used token row is required." });
    }

    const usageIdSet = new Set(usageIds);
    await mutateUsedBoostTokenHistory((history) => history.filter((item) => !usageIdSet.has(item.id)));
    res.json(await getBoostTokenStockSnapshot());
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
      serverName: serverInfo.guildName,
      serverInvite: String(req.body?.id ?? "").trim(),
      serverMemberCount: serverInfo.approximateMemberCount,
      amount,
      added: 0,
      duration,
      tokenCount: requiredTokens,
      createdAt: new Date().toISOString(),
      status: "PROCESS",
      details: `0/${amount} boosts completed.`,
      dcordResults: selectedTokens.map(createQueuedDcordResult)
    };

    await saveDcordOrderTokens(uniqid, selectedTokens);
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
      (!trackedPayload.serverName || !Number.isFinite(trackedPayload.serverMemberCount)) &&
      typeof trackedPayload.serverInvite === "string" &&
      trackedPayload.serverInvite.trim()
    ) {
      try {
        const inviteInfo = await resolveDiscordInvite(trackedPayload.serverInvite);
        trackedPayload = {
          ...trackedPayload,
          serverId: trackedPayload.serverId ?? inviteInfo.guildId,
          serverName: trackedPayload.serverName ?? inviteInfo.guildName,
          serverMemberCount: Number.isFinite(trackedPayload.serverMemberCount)
            ? trackedPayload.serverMemberCount
            : inviteInfo.approximateMemberCount
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

    let payload = tracked.rows[0].payload;
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      (!payload.serverName || !Number.isFinite(payload.serverMemberCount)) &&
      typeof payload.serverInvite === "string" &&
      payload.serverInvite.trim()
    ) {
      try {
        const inviteInfo = await resolveDiscordInvite(payload.serverInvite);
        payload = {
          ...payload,
          serverId: payload.serverId ?? inviteInfo.guildId,
          serverName: payload.serverName ?? inviteInfo.guildName,
          serverMemberCount: Number.isFinite(payload.serverMemberCount) ? payload.serverMemberCount : inviteInfo.approximateMemberCount
        };
        await saveTrackedOrderPayload(payload);
      } catch {
        // Keep the private lookup available even if Discord metadata lookup fails.
      }
    }

    res.set("Cache-Control", "no-store").json(await revealDcordOrderTokens(payload));
  } catch (error) {
    next(error);
  }
});

app.post("/api/dcord/boost-orders/:uniqid/replace-token", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const resultIndex = Number.parseInt(req.body?.resultIndex, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isInteger(resultIndex) || resultIndex < 0) {
      return res.status(400).json({ message: "A valid order ID and token row are required." });
    }

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || typeof order !== "object" || Array.isArray(order) || (order.provider !== "dcord" && order.service !== "DCORD-BOOSTS")) {
      return res.status(404).json({ message: "Boost order could not be found." });
    }
    if (String(order.status ?? "").trim().toUpperCase() === "PROCESS") {
      return res.status(409).json({ message: "Wait until the boost order finishes before replacing failed tokens." });
    }

    const results = Array.isArray(order.dcordResults) ? [...order.dcordResults] : [];
    const currentResult = results[resultIndex];
    if (!currentResult || typeof currentResult !== "object" || Array.isArray(currentResult)) {
      return res.status(404).json({ message: "Token result could not be found." });
    }
    if (currentResult.boosted === true) {
      return res.status(409).json({ message: "Only failed token results can be replaced." });
    }

    const duration = Number.parseInt(order.duration, 10);
    if (![1, 3].includes(duration)) {
      return res.status(400).json({ message: "Boost duration is missing from this order." });
    }

    const invite = extractDiscordInviteCode(order.serverInvite);
    if (!invite) {
      return res.status(400).json({ message: "Server invite is missing from this order." });
    }

    const stock = await loadBoostTokenStock();
    const stockKey = duration === 3 ? "threeMonth" : "oneMonth";
    const replacementToken = stock[stockKey][0];
    if (!replacementToken) {
      return res.status(409).json({ message: `No ${duration} month replacement tokens are in stock.` });
    }

    await saveBoostTokenStock({
      ...stock,
      [stockKey]: stock[stockKey].slice(1)
    });

    const usageEntry = await recordUsedBoostToken({
      token: replacementToken,
      duration,
      order,
      replacementFor: typeof currentResult.token === "string" ? currentResult.token : undefined
    });
    const normalizedReplacement = await runDcordBoostToken(replacementToken, invite);
    await updateUsedBoostTokenResult(usageEntry.id, normalizedReplacement);

    const replacementResult = {
      ...normalizedReplacement,
      usedTokenId: usageEntry.id,
      replaced: true,
      replacedAt: new Date().toISOString(),
      replacedResultIndex: resultIndex,
      previousToken: typeof currentResult.token === "string" ? currentResult.token : undefined
    };
    results[resultIndex] = replacementResult;
    const assignedTokens = await loadDcordOrderTokens(uniqid);
    assignedTokens[resultIndex] = replacementToken;
    await saveDcordOrderTokens(uniqid, assignedTokens);

    const added = results.reduce((total, item) => {
      return total + (item && typeof item === "object" && !Array.isArray(item) && item.boosted === true ? 2 : 0);
    }, 0);
    const amount = Number.isFinite(Number(order.amount)) ? Number(order.amount) : added;
    const completed = added >= amount;
    const nextOrder = {
      ...order,
      added,
      status: completed ? "COMPLETED" : added > 0 ? "PARTIAL" : "ERROR",
      details: completed
        ? `${added}/${amount} boosts completed.`
        : `${added}/${amount} boosts completed. Review failed tokens in the payload.`,
      dcordResults: results
    };

    await saveTrackedOrderPayload(nextOrder);
    res.set("Cache-Control", "no-store").json({
      order: await revealDcordOrderTokens(nextOrder),
      stock: summarizeBoostTokenStock(await loadBoostTokenStock())
    });
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
      const existing = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
      const existingPayload = existing.rows[0]?.payload;
      const isDcordOrder =
        existingPayload &&
        typeof existingPayload === "object" &&
        !Array.isArray(existingPayload) &&
        (existingPayload.provider === "dcord" || existingPayload.service === "DCORD-BOOSTS");
      const nextPayload = isDcordOrder ? existingPayload : { ...order, uniqid };

      await client.query(
        `INSERT INTO tracked_orders (uniqid, payload, created_at, updated_at)
         VALUES ($1, $2::jsonb, COALESCE(($2::jsonb->>'createdAt')::timestamptz, NOW()), NOW())
         ON CONFLICT (uniqid) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [uniqid, JSON.stringify(nextPayload)]
      );
    }

    const deletedOrders = ids.length
      ? await client.query("DELETE FROM tracked_orders WHERE NOT (uniqid = ANY($1::text[])) RETURNING uniqid", [ids])
      : await client.query("DELETE FROM tracked_orders RETURNING uniqid");
    const deletedTokenSettingKeys = deletedOrders.rows.map((row) => getDcordOrderTokensSettingKey(row.uniqid));
    if (deletedTokenSettingKeys.length) {
      await client.query("DELETE FROM app_settings WHERE setting_key = ANY($1::text[])", [deletedTokenSettingKeys]);
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
