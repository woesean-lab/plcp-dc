import crypto from "node:crypto";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import pg from "pg";

const { Pool } = pg;
const execFile = promisify(execFileCallback);
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
const dcordTaskCreatePath = process.env.DCORD_TASK_CREATE_PATH ?? "/api/task/create";
const dcordTaskStatusPath = process.env.DCORD_TASK_STATUS_PATH ?? "/api/task/status";
const dcordUserAgent = process.env.DCORD_USER_AGENT ?? "plcp-dc/0.1 (+https://capheaven.dcord.co API client)";
const defaultDcordBoostConcurrency = 7;
const dcordRequestTimeoutMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_REQUEST_TIMEOUT_MS ?? "30000", 10) || 30_000, 10_000), 120_000);
const dcordTaskPollIntervalMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_TASK_POLL_INTERVAL_MS ?? "3000", 10) || 3_000, 2_000), 10_000);
const dcordTaskMaxWaitMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_TASK_MAX_WAIT_MS ?? "620000", 10) || 620_000, 60_000), 900_000);
const dcordRetryBaseMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_RETRY_BASE_MS ?? "30000", 10) || 30_000, 10_000), 300_000);
const dcordRetryMaxMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_RETRY_MAX_MS ?? "600000", 10) || 600_000, dcordRetryBaseMs), 3_600_000);
const dcordMaxRetryAttempts = Math.min(Math.max(Number.parseInt(process.env.DCORD_MAX_RETRY_ATTEMPTS ?? "12", 10) || 12, 1), 100);
const discordApiBase = "https://discord.com/api/v10";
const communityOauthStateDurationMs = 10 * 60 * 1000;
const publicDelayCooldownMs = 60 * 1000;
const publicDelayCooldowns = new Map();
const publicRestartCooldownMs = 60 * 1000;
const publicRestartCooldowns = new Map();
const publicCommunityReplaceCooldownMs = 60 * 1000;
const publicCommunityReplaceCooldowns = new Map();
const communityOauthStartCooldowns = new Map();
const dcordOrderProcessingJobs = new Set();
const dcordOrderRetryTimers = new Map();
let dcordCircuitOpenUntil = 0;
let dcordCircuitFailureCount = 0;

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

  return { configured: missing.length === 0, missing: [...new Set(missing)], clientId, clientSecret, botToken, redirectUri, guildId };
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
    guildId: process.env.DISCORD_TARGET_GUILD_ID
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
let communityBotCache = null;

function fallbackCommunityBot(config) {
  return {
    id: String(config?.clientId ?? "members-bot"),
    name: "Members Bot",
    username: "Members Bot",
    avatarUrl: null,
    unavailable: true
  };
}

function fallbackCommunityGuild(config) {
  return {
    id: String(config?.guildId ?? "community"),
    name: "Discord Community",
    iconUrl: null,
    memberCount: null,
    unavailable: true
  };
}

async function loadCommunityBot(config) {
  if (communityBotCache?.clientId === config.clientId && communityBotCache.expiresAt > Date.now()) {
    return communityBotCache.value;
  }

  const { response, payload } = await requestDiscord("users/@me", {
    headers: { Authorization: `Bot ${config.botToken}` }
  });
  if (!response.ok) {
    const error = new Error("The Members bot identity could not be loaded.");
    error.statusCode = 502;
    throw error;
  }

  const id = String(payload?.id ?? config.clientId);
  const avatar = typeof payload?.avatar === "string" ? payload.avatar : null;
  const value = {
    id,
    name: String(payload?.global_name ?? payload?.username ?? "Members Bot"),
    username: String(payload?.username ?? "Members Bot"),
    avatarUrl: avatar
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(id)}/${encodeURIComponent(avatar)}.png?size=256`
      : null
  };
  communityBotCache = { clientId: config.clientId, expiresAt: Date.now() + 60_000, value };
  return value;
}

async function loadCommunityBotSafe(config) {
  try {
    return await loadCommunityBot(config);
  } catch {
    return fallbackCommunityBot(config);
  }
}

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

async function loadCommunityGuildSafe(config) {
  try {
    return await loadCommunityGuild(config);
  } catch {
    return fallbackCommunityGuild(config);
  }
}

async function checkCommunityMemberVerification(config, guildId, invite, { requireExplicitEnabled = false } = {}) {
  try {
    const params = new URLSearchParams({
      with_guild: "false",
      invite_code: invite
    });
    const { response, payload } = await requestDiscord(
      `guilds/${encodeURIComponent(guildId)}/member-verification?${params.toString()}`,
      { headers: { Authorization: `Bot ${config.botToken}` } }
    );
    if (response.status === 404) {
      return { status: "closed", enabled: false };
    }
    if (!response.ok) {
      return { status: "unknown", enabled: false };
    }
    const fields = Array.isArray(payload?.form_fields) ? payload.form_fields : [];
    const explicitlyEnabled = payload?.enabled === true
      || payload?.is_enabled === true
      || payload?.verification_form_enabled === true
      || payload?.member_verification_enabled === true;
    const enabled = fields.length > 0 && (!requireExplicitEnabled || explicitlyEnabled);
    return {
      status: enabled ? "open" : "closed",
      enabled,
      fields: fields.length
    };
  } catch {
    return { status: "unknown", enabled: false };
  }
}

async function checkDcordBoostMembershipScreening(invite, serverInfo) {
  const config = await getCommunityOAuthConfig();
  if (!config.botToken || !isDiscordGuildId(String(serverInfo?.guildId ?? ""))) {
    return { status: "unknown", enabled: false };
  }
  return checkCommunityMemberVerification(config, serverInfo.guildId, invite, { requireExplicitEnabled: true });
}

async function loadCommunityJoinSummary(config) {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'joined')::int AS joined,
       COUNT(*) FILTER (WHERE status = 'already_member')::int AS already_member,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE encrypted_refresh_token IS NOT NULL AND status <> 'failed')::int AS authorized,
       COUNT(*) FILTER (WHERE encrypted_refresh_token IS NOT NULL AND status <> 'failed' AND reserved_order_id IS NULL)::int AS ready
     FROM community_oauth_joins
     WHERE guild_id = $1`,
    [config.guildId]
  );
  const row = result.rows[0] ?? {};
  const joined = Number(row.joined ?? 0);
  const authorized = Number(row.authorized ?? 0);
  return {
    joined,
    authorized,
    ready: Number(row.ready ?? 0),
    alreadyMember: Number(row.already_member ?? 0),
    failed: Number(row.failed ?? 0)
  };
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
  const returnedIndexes = order.dcordResults.flatMap((result, index) =>
    String(result?.status ?? "").trim().toLowerCase() === "returned" ? [index] : []
  );
  if (returnedIndexes.length) {
    const returnedUsageIds = new Set(returnedIndexes.map((index) => order.dcordResults[index]?.usedTokenId).filter(Boolean));
    const returnedTokens = new Set(returnedIndexes.map((index) => assignedTokens[index]).filter(Boolean));
    await mutateUsedBoostTokenHistory((history) => history.filter((item) => !(
      item.orderId === order.uniqid
      && (returnedUsageIds.has(item.id) || returnedTokens.has(item.token))
    )));
    const cleanedResults = order.dcordResults.map((result, index) => {
      if (!returnedIndexes.includes(index) || !result || typeof result !== "object" || Array.isArray(result) || !result.usedTokenId) return result;
      const cleaned = { ...result };
      delete cleaned.usedTokenId;
      return cleaned;
    });
    if (cleanedResults.some((result, index) => result !== order.dcordResults[index])) {
      order = { ...order, dcordResults: cleanedResults };
      await saveTrackedOrderPayload(order);
    }
  }
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

function normalizeDcordStickyProxies(value) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(/[\r\n,]+/);
  const seen = new Set();
  const normalized = [];
  source.forEach((item) => {
    const proxy = String(item ?? "").trim();
    if (!proxy || proxy.length > 1000 || seen.has(proxy)) return;
    seen.add(proxy);
    normalized.push(proxy);
  });
  return normalized.slice(0, 1000);
}

async function loadDcordStickyProxies() {
  const raw = await loadEncryptedSetting("dcord_sticky_proxies");
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return normalizeDcordStickyProxies(parsed);
  } catch {
    return normalizeDcordStickyProxies(raw);
  }
}

async function saveDcordStickyProxies(value) {
  const normalized = normalizeDcordStickyProxies(value);
  await saveEncryptedSetting("dcord_sticky_proxies", JSON.stringify(normalized));
  return normalized;
}

function pickDcordStickyProxy(proxies, token) {
  if (!Array.isArray(proxies) || !proxies.length) return "";
  const digest = crypto.createHash("sha256").update(String(token ?? "")).digest();
  const index = digest.readUInt32BE(0) % proxies.length;
  return proxies[index];
}

function normalizeDcordBoostConcurrency(value) {
  return Math.min(Math.max(Number.parseInt(value, 10) || defaultDcordBoostConcurrency, 1), 20);
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
      typeof payload === "object" && payload && ("message" in payload || "detail" in payload)
        ? String(payload.message ?? payload.detail)
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

function resolveDcordApiUrl(pathname) {
  const base = new URL(dcordApiBase);
  const requested = String(pathname ?? "").trim();
  const normalized = requested.replace(/^\/+/, "");
  if (normalized.startsWith("api/")) return new URL(`/${normalized}`, base.origin);
  return new URL(requested, `${dcordApiBase.replace(/\/$/, "")}/`);
}

function isDcordUpstreamVerificationMessage(message) {
  return /upstream verification|awaiting upstream verification|did not confirm task creation/i.test(String(message ?? ""));
}

function summarizeDcordRawResponse(text, limit = 700) {
  return String(text ?? "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function parseDcordResponseText(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text;
  }
}

function createDcordHtmlResponseError({ status, contentType, text }) {
  const bodySummary = summarizeDcordRawResponse(text);
  const error = new Error(
    `Dcord raw response: HTTP ${status}, content-type: ${contentType || "unknown"}, body: ${bodySummary || "(empty response)"}`
  );
  error.statusCode = status;
  error.contentType = contentType || "unknown";
  error.rawResponseSummary = bodySummary;
  error.uncertain = !/challenge-platform|__cf_chl|just a moment|sorry, you have been blocked|unable to access|attention required/i.test(String(text ?? ""));
  error.providerBlocked = true;
  return error;
}

async function requestDcordWithWget(url, init, headers) {
  const method = String(init.method ?? "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) throw new Error(`Dcord wget fallback does not support ${method}.`);

  const args = ["-S", "-O", "-"];
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    args.push(`--header=${name}: ${String(value)}`);
  }
  if (method === "POST") {
    args.push(`--post-data=${typeof init.body === "string" ? init.body : String(init.body ?? "")}`);
  }
  args.push(String(url));

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFile("wget", args, {
      timeout: dcordRequestTimeoutMs,
      maxBuffer: 1024 * 1024
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    stdout = String(error?.stdout ?? "");
    stderr = String(error?.stderr ?? "");
    if (!stdout && !stderr) throw error;
  }

  const statusMatches = [...stderr.matchAll(/\bHTTP\/\S+\s+(\d{3})\b/gi)];
  const status = Number(statusMatches.at(-1)?.[1] ?? 0);
  const contentTypeMatches = [...stderr.matchAll(/\bContent-Type:\s*([^\r\n]+)/gi)];
  const contentType = String(contentTypeMatches.at(-1)?.[1] ?? "unknown").trim();
  const payload = parseDcordResponseText(stdout);

  if (typeof payload === "string" && /<!doctype html|<html|cloudflare|just a moment/i.test(payload)) {
    throw createDcordHtmlResponseError({ status: status || 403, contentType, text: payload });
  }

  if (status < 200 || status >= 300) {
    const message = typeof payload === "object" && payload && ("message" in payload || "detail" in payload)
      ? String(payload.message ?? payload.detail)
      : typeof payload === "string" && payload
        ? payload
        : `Dcord request failed with ${status || "unknown status"}.`;
    const error = new Error(message);
    error.statusCode = status || undefined;
    error.uncertain = status >= 500 || status === 0;
    error.providerBlocked = isDcordUpstreamVerificationMessage(message);
    throw error;
  }

  return payload;
}

async function requestDcord(pathname, init = {}) {
  const url = resolveDcordApiUrl(pathname);
  const headers = {
    "X-API-Key": await loadDcordApiKey(),
    Accept: "application/json",
    "User-Agent": dcordUserAgent,
    ...(init.headers ?? {})
  };
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(dcordRequestTimeoutMs),
    headers
  });
  const text = await response.text();
  let payload = parseDcordResponseText(text);

  if (typeof payload === "string" && /<!doctype html|<html|cloudflare|just a moment/i.test(payload)) {
    if (process.env.DCORD_WGET_FALLBACK !== "false") {
      return requestDcordWithWget(url, init, headers);
    }
    throw createDcordHtmlResponseError({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "unknown",
      text: payload
    });
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload && ("message" in payload || "detail" in payload)
      ? String(payload.message ?? payload.detail)
      : typeof payload === "string" && payload
        ? payload
        : `Dcord request failed with ${response.status}.`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.uncertain = response.status >= 500;
    error.providerBlocked = isDcordUpstreamVerificationMessage(message);
    throw error;
  }

  return payload;
}

function isUncertainDcordTransportResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.boosted === true) return false;
  if (result.transportUncertain === true) return true;
  const message = String(result.boostMessage ?? result.message ?? "").toLowerCase();
  if (/dcord request failed with 5\d\d/.test(message)) return true;
  return [
    "fetch failed",
    "timeout",
    "timed out",
    "socket",
    "network",
    "connection",
    "upstream verification",
    "cloudflare",
    "just a moment",
    "<!doctype html",
    "<html"
  ].some((value) => message.includes(value));
}

function isDcordCloudflareBlockedResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.dcordTaskId) return false;
  const message = String(result.boostMessage ?? result.message ?? "").toLowerCase();
  return result.providerBlocked === true
    || isDcordUpstreamVerificationMessage(message)
    || (Number(result.httpStatus) === 403 && /cloudflare|did not confirm task creation/.test(message));
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

function createCommunityOrderId() {
  return `members_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

async function saveTrackedOrderPayload(payload) {
  await pool.query(
    `INSERT INTO tracked_orders (uniqid, payload, created_at, updated_at)
     VALUES ($1, $2::jsonb, COALESCE(($2::jsonb->>'createdAt')::timestamptz, NOW()), NOW())
     ON CONFLICT (uniqid) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
    [payload.uniqid, JSON.stringify(payload)]
  );
}

async function refreshCommunityAccessToken(config, encryptedRefreshToken) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: decryptCredential(encryptedRefreshToken)
  });
  const { response, payload } = await requestDiscord("oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok || typeof payload?.access_token !== "string") {
    const error = new Error("Discord authorization could not be renewed.");
    error.statusCode = response.status;
    error.discordError = typeof payload?.error === "string" ? payload.error : null;
    throw error;
  }
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : decryptCredential(encryptedRefreshToken)
  };
}

async function revokeCommunityAuthorization(config, encryptedRefreshToken) {
  const body = new URLSearchParams({
    token: decryptCredential(encryptedRefreshToken),
    token_type_hint: "refresh_token"
  });
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");
  const { response } = await requestDiscord("oauth2/token/revoke", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) {
    const error = new Error("Discord authorization could not be revoked. The user was not removed from Members Stock.");
    error.statusCode = 502;
    throw error;
  }
}

async function syncCommunityAuthorizations(config) {
  const result = await pool.query(
    `SELECT discord_user_id, encrypted_refresh_token
     FROM community_oauth_joins
     WHERE guild_id = $1 AND encrypted_refresh_token IS NOT NULL AND status <> 'failed'
     ORDER BY authorized_at ASC`,
    [config.guildId]
  );
  const summary = { checked: 0, inactive: 0, removed: 0, errors: 0 };

  for (const member of result.rows) {
    summary.checked += 1;
    try {
      const credentials = await refreshCommunityAccessToken(config, member.encrypted_refresh_token);
      await pool.query(
        `UPDATE community_oauth_joins
         SET encrypted_refresh_token = $3, details = NULL
         WHERE discord_user_id = $1 AND guild_id = $2`,
        [member.discord_user_id, config.guildId, encryptCredential(credentials.refreshToken)]
      );
    } catch (error) {
      if (error?.statusCode === 400 && error?.discordError === "invalid_grant") {
        const inactive = await pool.query(
          `UPDATE community_oauth_joins
           SET status = 'failed', details = 'Discord authorization expired.', reserved_order_id = NULL
           WHERE discord_user_id = $1 AND guild_id = $2`,
          [member.discord_user_id, config.guildId]
        );
        summary.inactive += inactive.rowCount;
        summary.removed = summary.inactive;
      } else {
        summary.errors += 1;
      }
    }
  }

  return summary;
}

async function addCommunityGuildMember(config, discordUserId, accessToken) {
  let result = await requestDiscord(`guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(discordUserId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${config.botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ access_token: accessToken })
  });
  if (result.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(result.payload?.retry_after) || 1, 1), 30);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    result = await requestDiscord(`guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(discordUserId)}`, {
      method: "PUT",
      headers: { Authorization: `Bot ${config.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken })
    });
  }
  return result;
}

function isCommunityMembershipScreeningResponse(result) {
  const body = result?.payload;
  const message = String(body?.message ?? "").toLowerCase();
  const code = Number(body?.code);
  if (body && typeof body === "object" && !Array.isArray(body) && body.pending === true) return true;
  return code === 40007
    || code === 40033
    || /pending|screening|verification|member verification|membership/i.test(message);
}

function isDiscordUnknownUser(value) {
  const payload = value?.payload && typeof value.payload === "object" ? value.payload : value;
  const code = Number(payload?.code ?? value?.code);
  const message = String(payload?.message ?? value?.message ?? value?.details ?? value?.discordError ?? "");
  return code === 10013 || /unknown user/i.test(message);
}

async function processCommunityOrder(order, members, config) {
  const results = members.map((member) => ({
    discordUserId: member.discord_user_id,
    username: member.username,
    avatarUrl: member.avatar_url ?? null,
    state: "queued",
    details: "Waiting for delivery."
  }));
  let added = 0;
  let blockedByMembershipScreening = false;

  async function saveCommunityProgress(payload) {
    const latest = await pool.query("SELECT payload->>'delay' AS delay FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [order.uniqid]);
    const latestDelay = Number.parseInt(latest.rows[0]?.delay, 10);
    if (Number.isFinite(latestDelay) && latestDelay > 0) order.delay = latestDelay;
    await saveTrackedOrderPayload({ ...payload, delay: order.delay });
  }

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    results[index] = { discordUserId: member.discord_user_id, username: member.username, avatarUrl: member.avatar_url ?? null, state: "joining", details: "Discord membership request is running." };
    await saveCommunityProgress({ ...order, added, status: "PROCESS", details: `${added}/${order.amount} members delivered.`, communityResults: results });

    let state = "failed";
    let details = "Member could not be added.";
    let markStockInactive = false;
    try {
      const credentials = await refreshCommunityAccessToken(config, member.encrypted_refresh_token);
      await pool.query(
        "UPDATE community_oauth_joins SET encrypted_refresh_token = $3 WHERE discord_user_id = $1 AND guild_id = $2",
        [member.discord_user_id, config.guildId, encryptCredential(credentials.refreshToken)]
      );
      const joined = await addCommunityGuildMember(config, member.discord_user_id, credentials.accessToken);
      if (isCommunityMembershipScreeningResponse(joined)) {
        state = "blocked";
        details = "Discord membership screening is enabled on this server.";
        blockedByMembershipScreening = true;
      } else if (joined.response.status === 201) {
        state = "joined";
        details = "Member joined the server.";
        added += 1;
      } else if (joined.response.status === 204) {
        state = "already_member";
        details = "User was already in the server.";
      } else {
        details = typeof joined.payload?.message === "string" ? joined.payload.message : `Discord request failed (${joined.response.status}).`;
        markStockInactive = isDiscordUnknownUser(joined);
      }
    } catch (error) {
      details = error instanceof Error ? error.message : details;
      markStockInactive = isDiscordUnknownUser(error);
    }

    results[index] = { discordUserId: member.discord_user_id, username: member.username, avatarUrl: member.avatar_url ?? null, state, details, completedAt: new Date().toISOString() };
    await pool.query(
      `UPDATE community_oauth_joins
       SET status = CASE WHEN $4 THEN 'failed' ELSE 'authorized' END, details = $3,
           joined_at = CASE WHEN $5 IN ('joined', 'already_member') THEN NOW() ELSE joined_at END,
           reserved_order_id = NULL
       WHERE discord_user_id = $1 AND guild_id = $2`,
      [member.discord_user_id, config.guildId, details, markStockInactive, state]
    );
    await saveCommunityProgress({ ...order, added, status: "PROCESS", details: `${added}/${order.amount} members delivered.`, communityResults: results });

    if (blockedByMembershipScreening) {
      results.forEach((result, resultIndex) => {
        if (resultIndex <= index) return;
        results[resultIndex] = {
          ...result,
          state: "queued",
          details: "Delivery stopped before this member was used."
        };
      });
      await pool.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id = $1", [order.uniqid]);
      await saveCommunityProgress({
        ...order,
        added,
        status: "ERROR",
        details: "Discord membership screening is enabled on this server. Disable the join form before starting Members 2 delivery.",
        communityResults: results
      });
      return;
    }

    if (index < members.length - 1) {
      const latestOrder = await pool.query("SELECT payload->>'delay' AS delay FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [order.uniqid]);
      const currentDelay = Number.parseInt(latestOrder.rows[0]?.delay, 10);
      if (Number.isFinite(currentDelay) && currentDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, currentDelay * 1000));
      }
    }
  }

  const status = added >= order.amount ? "COMPLETED" : added > 0 ? "PARTIAL" : "ERROR";
  await saveCommunityProgress({
    ...order,
    added,
    status,
    details: added >= order.amount ? `${added}/${order.amount} members delivered.` : `${added}/${order.amount} members delivered. Review the member results.`,
    communityResults: results
  });
}

async function processCommunityReplacement(orderId, resultIndex, member, config) {
  let state = "failed";
  let details = "Replacement member could not be added.";
  let markStockInactive = false;
  try {
    const credentials = await refreshCommunityAccessToken(config, member.encrypted_refresh_token);
    await pool.query(
      "UPDATE community_oauth_joins SET encrypted_refresh_token = $3 WHERE discord_user_id = $1 AND guild_id = $2",
      [member.discord_user_id, config.guildId, encryptCredential(credentials.refreshToken)]
    );
    const joined = await addCommunityGuildMember(config, member.discord_user_id, credentials.accessToken);
    if (isCommunityMembershipScreeningResponse(joined)) {
      state = "blocked";
      details = "Discord membership screening is enabled on this server.";
    } else if (joined.response.status === 201) {
      state = "joined";
      details = "Replacement member joined the server.";
    } else if (joined.response.status === 204) {
      details = "Replacement user was already in the server.";
    } else {
      details = typeof joined.payload?.message === "string" ? joined.payload.message : `Discord request failed (${joined.response.status}).`;
      markStockInactive = isDiscordUnknownUser(joined);
    }
  } catch (error) {
    details = error instanceof Error ? error.message : details;
    markStockInactive = isDiscordUnknownUser(error);
  }

  await pool.query(
    `UPDATE community_oauth_joins
     SET status = CASE WHEN $3 THEN 'failed' ELSE 'authorized' END, details = $4,
         joined_at = CASE WHEN $5 = 'joined' THEN NOW() ELSE joined_at END,
         reserved_order_id = NULL
     WHERE discord_user_id = $1 AND guild_id = $2`,
    [member.discord_user_id, config.guildId, markStockInactive, details, state]
  );

  const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [orderId]);
  const order = tracked.rows[0]?.payload;
  if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) return;
  const results = [...order.communityResults];
  const current = results[resultIndex];
  if (!current || current.discordUserId !== member.discord_user_id || String(current.state).toLowerCase() !== "replacing") return;

  results[resultIndex] = {
    ...current,
    state,
    details,
    completedAt: new Date().toISOString()
  };
  const added = results.filter((item) => String(item?.state ?? "").toLowerCase() === "joined").length;
  const amount = Number(order.amount) || results.length;
  await saveTrackedOrderPayload({
    ...order,
    added,
    status: added >= amount ? "COMPLETED" : added > 0 ? "PARTIAL" : "ERROR",
    details: added >= amount ? `${added}/${amount} members delivered.` : `${added}/${amount} members delivered. Review the member results.`,
    communityResults: results
  });
}

function normalizeDcordJoinResult(result, token) {
  const rawBoostMessage = String(result?.boost_message ?? result?.boostMessage ?? result?.message ?? "").trim();
  const membershipScreeningBlocked = isDcordBoostMembershipScreeningMessage(rawBoostMessage);
  const boostMessage = membershipScreeningBlocked
    ? "Membership screening is enabled on this server. Disable the join form before boosting."
    : rawBoostMessage;
  const boostState = String(result?.boost_status ?? result?.boostStatus ?? "").trim().toLowerCase();
  const joinState = String(result?.join_status ?? result?.joinStatus ?? result?.status ?? "").trim().toLowerCase();
  const boosted = result?.boost === true || result?.boosted === true || boostState === "boosted" || boostMessage.toLowerCase().includes("boosted");
  const joined = result?.success === true || result?.joined === true || ["ok", "joined", "completed", "success"].includes(joinState);
  return {
    token: redactToken(token),
    success: joined || boosted,
    status: boosted ? "joined + boosted" : membershipScreeningBlocked ? "blocked" : joined ? "joined" : typeof result?.status === "string" ? result.status : "unknown",
    joinStatus: joined || boosted ? "joined" : "failed",
    boostStatus: boosted ? "boosted" : membershipScreeningBlocked ? "blocked" : joined ? (boostState || "failed") : "waiting",
    slots: boosted ? 2 : 0,
    boost: boosted,
    boostMessage,
    httpStatus: Number.isFinite(result?.http_status) ? result.http_status : undefined,
    boosted
  };
}

function isDcordBoostMembershipScreeningMessage(message) {
  const value = String(message ?? "").toLowerCase();
  return value.includes("boost put")
    && value.includes("unknown guild")
    && (value.includes("code=10004") || value.includes("code: 10004") || value.includes("10004"));
}

function extractDcordApiToken(stockToken) {
  const value = String(stockToken ?? "").trim();
  if (!value.includes(":")) return value;
  return value.split(":").at(-1)?.trim() ?? value;
}

function getDcordTaskId(payload) {
  const candidates = [payload?.task_id, payload?.taskId, payload?.data?.task_id, payload?.data?.taskId];
  const value = candidates.find((candidate) => typeof candidate === "string" || Number.isFinite(candidate));
  return value === undefined ? null : String(value).trim() || null;
}

function getDcordTaskStatus(payload) {
  return String(payload?.status ?? payload?.data?.status ?? "").trim().toLowerCase();
}

function isDcordTaskPendingResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result) || !result.dcordTaskId) return false;
  return ["queued", "joining", "processing", "verifying", "pending"].includes(String(result.status ?? "").toLowerCase());
}

function isDcordUnconfirmedRunningResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result) || result.dcordTaskId) return false;
  return String(result.status ?? "").toLowerCase() === "joining";
}

function isRunnableDcordResult(result) {
  return String(result?.status ?? "").toLowerCase() === "queued"
    || isDcordTaskPendingResult(result)
    || isDcordUnconfirmedRunningResult(result)
    || isDcordCloudflareBlockedResult(result);
}

function normalizeDcordTaskResult(payload, token, taskId) {
  const taskPayload = payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : payload;
  const result = taskPayload?.result && typeof taskPayload.result === "object" && !Array.isArray(taskPayload.result)
    ? taskPayload.result
    : taskPayload;
  const taskStatus = getDcordTaskStatus(payload);
  if (taskStatus === "failed") {
    const rawMessage = String(result?.message ?? result?.detail ?? taskPayload?.message ?? "Dcord task failed.").trim();
    const membershipScreeningBlocked = isDcordBoostMembershipScreeningMessage(rawMessage);
    const message = membershipScreeningBlocked
      ? "Membership screening is enabled on this server. Disable the join form before boosting."
      : rawMessage;
    return {
      token: redactToken(token), success: false, status: membershipScreeningBlocked ? "blocked" : "error", joinStatus: membershipScreeningBlocked ? "joined" : "failed", boostStatus: membershipScreeningBlocked ? "blocked" : "skipped",
      slots: 0, boost: false, boostMessage: message || "Dcord task failed.", boosted: false,
      dcordTaskId: taskId, dcordTaskStatus: taskStatus, taskPending: false, transportUncertain: false
    };
  }
  return {
    ...normalizeDcordJoinResult(result, token),
    dcordTaskId: taskId,
    dcordTaskStatus: taskStatus || "completed",
    taskPending: false,
    transportUncertain: false
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

function getDcordRetryDelay(retryCount) {
  const exponent = Math.min(Math.max(Number(retryCount) || 0, 0), 6);
  return Math.min(dcordRetryBaseMs * (2 ** exponent), dcordRetryMaxMs);
}

function markDcordProviderFailure() {
  dcordCircuitFailureCount += 1;
  const delay = getDcordRetryDelay(dcordCircuitFailureCount - 1);
  dcordCircuitOpenUntil = Date.now() + delay;
  return delay;
}

function markDcordProviderHealthy() {
  dcordCircuitFailureCount = 0;
  dcordCircuitOpenUntil = 0;
}

async function checkDcordProviderAvailability() {
  if (dcordCircuitOpenUntil > Date.now()) {
    return { available: false, recovering: true, retryAfterMs: dcordCircuitOpenUntil - Date.now() };
  }
  return { available: true, recovering: dcordCircuitFailureCount > 0, retryAfterMs: 0 };
}

function scheduleDcordOrderRetry(uniqid, delayMs) {
  const orderId = String(uniqid ?? "").trim();
  if (!orderId || dcordOrderRetryTimers.has(orderId)) return;
  const timer = setTimeout(() => {
    dcordOrderRetryTimers.delete(orderId);
    void resumeDcordBoostOrder(orderId).catch((error) => {
      console.error("Dcord order resume failed:", error instanceof Error ? error.message : error);
      scheduleDcordOrderRetry(orderId, getDcordRetryDelay(1));
    });
  }, Math.max(Number(delayMs) || dcordRetryBaseMs, 1_000));
  timer.unref?.();
  dcordOrderRetryTimers.set(orderId, timer);
}

function canReturnDcordTokenResult(result, includeUncertain = false) {
  return String(result?.status ?? "").toLowerCase() === "queued"
    || (includeUncertain && !result?.dcordTaskId && isUncertainDcordTransportResult(result));
}

async function returnDcordTokensToStock(order, tokens, results, includeUncertain = false) {
  const duration = Number.parseInt(order?.duration, 10);
  if (![1, 3].includes(duration)) return 0;
  const returnedIndexes = results.flatMap((result, index) => canReturnDcordTokenResult(result, includeUncertain) ? [index] : []);
  const returnableTokens = returnedIndexes.map((index) => tokens[index]).filter(Boolean);
  if (!returnableTokens.length) return 0;

  const stock = await loadBoostTokenStock();
  const stockKey = duration === 3 ? "threeMonth" : "oneMonth";
  const existing = new Set([...stock.oneMonth, ...stock.threeMonth]);
  const returned = returnableTokens.filter((token) => !existing.has(token));
  if (returned.length) {
    await saveBoostTokenStock({ ...stock, [stockKey]: [...stock[stockKey], ...returned] });
  }
  const returnedUsageIds = new Set(returnedIndexes.map((index) => results[index]?.usedTokenId).filter(Boolean));
  if (returnedUsageIds.size) {
    await mutateUsedBoostTokenHistory((history) => history.filter((item) => !returnedUsageIds.has(item.id)));
  }
  return returnableTokens.length;
}

async function runDcordBoostToken(token, invite, options = {}) {
  let taskId = options.existingTaskId ? String(options.existingTaskId) : null;
  try {
    if (!taskId) {
      const createPayload = { type: "join", token: extractDcordApiToken(token), invite, boost: true };
      const proxy = String(options.proxy ?? "").trim();
      if (proxy) createPayload.proxy = proxy;
      const created = await requestDcord(dcordTaskCreatePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload)
      });
      taskId = getDcordTaskId(created);
      if (!taskId) throw new Error("Dcord created a task without returning a task ID.");
      await options.onTaskCreated?.(taskId);
    }

    const deadline = Date.now() + dcordTaskMaxWaitMs;
    let lastStatus = "pending";
    while (Date.now() < deadline) {
      try {
        const payload = await requestDcord(`${dcordTaskStatusPath}?task_id=${encodeURIComponent(taskId)}`, {
          method: "GET",
          cache: "no-store"
        });
        lastStatus = getDcordTaskStatus(payload) || lastStatus;
        if (["completed", "failed"].includes(lastStatus)) return normalizeDcordTaskResult(payload, token, taskId);
      } catch {
        // Keep polling the same task; creating a duplicate task would risk double delivery.
      }
      await new Promise((resolve) => setTimeout(resolve, dcordTaskPollIntervalMs));
    }

    return {
      token: redactToken(token), success: false, status: "verifying", joinStatus: "verifying", boostStatus: "verifying",
      slots: null, boost: false, boostMessage: "Dcord task is still processing. Its result will be checked again.", boosted: false,
      dcordTaskId: taskId, dcordTaskStatus: lastStatus, taskPending: true, transportUncertain: true
    };
  } catch (error) {
    const statusCode = Number(error?.statusCode);
    const message = error instanceof Error ? error.message : "Dcord join failed.";
    if (taskId) {
      return {
        token: redactToken(token),
        success: false,
        status: "verifying",
        joinStatus: "verifying",
        boostStatus: "verifying",
        slots: null,
        boost: false,
        boostMessage: "Dcord accepted the task. Its result will be checked again.",
        httpStatus: Number.isFinite(statusCode) ? statusCode : undefined,
        boosted: false,
        transportUncertain: true,
        taskPending: true,
        dcordTaskId: taskId,
        dcordTaskStatus: "pending"
      };
    }
    if (error?.providerBlocked === true) {
      const blockedMessage = isDcordUpstreamVerificationMessage(message)
        ? `${message} Delivery will retry automatically.`
        : `${message} Delivery was paused.`;
      return {
        token: redactToken(token),
        success: false,
        status: "queued",
        joinStatus: "not submitted",
        boostStatus: "not submitted",
        slots: null,
        boost: false,
        boostMessage: blockedMessage,
        httpStatus: Number.isFinite(statusCode) ? statusCode : 403,
        boosted: false,
        transportUncertain: false,
        providerBlocked: true
      };
    }
    const transportUncertain = error?.uncertain === true
      || [408, 425, 429].includes(statusCode)
      || statusCode >= 500
      || ["AbortError", "TimeoutError"].includes(String(error?.name))
      || /fetch failed|timeout|timed out|socket|network|connection/i.test(message);
    return {
      token: redactToken(token),
      success: false,
      status: transportUncertain ? "verifying" : "error",
      joinStatus: transportUncertain ? "verifying" : "failed",
      boostStatus: transportUncertain ? "verifying" : "skipped",
      slots: transportUncertain ? null : 0,
      boost: false,
      boostMessage: transportUncertain
        ? `POST /api/task/create was not confirmed: ${message} The token will not be sent again without a task ID.`
        : message,
      httpStatus: Number.isFinite(statusCode) ? statusCode : undefined,
      boosted: false,
      transportUncertain,
      dcordTaskId: taskId ?? undefined
    };
  }
}

async function processDcordBoostOrder(order, tokens, invite) {
  const orderId = String(order?.uniqid ?? "").trim();
  if (!orderId || dcordOrderProcessingJobs.has(orderId)) return;
  dcordOrderProcessingJobs.add(orderId);

  const results = tokens.map((token, index) => {
    const existing = order.dcordResults?.[index];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) return createQueuedDcordResult(token);
    if (String(existing.status ?? "").toLowerCase() !== "joining") return existing;
    if (existing.dcordTaskId) {
      return {
        ...existing,
        status: "verifying",
        joinStatus: "verifying",
        boostStatus: "verifying",
        boostMessage: "Resuming Dcord task status checks.",
        taskPending: true
      };
    }
    return {
      ...existing,
      status: "queued",
      joinStatus: "waiting",
      boostStatus: "waiting",
      boostMessage: "Previous Dcord request stopped before a task ID was saved. Retrying.",
      transportUncertain: false
    };
  });
  let nextIndex = 0;
  let progressSave = Promise.resolve();
  let providerPaused = false;
  let retryAfterMs = dcordRetryBaseMs;
  let retryCount = Number.parseInt(order.dcordRetryCount, 10) || 0;
  const stickyProxies = order.useProxy === true ? await loadDcordStickyProxies() : [];

  async function saveCurrentProgress(forceWaiting = false) {
    progressSave = progressSave.then(async () => {
      const added = results.reduce((total, item) => total + (item?.boosted ? 2 : 0), 0);
      const hasQueued = results.some((item) => String(item?.status ?? "").toLowerCase() === "queued");
      const hasRunning = results.some((item) => ["joining", "processing", "verifying", "pending"].includes(String(item?.status ?? "").toLowerCase()));
      const finished = !hasQueued && !hasRunning;
      const waitingForProvider = forceWaiting || providerPaused;
      await saveTrackedOrderPayload({
        ...order,
        added,
        status: waitingForProvider ? "WAITING" : finished ? (added >= order.amount ? "COMPLETED" : added > 0 ? "PARTIAL" : "ERROR") : "PROCESS",
        providerStatus: waitingForProvider ? "unavailable" : "available",
        dcordRetryCount: waitingForProvider ? retryCount : 0,
        nextRetryAt: waitingForProvider ? new Date(Date.now() + retryAfterMs).toISOString() : null,
        details: waitingForProvider
          ? hasQueued
            ? "Dcord is temporarily unavailable. Queued delivery will resume automatically."
            : "Dcord response is uncertain. The submitted tokens are being verified without a duplicate request."
          : finished
          ? added >= order.amount
            ? `${added}/${order.amount} boosts completed.`
            : `${added}/${order.amount} boosts completed. Review failed tokens in the payload.`
          : hasRunning && !hasQueued
            ? `${added}/${order.amount} boosts completed. Waiting for Dcord verification.`
            : `${added}/${order.amount} boosts completed.`,
        dcordResults: results
      });
    });
    await progressSave;
  }

  async function stopAfterOutage() {
    const returnedCount = await returnDcordTokensToStock(order, tokens, results);
    results.forEach((result, index) => {
      if (String(result?.status ?? "").toLowerCase() !== "queued") return;
      results[index] = {
        ...result,
        status: "returned",
        joinStatus: "not submitted",
        boostStatus: "not submitted",
        boostMessage: "Dcord remained unavailable. This token was returned to stock."
      };
    });
    const added = results.reduce((total, item) => total + (item?.boosted ? 2 : 0), 0);
    await saveTrackedOrderPayload({
      ...order,
      added,
      status: results.some(isUncertainDcordTransportResult) ? "WAITING" : added > 0 ? "PARTIAL" : "ERROR",
      providerStatus: "unavailable",
      dcordRetryCount: retryCount,
      nextRetryAt: null,
      returnedTokenCount: returnedCount,
      details: `${returnedCount} unsubmitted token${returnedCount === 1 ? " was" : "s were"} returned to stock after the Dcord outage.`,
      dcordResults: results
    });
  }

  async function runNextToken() {
    if (providerPaused) return;
    while (nextIndex < tokens.length && !isRunnableDcordResult(results[nextIndex])) nextIndex += 1;
    const index = nextIndex++;
    if (index >= tokens.length || providerPaused) return;

    const token = tokens[index];
    results[index] = {
      ...results[index],
      status: "joining",
      joinStatus: "joining",
      boostStatus: "waiting",
      boostMessage: "Join + boost request is running."
    };
    await saveCurrentProgress();

    let usedTokenId = results[index]?.usedTokenId;
    if (!usedTokenId) {
      const usageEntry = await recordUsedBoostToken({
        token,
        duration: order.duration,
        order,
        replacementFor: results[index]?.replacementFor
      });
      usedTokenId = usageEntry.id;
    }
    const existingTaskId = results[index]?.dcordTaskId;
    const normalized = await runDcordBoostToken(token, invite, {
      existingTaskId,
      proxy: existingTaskId ? "" : pickDcordStickyProxy(stickyProxies, token),
      onTaskCreated: async (taskId) => {
        results[index] = {
          ...results[index],
          status: "joining",
          joinStatus: "joining",
          boostStatus: "waiting",
          boostMessage: "Dcord accepted the task. Waiting for its result.",
          dcordTaskId: taskId,
          dcordTaskStatus: "pending",
          taskPending: true,
          usedTokenId
        };
        await saveCurrentProgress();
      }
    });
    if (normalized.providerBlocked === true) {
      await mutateUsedBoostTokenHistory((history) => history.filter((item) => item.id !== usedTokenId));
      const { usedTokenId: _unusedId, ...currentResult } = results[index];
      results[index] = { ...currentResult, ...normalized };
    } else {
      await updateUsedBoostTokenResult(usedTokenId, normalized);
      results[index] = { ...results[index], ...normalized, usedTokenId };
    }
    if (normalized.providerBlocked === true) {
      providerPaused = true;
      retryCount += 1;
      retryAfterMs = markDcordProviderFailure();
    } else if (normalized.taskPending === true) {
      retryAfterMs = dcordTaskPollIntervalMs;
    } else if (isUncertainDcordTransportResult(normalized)) {
      providerPaused = true;
      retryCount += 1;
      retryAfterMs = markDcordProviderFailure();
    } else {
      markDcordProviderHealthy();
    }
    await saveCurrentProgress();
    await runNextToken();
  }

  try {
    const hasRunnable = results.some(isRunnableDcordResult);
    const hasUnsubmitted = results.some((item) => String(item?.status ?? "").toLowerCase() === "queued");
    if (hasUnsubmitted) {
      if (retryCount >= dcordMaxRetryAttempts) {
        await stopAfterOutage();
        return;
      }
      const availability = await checkDcordProviderAvailability();
      if (!availability.available) {
        providerPaused = true;
        retryCount += 1;
        retryAfterMs = Math.max(availability.retryAfterMs, getDcordRetryDelay(retryCount - 1));
        if (retryCount >= dcordMaxRetryAttempts) {
          await stopAfterOutage();
          return;
        }
        await saveCurrentProgress(true);
        scheduleDcordOrderRetry(orderId, retryAfterMs);
        return;
      }
    }

    const workerCount = Math.min(tokens.length, normalizeDcordBoostConcurrency(order.concurrency));
    await Promise.all(Array.from({ length: workerCount }, () => runNextToken()));
    await saveCurrentProgress();
    if (providerPaused && (hasRunnable || results.some(isRunnableDcordResult))) {
      await saveCurrentProgress(true);
      scheduleDcordOrderRetry(orderId, retryAfterMs);
    }
  } finally {
    dcordOrderProcessingJobs.delete(orderId);
  }
}

async function resumeDcordBoostOrder(uniqid) {
  const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
  const order = tracked.rows[0]?.payload;
  if (!order || order.provider !== "dcord" || !Array.isArray(order.dcordResults)) return;
  if (!order.dcordResults.some(isRunnableDcordResult)) {
    return;
  }
  const tokens = await loadDcordOrderTokens(uniqid);
  const invite = extractDiscordInviteCode(order.serverInvite);
  if (!tokens.length || !invite) return;
  await processDcordBoostOrder(order, tokens, invite);
}

async function recoverStaleDcordBoostOrder(order) {
  const orderId = String(order?.uniqid ?? "").trim();
  if (!orderId || !order || order.provider !== "dcord" || !Array.isArray(order.dcordResults)) return order;
  if (dcordOrderProcessingJobs.has(orderId) || !order.dcordResults.some(isDcordUnconfirmedRunningResult)) return order;

  const recoveredOrder = {
    ...order,
    status: "PROCESS",
    details: "Recovering a Dcord request that stopped before a task ID was saved.",
    dcordResults: order.dcordResults.map((result) => {
      if (!isDcordUnconfirmedRunningResult(result)) return result;
      return {
        ...result,
        status: "queued",
        joinStatus: "waiting",
        boostStatus: "waiting",
        boostMessage: "Previous Dcord request stopped before a task ID was saved. Retrying.",
        transportUncertain: false
      };
    })
  };

  await saveTrackedOrderPayload(recoveredOrder);
  const tokens = await loadDcordOrderTokens(orderId);
  const invite = extractDiscordInviteCode(recoveredOrder.serverInvite);
  if (tokens.length && invite) {
    void processDcordBoostOrder(recoveredOrder, tokens, invite).catch((error) => {
      console.error("Stale Dcord order recovery failed:", error instanceof Error ? error.message : error);
    });
  }
  return recoveredOrder;
}

async function recoverPendingDcordOrders() {
  const pending = await pool.query(
    `SELECT uniqid, payload
     FROM tracked_orders
     WHERE payload->>'provider' = 'dcord'
       AND payload->>'status' IN ('PROCESS', 'WAITING', 'CANCELLED')`
  );
  for (const row of pending.rows) {
    const results = Array.isArray(row.payload?.dcordResults) ? row.payload.dcordResults : [];
    if (String(row.payload?.status ?? "").toUpperCase() !== "CANCELLED" && results.some(isRunnableDcordResult)) {
      const nextRetryAt = Date.parse(row.payload?.nextRetryAt ?? "");
      scheduleDcordOrderRetry(row.uniqid, Number.isFinite(nextRetryAt) ? Math.max(nextRetryAt - Date.now(), 1_000) : 1_000);
    }
  }
}

async function recoverBlockedDcordJobOrders() {
  const blocked = await pool.query(
    `SELECT uniqid, payload
     FROM tracked_orders
     WHERE payload->>'provider' = 'dcord'
       AND payload->>'dcordMode' = 'job'
       AND COALESCE(payload->>'dcordJobId', '') = ''
       AND COALESCE((payload->>'tokensReturnedToStock')::boolean, false) = false`
  );
  if (!blocked.rowCount) return;

  for (const row of blocked.rows) {
    const order = row.payload;
    const duration = Number.parseInt(order?.duration, 10);
    const tokens = await loadDcordOrderTokens(row.uniqid);
    if ([1, 3].includes(duration) && tokens.length) {
      const stock = await loadBoostTokenStock();
      const stockKey = duration === 3 ? "threeMonth" : "oneMonth";
      const existing = new Set([...stock.oneMonth, ...stock.threeMonth]);
      await saveBoostTokenStock({
        ...stock,
        [stockKey]: [...stock[stockKey], ...tokens.filter((token) => !existing.has(token))]
      });
      await mutateUsedBoostTokenHistory((history) => history.filter((item) => item.orderId !== row.uniqid));
    }
    await saveTrackedOrderPayload({
      ...order,
      status: "ERROR",
      details: "Dcord job was blocked before submission. Assigned tokens were returned to stock.",
      tokensReturnedToStock: true
    });
  }
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
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS reserved_order_id TEXT");
  await pool.query("CREATE INDEX IF NOT EXISTS community_oauth_joins_guild_status_idx ON community_oauth_joins (guild_id, status)");
  await pool.query("CREATE INDEX IF NOT EXISTS community_oauth_joins_reservation_idx ON community_oauth_joins (guild_id, reserved_order_id)");
  await pool.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id IS NOT NULL");
  await pool.query(`
    UPDATE tracked_orders
    SET payload = jsonb_set(
      jsonb_set(payload, '{status}', '"ERROR"'::jsonb),
      '{details}',
      '"Delivery was interrupted by a server restart. Create a new order for the remaining members."'::jsonb
    ), updated_at = NOW()
    WHERE payload->>'provider' = 'community' AND payload->>'status' = 'PROCESS'
  `);
  await pool.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
  await pool.query("DELETE FROM community_oauth_states WHERE expires_at <= NOW()");
  await recoverBlockedDcordJobOrders();
  await recoverPendingDcordOrders();
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
      hasClientSecret: Boolean(config.clientSecret),
      hasBotToken: Boolean(config.botToken)
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/community/config", requireSession, async (req, res, next) => {
  try {
    const current = await getCommunityOAuthConfig();
    const candidateWithoutDetectedGuild = normalizeCommunityOAuthConfig({
      clientId: req.body?.clientId || current.clientId,
      clientSecret: req.body?.clientSecret || current.clientSecret,
      botToken: req.body?.botToken || current.botToken,
      redirectUri: req.body?.redirectUri || current.redirectUri,
      guildId: current.guildId
    });
    if (candidateWithoutDetectedGuild.missing.some((item) => item !== "DISCORD_TARGET_GUILD_ID")) {
      return res.status(400).json({ message: "Complete all Discord bot and OAuth fields with valid values." });
    }

    const applicationResult = await requestDiscord("oauth2/applications/@me", {
      headers: { Authorization: `Bot ${candidateWithoutDetectedGuild.botToken}` }
    });
    if (!applicationResult.response.ok) {
      return res.status(400).json({ message: "Bot token could not be verified." });
    }
    if (String(applicationResult.payload?.id ?? "") !== candidateWithoutDetectedGuild.clientId) {
      return res.status(400).json({ message: "Bot token and Client ID belong to different Discord applications." });
    }

    const guildsResult = await requestDiscord("users/@me/guilds?limit=200", {
      headers: { Authorization: `Bot ${candidateWithoutDetectedGuild.botToken}` }
    });
    const botGuilds = Array.isArray(guildsResult.payload) ? guildsResult.payload : [];
    if (!guildsResult.response.ok || !botGuilds.length) {
      return res.status(400).json({ message: "Add the bot to your Discord server before saving these settings." });
    }
    const selectedGuild = botGuilds.length === 1
      ? botGuilds[0]
      : botGuilds.find((guild) => String(guild?.id ?? "") === current.guildId);
    if (!selectedGuild) {
      return res.status(400).json({ message: "This bot is in multiple servers. Keep it in the Members Stock server only, then save again." });
    }

    const candidate = normalizeCommunityOAuthConfig({
      ...candidateWithoutDetectedGuild,
      guildId: String(selectedGuild.id ?? "")
    });
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
      guildId: candidate.guildId
    }));
    communityGuildCache = null;
    communityBotCache = null;
    res.json({
      configured: true,
      stored: true,
      clientId: candidate.clientId,
      redirectUri: candidate.redirectUri,
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
    await pool.query("DELETE FROM app_settings WHERE setting_key = 'community_oauth_config'");
    communityGuildCache = null;
    communityBotCache = null;
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
        joined: 0,
        authorized: 0
      });
    }

    const [bot, guild, summary] = await Promise.all([
      loadCommunityBotSafe(config),
      loadCommunityGuildSafe(config),
      loadCommunityJoinSummary(config)
    ]);
    res.set("Cache-Control", "no-store").json({ configured: true, bot, guild, ...summary });
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
        joined: 0,
        authorized: 0,
        ready: 0,
        alreadyMember: 0,
        failed: 0,
        syncing: false,
        recent: []
      });
    }

    const [bot, guild, summary, recentResult] = await Promise.all([
      loadCommunityBotSafe(config),
      loadCommunityGuildSafe(config),
      loadCommunityJoinSummary(config),
      pool.query(
        `SELECT discord_user_id, username, avatar_url, status, details, authorized_at, joined_at, reserved_order_id
         FROM community_oauth_joins
         WHERE guild_id = $1 AND encrypted_refresh_token IS NOT NULL
         ORDER BY
           CASE
             WHEN status <> 'failed' AND reserved_order_id IS NULL THEN 0
             WHEN reserved_order_id IS NOT NULL THEN 1
             ELSE 2
           END,
           authorized_at DESC
         LIMIT 100`,
        [config.guildId]
      )
    ]);
    res.set("Cache-Control", "no-store").json({
      configured: true,
      bot,
      guild,
      ...summary,
      recent: recentResult.rows.map((row) => ({
        id: row.discord_user_id,
        username: row.username,
        avatarUrl: row.avatar_url,
        status: row.status,
        details: row.details,
        reservedOrderId: row.reserved_order_id,
        authorizedAt: row.authorized_at,
        joinedAt: row.joined_at
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/sync", requireSession, async (_req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "Configure the Members bot before syncing Members Stock." });
    }
    const result = await syncCommunityAuthorizations(config);
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/community/members/:discordUserId", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const discordUserId = String(req.params.discordUserId ?? "").trim();
    if (!isDiscordGuildId(discordUserId)) {
      return res.status(400).json({ message: "A valid connected user is required." });
    }
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "Configure the Members bot before managing Members Stock." });
    }
    await client.query("BEGIN");
    const member = await client.query(
      `SELECT username, encrypted_refresh_token, reserved_order_id
       FROM community_oauth_joins
       WHERE discord_user_id = $1 AND guild_id = $2
       FOR UPDATE`,
      [discordUserId, config.guildId]
    );
    if (!member.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "This user is no longer in Members Stock." });
    }
    if (member.rows[0].reserved_order_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This user is assigned to an active order and cannot be disconnected yet." });
    }
    await revokeCommunityAuthorization(config, member.rows[0].encrypted_refresh_token);
    await client.query(
      "DELETE FROM community_oauth_joins WHERE discord_user_id = $1 AND guild_id = $2",
      [discordUserId, config.guildId]
    );
    await client.query("COMMIT");
    res.json({ removed: true, username: member.rows[0].username, revoked: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

function createCommunityBotInvite(config, guildId) {
  const query = new URLSearchParams({
    client_id: config.clientId,
    scope: "bot",
    permissions: "1",
    guild_id: guildId,
    disable_guild_select: "true"
  });
  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}

async function resolveConfiguredCommunityInvite(inviteValue, { allowWaitingForBot = false } = {}) {
  let config = await getCommunityOAuthConfig();
  if (!config.configured) {
    const error = new Error("Configure the Members bot before creating an order.");
    error.statusCode = 503;
    throw error;
  }
  const invite = extractDiscordInviteCode(inviteValue);
  if (!invite) {
    const error = new Error("A valid Discord invite is required.");
    error.statusCode = 400;
    throw error;
  }
  const serverInfo = await resolveDiscordInvite(invite);
  if (serverInfo.guildId !== config.guildId) {
    const guildsResult = await requestDiscord("users/@me/guilds?limit=200", {
      headers: { Authorization: `Bot ${config.botToken}` }
    });
    const botGuilds = Array.isArray(guildsResult.payload) ? guildsResult.payload : [];
    const botInInvitedGuild = botGuilds.some((guild) => String(guild?.id ?? "") === serverInfo.guildId);

    if (allowWaitingForBot && (!guildsResult.response.ok || !botInInvitedGuild)) {
      return {
        config,
        invite,
        serverInfo,
        waitingForBot: true,
        botInvite: createCommunityBotInvite(config, serverInfo.guildId)
      };
    }

    if (!guildsResult.response.ok || !botInInvitedGuild) {
      const error = new Error("Add the Members bot from the order monitor to start delivery.");
      error.statusCode = 409;
      throw error;
    }

    const nextConfig = normalizeCommunityOAuthConfig({ ...config, guildId: serverInfo.guildId });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO community_oauth_joins
           (discord_user_id, guild_id, username, avatar_url, encrypted_refresh_token, status, details, authorized_at, joined_at, reserved_order_id)
         SELECT discord_user_id, $2, username, avatar_url, encrypted_refresh_token,
                CASE WHEN status = 'failed' THEN 'failed' ELSE 'authorized' END,
                'Moved to the new Members Stock server.', authorized_at, NULL, reserved_order_id
         FROM community_oauth_joins
         WHERE guild_id = $1
         ON CONFLICT (discord_user_id, guild_id) DO UPDATE SET
           username = EXCLUDED.username,
           avatar_url = EXCLUDED.avatar_url,
           encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, community_oauth_joins.encrypted_refresh_token),
           status = CASE WHEN EXCLUDED.status = 'failed' THEN community_oauth_joins.status ELSE 'authorized' END,
           details = EXCLUDED.details,
           reserved_order_id = EXCLUDED.reserved_order_id`,
        [config.guildId, nextConfig.guildId]
      );
      await client.query("DELETE FROM community_oauth_joins WHERE guild_id = $1", [config.guildId]);
      await client.query(
        `INSERT INTO app_settings (setting_key, encrypted_value, updated_at)
         VALUES ('community_oauth_config', $1, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
        [encryptCredential(JSON.stringify({
          clientId: nextConfig.clientId,
          clientSecret: nextConfig.clientSecret,
          botToken: nextConfig.botToken,
          redirectUri: nextConfig.redirectUri,
          guildId: nextConfig.guildId
        }))]
      );
      await client.query("COMMIT");
      config = nextConfig;
      communityGuildCache = null;
      communityBotCache = null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  await loadCommunityGuild(config);
  return { config, invite, serverInfo };
}

app.get("/api/community/availability", requireSession, async (req, res, next) => {
  try {
    const { config, serverInfo, invite } = await resolveConfiguredCommunityInvite(req.query?.invite, { allowWaitingForBot: true });
    const result = await pool.query(
      `SELECT COUNT(*)::int AS available
       FROM community_oauth_joins
       WHERE guild_id = $1 AND status <> 'failed' AND encrypted_refresh_token IS NOT NULL AND reserved_order_id IS NULL`,
      [config.guildId]
    );
    const available = Number(result.rows[0]?.available ?? 0);
    const memberVerification = await checkCommunityMemberVerification(config, serverInfo.guildId, invite);
    res.set("Cache-Control", "no-store").json({ available, maximum: available, memberVerification });
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const amount = Number.parseInt(req.body?.amount, 10);
    const delay = Number.parseInt(req.body?.delay, 10);
    if (req.body?.service !== "COMMUNITY-OFFLINE" || !Number.isInteger(amount) || amount <= 0 || !Number.isInteger(delay) || delay < 1 || delay > 1200) {
      return res.status(400).json({ message: "A valid Offline member amount and delay are required." });
    }

    const { config, serverInfo, waitingForBot, botInvite, invite } = await resolveConfiguredCommunityInvite(req.body?.id, { allowWaitingForBot: true });
    const memberVerification = await checkCommunityMemberVerification(config, serverInfo.guildId, invite);
    if (memberVerification.status === "open") {
      return res.status(409).json({ message: "This server has a Discord membership screening form enabled. Disable it before creating a Members 2 order." });
    }

    const uniqid = createCommunityOrderId();
    await client.query("BEGIN");
    const selected = await client.query(
      `SELECT discord_user_id, username, avatar_url, encrypted_refresh_token
       FROM community_oauth_joins
       WHERE guild_id = $1 AND status <> 'failed' AND encrypted_refresh_token IS NOT NULL AND reserved_order_id IS NULL
       ORDER BY authorized_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [config.guildId, amount]
    );
    if (selected.rowCount < amount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: `Only ${selected.rowCount} connected members are currently available.` });
    }
    await client.query(
      "UPDATE community_oauth_joins SET reserved_order_id = $1 WHERE guild_id = $2 AND discord_user_id = ANY($3::text[])",
      [uniqid, config.guildId, selected.rows.map((row) => row.discord_user_id)]
    );
    const order = {
      uniqid,
      provider: "community",
      service: "COMMUNITY-OFFLINE",
      serverId: serverInfo.guildId,
      serverName: serverInfo.guildName,
      serverInvite: String(req.body?.id ?? "").trim(),
      serverMemberCount: serverInfo.approximateMemberCount,
      amount,
      added: 0,
      delay,
      createdAt: new Date().toISOString(),
      status: waitingForBot ? "WAITING" : "PROCESS",
      details: waitingForBot ? "Add the Members bot to this server to start delivery." : `0/${amount} members delivered.`,
      botInvite,
      communityResults: selected.rows.map((row) => ({ discordUserId: row.discord_user_id, username: row.username, avatarUrl: row.avatar_url ?? null, state: "queued", details: "Waiting for delivery." }))
    };
    await client.query(
      `INSERT INTO tracked_orders (uniqid, payload, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())`,
      [uniqid, JSON.stringify(order)]
    );
    await client.query("COMMIT");
    if (!waitingForBot) {
      void processCommunityOrder(order, selected.rows, config).catch(async (error) => {
        console.error("Members order failed:", error instanceof Error ? error.message : error);
        await pool.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id = $1", [uniqid]).catch(() => {});
        await saveTrackedOrderPayload({ ...order, status: "ERROR", details: error instanceof Error ? error.message : "Members order failed." }).catch(() => {});
      });
    }
    res.json({ uniqid, bot_invite: botInvite });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

async function activateWaitingCommunityOrder(order) {
  if (!order || order.provider !== "community" || String(order.status).toUpperCase() !== "WAITING") return order;

  const lastCheckAt = activateWaitingCommunityOrder.lastChecks?.get(order.uniqid) ?? 0;
  if (Date.now() - lastCheckAt < 5_000) return order;
  if (!activateWaitingCommunityOrder.lastChecks) activateWaitingCommunityOrder.lastChecks = new Map();
  activateWaitingCommunityOrder.lastChecks.set(order.uniqid, Date.now());

  let resolved;
  try {
    resolved = await resolveConfiguredCommunityInvite(order.serverInvite);
  } catch (error) {
    if (error?.statusCode === 409) return order;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [order.uniqid]);
    const current = locked.rows[0]?.payload;
    if (!current || current.provider !== "community" || String(current.status).toUpperCase() !== "WAITING") {
      await client.query("COMMIT");
      return current ?? order;
    }

    let members = (await client.query(
      `SELECT discord_user_id, username, avatar_url, encrypted_refresh_token
       FROM community_oauth_joins
       WHERE guild_id = $1 AND reserved_order_id = $2 AND status <> 'failed' AND encrypted_refresh_token IS NOT NULL
       ORDER BY authorized_at ASC
       FOR UPDATE`,
      [resolved.config.guildId, current.uniqid]
    )).rows;

    const missing = Math.max(0, Number(current.amount) - members.length);
    if (missing > 0) {
      const extra = await client.query(
        `SELECT discord_user_id, username, avatar_url, encrypted_refresh_token
         FROM community_oauth_joins
         WHERE guild_id = $1 AND reserved_order_id IS NULL AND status <> 'failed' AND encrypted_refresh_token IS NOT NULL
         ORDER BY authorized_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [resolved.config.guildId, missing]
      );
      if (extra.rowCount) {
        await client.query(
          "UPDATE community_oauth_joins SET reserved_order_id = $1 WHERE guild_id = $2 AND discord_user_id = ANY($3::text[])",
          [current.uniqid, resolved.config.guildId, extra.rows.map((row) => row.discord_user_id)]
        );
        members = [...members, ...extra.rows];
      }
    }

    if (members.length < Number(current.amount)) {
      const failedOrder = { ...current, status: "ERROR", details: `Only ${members.length} connected members are available.` };
      await client.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id = $1", [current.uniqid]);
      await client.query("UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [current.uniqid, JSON.stringify(failedOrder)]);
      await client.query("COMMIT");
      return failedOrder;
    }

    const activeOrder = {
      ...current,
      status: "PROCESS",
      details: `0/${current.amount} members delivered.`,
      serverId: resolved.serverInfo.guildId,
      serverName: resolved.serverInfo.guildName,
      serverMemberCount: resolved.serverInfo.approximateMemberCount
    };
    await client.query("UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [current.uniqid, JSON.stringify(activeOrder)]);
    await client.query("COMMIT");
    void processCommunityOrder(activeOrder, members, resolved.config).catch(async (error) => {
      console.error("Members order failed:", error instanceof Error ? error.message : error);
      await pool.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id = $1", [activeOrder.uniqid]).catch(() => {});
      await saveTrackedOrderPayload({ ...activeOrder, status: "ERROR", details: error instanceof Error ? error.message : "Members order failed." }).catch(() => {});
    });
    return activeOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function hydrateCommunityOrderAvatars(order) {
  if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) return order;
  const missingNames = order.communityResults
    .filter((item) => item && typeof item === "object" && !Array.isArray(item) && !item.avatarUrl && typeof item.username === "string")
    .map((item) => item.username);
  if (!missingNames.length || !order.serverId) return order;

  const avatars = await pool.query(
    `SELECT username, avatar_url
     FROM community_oauth_joins
     WHERE guild_id = $1 AND username = ANY($2::text[]) AND avatar_url IS NOT NULL`,
    [order.serverId, missingNames]
  );
  if (!avatars.rowCount) return order;
  const avatarByUsername = new Map(avatars.rows.map((row) => [row.username, row.avatar_url]));
  const communityResults = order.communityResults.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || item.avatarUrl) return item;
    const avatarUrl = avatarByUsername.get(item.username);
    return avatarUrl ? { ...item, avatarUrl } : item;
  });
  const hydrated = { ...order, communityResults };
  await saveTrackedOrderPayload(hydrated);
  return hydrated;
}

function sanitizePublicCommunityOrder(order) {
  if (!order || typeof order !== "object" || Array.isArray(order) || !Array.isArray(order.communityResults)) return order;
  return {
    ...order,
    communityResults: order.communityResults.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const sanitized = { ...item };
      delete sanitized.discordUserId;
      return sanitized;
    })
  };
}

app.get("/api/community/orders/:uniqid/status", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    let payload = tracked.rows[0]?.payload;
    if (!payload || payload.provider !== "community") {
      return res.status(404).json({ message: "Members order could not be found." });
    }
    payload = await activateWaitingCommunityOrder(payload);
    payload = await hydrateCommunityOrderAvatars(payload);
    res.set("Cache-Control", "no-store").json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders/:uniqid/delay", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const delay = Number.parseInt(req.body?.delay, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isInteger(delay) || delay < 1 || delay > 1200) {
      return res.status(400).json({ message: "A valid order ID and delay are required." });
    }
    const updated = await pool.query(
      `UPDATE tracked_orders
       SET payload = jsonb_set(payload, '{delay}', to_jsonb($2::int)), updated_at = NOW()
       WHERE uniqid = $1 AND payload->>'provider' = 'community' AND payload->>'status' IN ('WAITING', 'PROCESS')
       RETURNING payload`,
      [uniqid, delay]
    );
    if (!updated.rowCount) return res.status(409).json({ message: "This Members order is no longer active." });
    res.json(updated.rows[0].payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders/:uniqid/replace-member", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const resultIndex = Number.parseInt(req.body?.resultIndex, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isInteger(resultIndex) || resultIndex < 0) {
      return res.status(400).json({ message: "A valid order ID and member row are required." });
    }
    const isAdminRequest = await hasActiveSession(req);
    const publicCooldownKey = `${req.ip}:${uniqid}:${resultIndex}`;
    const publicCooldownUntil = publicCommunityReplaceCooldowns.get(publicCooldownKey) ?? 0;
    if (!isAdminRequest && publicCooldownUntil > Date.now()) {
      const retrySeconds = Math.max(1, Math.ceil((publicCooldownUntil - Date.now()) / 1000));
      return res.status(429).json({ message: `Wait ${retrySeconds}s before trying this replacement again.` });
    }

    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "Configure the Members bot before replacing a member." });
    }

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }
    if (String(order.serverId ?? "") !== config.guildId) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "The Members bot is no longer configured for this order's server." });
    }

    const results = [...order.communityResults];
    if (results.some((item) => String(item?.state ?? "").toLowerCase() === "replacing")) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Another replacement member is already running for this order." });
    }
    const failedResult = results[resultIndex];
    const replaceableStates = new Set(["failed", "already_member"]);
    if (!failedResult || typeof failedResult !== "object" || Array.isArray(failedResult) || !replaceableStates.has(String(failedResult.state ?? "").toLowerCase())) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only failed or already-member results can be replaced." });
    }

    let failedUserId = isDiscordGuildId(String(failedResult.discordUserId ?? "")) ? String(failedResult.discordUserId) : null;
    if (!failedUserId && typeof failedResult.username === "string" && failedResult.username.trim()) {
      const matched = await client.query(
        `SELECT discord_user_id
         FROM community_oauth_joins
         WHERE guild_id = $1 AND username = $2
         ORDER BY authorized_at DESC
         LIMIT 1
         FOR UPDATE`,
        [config.guildId, failedResult.username.trim()]
      );
      failedUserId = matched.rows[0]?.discord_user_id ?? null;
    }
    if (!failedUserId) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "The failed user could not be linked to Members Stock." });
    }

    const markOriginalInactive = isDiscordUnknownUser(failedResult);
    const originalDetails = typeof failedResult.details === "string" && failedResult.details.trim()
      ? failedResult.details.trim()
      : "Member was unavailable during order delivery.";
    await client.query(
      `UPDATE community_oauth_joins
       SET status = CASE WHEN $3 THEN 'failed' ELSE 'authorized' END, details = $4, reserved_order_id = NULL
       WHERE discord_user_id = $1 AND guild_id = $2`,
      [failedUserId, config.guildId, markOriginalInactive, originalDetails]
    );

    const usedUserIds = Array.from(new Set([
      failedUserId,
      ...results.map((item) => String(item?.discordUserId ?? "").trim()).filter(isDiscordGuildId)
    ]));
    const usedUsernames = Array.from(new Set(results.map((item) => String(item?.username ?? "").trim()).filter(Boolean)));
    const replacement = await client.query(
      `SELECT discord_user_id, username, avatar_url, encrypted_refresh_token
       FROM community_oauth_joins
       WHERE guild_id = $1
         AND status <> 'failed'
         AND encrypted_refresh_token IS NOT NULL
         AND reserved_order_id IS NULL
         AND NOT (discord_user_id = ANY($2::text[]))
         AND NOT (username = ANY($3::text[]))
       ORDER BY authorized_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [config.guildId, usedUserIds, usedUsernames]
    );
    if (!replacement.rowCount) {
      await client.query("COMMIT");
      return res.status(409).json({ message: "No connected replacement member is currently available. The original member remains active unless Discord reported Unknown User." });
    }

    const member = replacement.rows[0];
    await client.query(
      "UPDATE community_oauth_joins SET reserved_order_id = $1 WHERE discord_user_id = $2 AND guild_id = $3",
      [uniqid, member.discord_user_id, config.guildId]
    );
    results[resultIndex] = {
      discordUserId: member.discord_user_id,
      username: member.username,
      avatarUrl: member.avatar_url ?? null,
      state: "replacing",
      details: "Replacement member delivery is running.",
      replacementAttempt: (Number(failedResult.replacementAttempt) || 0) + 1,
      previousUsername: failedResult.username
    };
    const activeOrder = {
      ...order,
      status: "PROCESS",
      details: `${order.added ?? 0}/${order.amount} members delivered. Replacing a member.`,
      communityResults: results
    };
    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [uniqid, JSON.stringify(activeOrder)]
    );
    await client.query("COMMIT");
    if (!isAdminRequest) {
      publicCommunityReplaceCooldowns.set(publicCooldownKey, Date.now() + publicCommunityReplaceCooldownMs);
    }

    void processCommunityReplacement(uniqid, resultIndex, member, config).catch(async (error) => {
      console.error("Members replacement failed:", error instanceof Error ? error.message : error);
      await pool.query(
        "UPDATE community_oauth_joins SET status = CASE WHEN $3 THEN 'failed' ELSE 'authorized' END, reserved_order_id = NULL, details = $4 WHERE discord_user_id = $1 AND guild_id = $2",
        [member.discord_user_id, config.guildId, isDiscordUnknownUser(error), error instanceof Error ? error.message : "Replacement failed."]
      ).catch(() => {});
    });
    res.json(isAdminRequest ? activeOrder : sanitizePublicCommunityOrder(activeOrder));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
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
    if (trackedPayload && typeof trackedPayload === "object" && !Array.isArray(trackedPayload) && trackedPayload.provider === "community") {
      trackedPayload = await activateWaitingCommunityOrder(trackedPayload);
      trackedPayload = await hydrateCommunityOrderAvatars(trackedPayload);
      return res.set("Cache-Control", "no-store").json({ ...sanitizePublicCommunityOrder(trackedPayload), liveBoostStock, canManageCommunityMembers: true });
    }
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
      trackedPayload = await recoverStaleDcordBoostOrder(trackedPayload);
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

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const trackedPayload = tracked.rows[0]?.payload;
    if (trackedPayload?.provider === "community") {
      const updated = await pool.query(
        `UPDATE tracked_orders
         SET payload = jsonb_set(payload, '{delay}', to_jsonb($2::int)), updated_at = NOW()
         WHERE uniqid = $1 AND payload->>'provider' = 'community' AND payload->>'status' IN ('WAITING', 'PROCESS')
         RETURNING payload`,
        [uniqid, delay]
      );
      if (!updated.rowCount) return res.status(409).json({ message: "This Members order is no longer active." });
      publicDelayCooldowns.set(cooldownKey, Date.now() + publicDelayCooldownMs);
      return res.json({ delay, updated: true });
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

app.get("/api/dcord/proxies", requireSession, async (_req, res, next) => {
  try {
    const proxies = await loadDcordStickyProxies();
    res.set("Cache-Control", "no-store").json({ proxies, count: proxies.length });
  } catch (error) {
    next(error);
  }
});

app.put("/api/dcord/proxies", requireSession, async (req, res, next) => {
  try {
    const proxies = await saveDcordStickyProxies(req.body?.proxies ?? "");
    res.json({ proxies, count: proxies.length });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/dcord/proxies", requireSession, async (_req, res, next) => {
  try {
    await pool.query("DELETE FROM app_settings WHERE setting_key = 'dcord_sticky_proxies'");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/dcord/check", requireSession, async (_req, res, next) => {
  try {
    const stickyProxies = await loadDcordStickyProxies();
    const createPayload = { type: "join", token: "dummy", invite: "dummy", boost: true };
    const proxy = pickDcordStickyProxy(stickyProxies, "dummy");
    if (proxy) createPayload.proxy = proxy;
    const payload = await requestDcord(dcordTaskCreatePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload)
    });
    const taskId = getDcordTaskId(payload);
    res.set("Cache-Control", "no-store").json({
      connected: true,
      status: "ok",
      taskId,
      message: taskId
        ? `Dcord is reachable. Test task ${taskId} was accepted.`
        : "Dcord is reachable and returned JSON, but no task ID was included."
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode);
    res.status(502).json({
      connected: false,
      status: "failed",
      httpStatus: Number.isFinite(statusCode) ? statusCode : undefined,
      message: error instanceof Error ? error.message : "Dcord connection check failed."
    });
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
    const useProxy = req.body?.useProxy === true;
    const concurrency = normalizeDcordBoostConcurrency(req.body?.concurrency);

    if (!invite || !Number.isFinite(amount) || amount <= 0 || amount % 2 !== 0 || ![1, 3].includes(duration)) {
      return res.status(400).json({ message: "A valid Discord invite, even boost amount, and duration are required." });
    }

    if (useProxy) {
      const stickyProxies = await loadDcordStickyProxies();
      if (!stickyProxies.length) {
        return res.status(409).json({ message: "Add at least one sticky proxy before creating a proxy order." });
      }
    }

    const serverInfo = await resolveDiscordInvite(invite);
    const memberVerification = await checkDcordBoostMembershipScreening(invite, serverInfo);
    if (memberVerification.status === "open" && req.body?.forceMembershipScreening !== true) {
      return res.status(409).json({ message: "Membership screening is enabled on this server. Disable the join form before boosting." });
    }

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
      useProxy,
      concurrency,
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
    payload = await recoverStaleDcordBoostOrder(payload);
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

app.post("/api/dcord/boost-orders/:uniqid/resume", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }
    if (dcordOrderProcessingJobs.has(uniqid)) {
      return res.status(409).json({ message: "This boost order is already running." });
    }

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "dcord" || !Array.isArray(order.dcordResults)) {
      return res.status(404).json({ message: "Boost order could not be found." });
    }
    if (!order.dcordResults.some(isRunnableDcordResult)) {
      return res.status(409).json({ message: "This order has no queued or pending Dcord tasks to resume." });
    }

    const tokens = await loadDcordOrderTokens(uniqid);
    const invite = extractDiscordInviteCode(order.serverInvite);
    if (!tokens.length || !invite) {
      return res.status(409).json({ message: "The assigned tokens or server invite are missing." });
    }

    const retryTimer = dcordOrderRetryTimers.get(uniqid);
    if (retryTimer) clearTimeout(retryTimer);
    dcordOrderRetryTimers.delete(uniqid);
    dcordCircuitOpenUntil = 0;

    const resumedOrder = {
      ...order,
      status: "PROCESS",
      providerStatus: "checking",
      dcordRetryCount: 0,
      nextRetryAt: null,
      details: "Manual Dcord delivery check started."
    };
    await saveTrackedOrderPayload(resumedOrder);
    void processDcordBoostOrder(resumedOrder, tokens, invite).catch((error) => {
      console.error("Manual Dcord resume failed:", error instanceof Error ? error.message : error);
    });
    res.json(await revealDcordOrderTokens(resumedOrder));
  } catch (error) {
    next(error);
  }
});

app.post("/api/dcord/boost-orders/:uniqid/cancel", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }
    if (dcordOrderProcessingJobs.has(uniqid)) {
      return res.status(409).json({ message: "Wait for the current Dcord request to finish before cancelling." });
    }

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "dcord" || !Array.isArray(order.dcordResults)) {
      return res.status(404).json({ message: "Boost order could not be found." });
    }
    if (String(order.status ?? "").trim().toUpperCase() !== "WAITING") {
      return res.status(409).json({ message: "Only a waiting Dcord order can be cancelled." });
    }
    if (order.dcordResults.some(isDcordTaskPendingResult)) {
      return res.status(409).json({ message: "Dcord already accepted this task and does not provide a task cancellation endpoint. Its result must be checked before returning the token." });
    }
    const tokens = await loadDcordOrderTokens(uniqid);
    const results = [...order.dcordResults];
    const returnedTokenCount = await returnDcordTokensToStock(order, tokens, results, true);
    results.forEach((result, index) => {
      if (!canReturnDcordTokenResult(result, true)) return;
      const wasSubmitted = isUncertainDcordTransportResult(result);
      const cleanedResult = { ...result };
      delete cleanedResult.usedTokenId;
      results[index] = {
        ...cleanedResult,
        previousStatus: result.status,
        status: "returned",
        joinStatus: wasSubmitted ? "verification stopped" : "not submitted",
        boostStatus: wasSubmitted ? "verification stopped" : "not submitted",
        boostMessage: wasSubmitted
          ? "Delivery was cancelled. This submitted token was force-returned to stock before Dcord confirmed the result."
          : "Delivery was cancelled. This token was returned to stock.",
        transportUncertain: false,
        returnedAt: new Date().toISOString()
      };
    });

    const retryTimer = dcordOrderRetryTimers.get(uniqid);
    if (retryTimer) clearTimeout(retryTimer);
    dcordOrderRetryTimers.delete(uniqid);
    const cancelledOrder = {
      ...order,
      status: "CANCELLED",
      providerStatus: "cancelled",
      nextRetryAt: null,
      autoResumeDisabled: true,
      cancelledAt: new Date().toISOString(),
      returnedTokenCount,
      details: `Delivery cancelled. ${returnedTokenCount} reserved token${returnedTokenCount === 1 ? " was" : "s were"} returned to stock.`,
      dcordResults: results
    };
    await saveTrackedOrderPayload(cancelledOrder);
    res.json(await revealDcordOrderTokens(cancelledOrder));
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
    const orderStatus = String(order.status ?? "").trim().toUpperCase();
    if (orderStatus === "PROCESS") {
      return res.status(409).json({ message: "Wait until the boost order finishes before replacing failed tokens." });
    }
    if (orderStatus === "CANCELLED") {
      return res.status(409).json({ message: "Cancelled order tokens cannot be replaced." });
    }

    const results = Array.isArray(order.dcordResults) ? [...order.dcordResults] : [];
    const currentResult = results[resultIndex];
    if (!currentResult || typeof currentResult !== "object" || Array.isArray(currentResult)) {
      return res.status(404).json({ message: "Token result could not be found." });
    }
    if (currentResult.boosted === true) {
      return res.status(409).json({ message: "Only failed token results can be replaced." });
    }
    if (String(currentResult.status ?? "").trim().toLowerCase() === "returned") {
      return res.status(409).json({ message: "This token has already been returned to stock." });
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

    const replacementResult = {
      ...createQueuedDcordResult(replacementToken),
      replaced: true,
      replacedAt: new Date().toISOString(),
      replacedResultIndex: resultIndex,
      previousToken: typeof currentResult.token === "string" ? currentResult.token : undefined,
      replacementFor: typeof currentResult.token === "string" ? currentResult.token : undefined
    };
    results[resultIndex] = replacementResult;
    const assignedTokens = await loadDcordOrderTokens(uniqid);
    assignedTokens[resultIndex] = replacementToken;
    await saveDcordOrderTokens(uniqid, assignedTokens);

    const added = results.reduce((total, item) => {
      return total + (item && typeof item === "object" && !Array.isArray(item) && item.boosted === true ? 2 : 0);
    }, 0);
    const amount = Number.isFinite(Number(order.amount)) ? Number(order.amount) : added;
    const nextOrder = {
      ...order,
      added,
      status: "PROCESS",
      providerStatus: "checking",
      dcordRetryCount: 0,
      nextRetryAt: null,
      details: `${added}/${amount} boosts completed. Replacement delivery queued.`,
      dcordResults: results
    };

    await saveTrackedOrderPayload(nextOrder);
    void processDcordBoostOrder(nextOrder, assignedTokens, invite).catch((error) => {
      console.error("Dcord replacement failed:", error instanceof Error ? error.message : error);
    });
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
      const isLocallyManagedOrder =
        existingPayload &&
        typeof existingPayload === "object" &&
        !Array.isArray(existingPayload) &&
        (existingPayload.provider === "dcord" || existingPayload.provider === "community" || existingPayload.service === "DCORD-BOOSTS");
      const nextPayload = isLocallyManagedOrder ? existingPayload : { ...order, uniqid };

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
