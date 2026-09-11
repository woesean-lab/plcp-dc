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
const dcordProxyCheckUrl = process.env.DCORD_PROXY_CHECK_URL ?? "https://discord.com/api/v10/gateway";
const dcordProxyCheckTimeoutMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_PROXY_CHECK_TIMEOUT_MS ?? "10000", 10) || 10_000, 3_000), 30_000);
const dcordTaskPollIntervalMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_TASK_POLL_INTERVAL_MS ?? "3000", 10) || 3_000, 2_000), 10_000);
const dcordTaskMaxWaitMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_TASK_MAX_WAIT_MS ?? "620000", 10) || 620_000, 60_000), 900_000);
const dcordRetryBaseMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_RETRY_BASE_MS ?? "30000", 10) || 30_000, 10_000), 300_000);
const dcordRetryMaxMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_RETRY_MAX_MS ?? "600000", 10) || 600_000, dcordRetryBaseMs), 3_600_000);
const dcordMaxRetryAttempts = Math.min(Math.max(Number.parseInt(process.env.DCORD_MAX_RETRY_ATTEMPTS ?? "12", 10) || 12, 1), 100);
const experimentalCommunityJoinEnabled = !["0", "false", "no", "off"].includes(
  String(process.env.EXPERIMENTAL_JOIN_ENABLED ?? "true").trim().toLowerCase()
);
const communityWorkerInstanceId = `${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
const communityWorkerLeaseSeconds = 60;
const discordApiBase = "https://discord.com/api/v10";
const publicDelayCooldownMs = 60 * 1000;
const publicDelayCooldowns = new Map();
const publicRestartCooldownMs = 60 * 1000;
const publicRestartCooldowns = new Map();
const publicCommunityReplaceCooldownMs = 60 * 1000;
const publicCommunityReplaceCooldowns = new Map();
const publicCommunityCheckCooldownMs = 60 * 1000;
const publicCommunityCheckCooldowns = new Map();
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

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error instanceof Error ? error.message : error);
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
  const guildId = String(value.guildId ?? "").trim();
  const missing = [];

  if (!clientId) missing.push("DISCORD_OAUTH_CLIENT_ID");
  if (!clientSecret) missing.push("DISCORD_OAUTH_CLIENT_SECRET");
  if (!botToken) missing.push("DISCORD_BOT_TOKEN");
  if (!isDiscordGuildId(guildId)) missing.push("DISCORD_TARGET_GUILD_ID");

  return { configured: missing.length === 0, missing: [...new Set(missing)], clientId, clientSecret, botToken, guildId };
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

async function forEachWithConcurrency(values, concurrency, task) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await task(values[index], index);
    }
  }));
}

let communityGuildCache = null;
let communityBotCache = null;
const communityMemberPresenceCache = new Map();

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

function cacheCommunityGuild(guildId, payload) {
  const normalizedGuildId = String(payload?.id ?? guildId);
  const value = {
    id: normalizedGuildId,
    name: String(payload?.name ?? "Discord Community"),
    iconUrl: payload?.icon
      ? `https://cdn.discordapp.com/icons/${encodeURIComponent(normalizedGuildId)}/${encodeURIComponent(payload.icon)}.png?size=256`
      : null,
    memberCount: Number.isFinite(payload?.approximate_member_count)
      ? payload.approximate_member_count
      : Number.isFinite(payload?.member_count) ? payload.member_count : null
  };
  communityGuildCache = { guildId: String(guildId), expiresAt: Date.now() + 30_000, value };
  return value;
}

async function checkCommunityBotDirectGuildAccess(config, guildId) {
  const normalizedGuildId = String(guildId ?? "").trim();
  const direct = await requestDiscord(`guilds/${encodeURIComponent(normalizedGuildId)}?with_counts=true`, {
    headers: { Authorization: `Bot ${config.botToken}` }
  });
  if (direct.response.ok) {
    cacheCommunityGuild(normalizedGuildId, direct.payload);
    return { accessible: true, status: direct.response.status, source: "guild", payload: direct.payload };
  }
  return { accessible: false, status: direct.response.status, source: "guild", payload: direct.payload };
}

async function checkCommunityBotGuildAccess(config, guildId) {
  const normalizedGuildId = String(guildId ?? "").trim();
  const direct = await checkCommunityBotDirectGuildAccess(config, normalizedGuildId);
  if (direct.accessible) return direct;
  if (direct.status === 401) {
    return { accessible: false, status: 401, source: "guild", payload: direct.payload };
  }

  // Discord can briefly return 403/404 from the guild route immediately after
  // installation. The bot's own guild list is an independent membership check.
  let after = "0";
  let listedGuildCount = 0;
  for (let page = 0; page < 25; page += 1) {
    const guilds = await requestDiscord(`users/@me/guilds?limit=200&after=${encodeURIComponent(after)}`, {
      headers: { Authorization: `Bot ${config.botToken}` }
    });
    if (!guilds.response.ok || !Array.isArray(guilds.payload)) {
      return {
        accessible: false,
        status: guilds.response.status || direct.status,
        source: "guild-list",
        payload: guilds.payload,
        tokenVerified: false
      };
    }
    listedGuildCount += guilds.payload.length;
    const matchedGuild = guilds.payload.find((guild) => String(guild?.id ?? "") === normalizedGuildId);
    if (matchedGuild) {
      cacheCommunityGuild(normalizedGuildId, matchedGuild);
      return { accessible: true, status: 200, source: "guild-list", payload: matchedGuild };
    }
    if (guilds.payload.length < 200) break;
    const lastGuildId = String(guilds.payload.at(-1)?.id ?? "");
    if (!isDiscordGuildId(lastGuildId) || lastGuildId === after) break;
    after = lastGuildId;
  }

  return {
    accessible: false,
    status: direct.status,
    source: "guild-list",
    payload: direct.payload,
    tokenVerified: true,
    listedGuildCount
  };
}

async function checkCommunityMemberVerification(config, guildId, invite) {
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
    const enabled = fields.length > 0;
    return {
      status: enabled ? "open" : "closed",
      enabled,
      fields: fields.length
    };
  } catch {
    return { status: "unknown", enabled: false };
  }
}

const communityApplicationFieldTypes = new Set(["TEXT_INPUT", "PARAGRAPH", "MULTIPLE_CHOICE"]);

function hasCommunityApplyToJoin(guild) {
  const features = new Set(Array.isArray(guild?.features) ? guild.features : []);
  return features.has("MEMBER_VERIFICATION_GATE_ENABLED")
    && features.has("MEMBER_VERIFICATION_MANUAL_APPROVAL");
}

function isCommunityGuildInvitesRestricted(guild) {
  const features = new Set(Array.isArray(guild?.features) ? guild.features : []);
  if (features.has("INVITES_DISABLED")) return true;
  const disabledUntil = Date.parse(String(guild?.incidents_data?.invites_disabled_until ?? ""));
  return Number.isFinite(disabledUntil) && disabledUntil > Date.now();
}

async function ensureCommunityApplyToJoin(config, guildId) {
  const normalizedGuildId = String(guildId ?? "").trim();
  const authorization = { Authorization: `Bot ${config.botToken}` };
  let guildResult = await requestDiscord(`guilds/${encodeURIComponent(normalizedGuildId)}`, {
    headers: authorization
  });
  if (!guildResult.response.ok) {
    const error = new Error(getDiscordRequestFailureDetails("Discord server access check", guildResult));
    error.statusCode = guildResult.response.status === 403 ? 409 : 502;
    throw error;
  }
  if (hasCommunityApplyToJoin(guildResult.payload)) return { changed: false };

  const verificationResult = await requestDiscord(
    `guilds/${encodeURIComponent(normalizedGuildId)}/member-verification?with_guild=false`,
    { headers: authorization }
  );
  if (!verificationResult.response.ok && verificationResult.response.status !== 404) {
    const error = new Error(getDiscordRequestFailureDetails("Discord Apply-to-Join form read", verificationResult));
    error.statusCode = verificationResult.response.status === 403 ? 409 : 502;
    throw error;
  }

  const formFields = Array.isArray(verificationResult.payload?.form_fields)
    ? verificationResult.payload.form_fields.map(({ response: _response, ...field }) => field)
    : [];
  const hasApplicationQuestion = formFields.some((field) =>
    communityApplicationFieldTypes.has(String(field?.field_type ?? "").toUpperCase())
  );
  if (!hasApplicationQuestion) {
    if (formFields.length >= 5) {
      const error = new Error("Apply to Join could not be enabled automatically because the server verification form already has five fields and none is an application question.");
      error.statusCode = 409;
      throw error;
    }
    formFields.push({
      field_type: "PARAGRAPH",
      label: "Why do you want to join this server?",
      description: null,
      required: true
    });
  }

  let updateResult = await requestDiscord(`guilds/${encodeURIComponent(normalizedGuildId)}/member-verification`, {
    method: "PATCH",
    headers: {
      ...authorization,
      "Content-Type": "application/json",
      "X-Audit-Log-Reason": encodeURIComponent("Members 2 requires Apply to Join")
    },
    body: JSON.stringify({ enabled: true, form_fields: formFields })
  });
  if (updateResult.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(updateResult.payload?.retry_after) || 1, 1), 5);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    updateResult = await requestDiscord(`guilds/${encodeURIComponent(normalizedGuildId)}/member-verification`, {
      method: "PATCH",
      headers: {
        ...authorization,
        "Content-Type": "application/json",
        "X-Audit-Log-Reason": encodeURIComponent("Members 2 requires Apply to Join")
      },
      body: JSON.stringify({ enabled: true, form_fields: formFields })
    });
  }
  if (!updateResult.response.ok) {
    const error = new Error(getDiscordRequestFailureDetails("Discord Apply-to-Join setup", updateResult));
    error.statusCode = updateResult.response.status === 403 ? 409 : 502;
    throw error;
  }

  guildResult = await requestDiscord(`guilds/${encodeURIComponent(normalizedGuildId)}`, {
    headers: authorization
  });
  if (!guildResult.response.ok || !hasCommunityApplyToJoin(guildResult.payload)) {
    const error = new Error("Discord accepted the verification form but did not switch the server access method to Apply to Join.");
    error.statusCode = 409;
    throw error;
  }
  cacheCommunityGuild(normalizedGuildId, guildResult.payload);
  return { changed: true };
}

async function checkDcordBoostMembershipScreening(invite, serverInfo) {
  const config = await getCommunityOAuthConfig();
  if (!config.botToken || !isDiscordGuildId(String(serverInfo?.guildId ?? ""))) {
    return { status: "unknown", enabled: false };
  }
  return checkCommunityMemberVerification(config, serverInfo.guildId, invite);
}

async function markCommunityFailedDeliveriesInactive(queryable, guildId) {
  await queryable.query(
    `UPDATE community_oauth_joins
     SET status = 'authorized', details = NULL, reserved_order_id = NULL
     WHERE guild_id = $1
       AND status = 'failed'
       AND encrypted_access_token IS NOT NULL
       AND access_token_expires_at > NOW()
       AND COALESCE(details, '') ~* '(400002|access to inviting new users through invite links has been limited for this guild)'`,
    [guildId]
  );
  return queryable.query(
    `UPDATE community_oauth_joins AS stock
     SET status = 'failed',
         details = 'A previous delivery failed; this member was disabled automatically.',
         reserved_order_id = NULL
     WHERE stock.guild_id = $1
       AND stock.status = 'authorized'
       AND EXISTS (
         SELECT 1
         FROM tracked_orders
         CROSS JOIN LATERAL jsonb_to_recordset(
           CASE
             WHEN jsonb_typeof(payload->'communityResults') = 'array' THEN payload->'communityResults'
             ELSE '[]'::jsonb
           END
         ) AS member_result("discordUserId" text, state text, details text, "completedAt" text)
         WHERE payload->>'provider' = 'community'
           AND payload->>'serverId' = $1
           AND member_result."discordUserId" = stock.discord_user_id
           AND LOWER(COALESCE(member_result.state, '')) = 'failed'
           AND COALESCE(member_result.details, '') !~* '(400002|access to inviting new users through invite links has been limited for this guild)'
           AND CASE
             WHEN member_result."completedAt" ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN member_result."completedAt"::timestamptz
             ELSE NULL
           END >= stock.authorized_at
       )`,
    [guildId]
  );
}

async function loadCommunityJoinSummary(config) {
  await markCommunityFailedDeliveriesInactive(pool, config.guildId);
  await pool.query(
    `UPDATE community_oauth_joins
     SET status = 'failed',
         details = 'OAuth access token expired. Re-import a current S2Tools export; automatic refresh is disabled.',
         reserved_order_id = NULL
     WHERE guild_id = $1
       AND status = 'authorized'
       AND reserved_order_id IS NULL
       AND (encrypted_access_token IS NULL OR access_token_expires_at IS NULL OR access_token_expires_at <= NOW())`,
    [config.guildId]
  );
  const result = await pool.query(
    `SELECT
       stock_type,
       COUNT(*) FILTER (WHERE status = 'joined')::int AS joined,
       COUNT(*) FILTER (WHERE status = 'already_member')::int AS already_member,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW() AND status <> 'failed')::int AS authorized,
       COUNT(*) FILTER (WHERE encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW() AND status = 'authorized')::int AS ready
     FROM community_oauth_joins
     WHERE guild_id = $1
     GROUP BY stock_type`,
    [config.guildId]
  );
  const empty = () => ({ joined: 0, authorized: 0, ready: 0, alreadyMember: 0, failed: 0 });
  const categories = {};
  for (const row of result.rows) {
    const type = normalizeCommunityStockType(row.stock_type);
    categories[type] = {
      joined: Number(row.joined ?? 0),
      authorized: Number(row.authorized ?? 0),
      ready: Number(row.ready ?? 0),
      alreadyMember: Number(row.already_member ?? 0),
      failed: Number(row.failed ?? 0)
    };
  }
  const combined = Object.values(categories).reduce((total, item) => ({
    joined: total.joined + item.joined,
    authorized: total.authorized + item.authorized,
    ready: total.ready + item.ready,
    alreadyMember: total.alreadyMember + item.alreadyMember,
    failed: total.failed + item.failed
  }), empty());
  return {
    ...combined,
    categories
  };
}

async function loadCommunityStockCategories(config) {
  const [categoryResult, summary] = await Promise.all([
    pool.query(
      `SELECT id, name, is_periodic, icon_name, color_key, created_at, updated_at
       FROM community_stock_categories
       WHERE guild_id = $1
       ORDER BY created_at ASC, name ASC`,
      [config.guildId]
    ),
    loadCommunityJoinSummary(config)
  ]);
  return categoryResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    isPeriodic: row.is_periodic === true,
    iconName: row.icon_name,
    colorKey: row.color_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: summary.categories[row.id] ?? { joined: 0, authorized: 0, ready: 0, alreadyMember: 0, failed: 0 }
  }));
}

async function ensureCommunityStockCategories(config) {
  await pool.query(
    `INSERT INTO community_stock_categories (guild_id, id, name, is_periodic, icon_name, color_key)
     SELECT $1, defaults.id, defaults.name, FALSE, defaults.icon_name, defaults.color_key
     FROM (VALUES ('offline', 'Offline', 'Users', 'emerald'), ('online', 'Online', 'Timer', 'violet')) AS defaults(id, name, icon_name, color_key)
     WHERE NOT EXISTS (SELECT 1 FROM community_stock_categories WHERE guild_id = $1)
     ON CONFLICT (guild_id, id) DO NOTHING`,
    [config.guildId]
  );
}

async function copyCommunityStockCategories(queryable, sourceGuildId, targetGuildId) {
  if (!sourceGuildId || !targetGuildId || sourceGuildId === targetGuildId) return;

  await queryable.query(
    `INSERT INTO community_stock_categories
       (guild_id, id, name, is_periodic, icon_name, color_key, created_at, updated_at)
     SELECT $2, id, name, is_periodic, icon_name, color_key, created_at, NOW()
     FROM community_stock_categories
     WHERE guild_id = $1
     ON CONFLICT (guild_id, id) DO NOTHING`,
    [sourceGuildId, targetGuildId]
  );
}

async function copyCommunityStockForGuild(queryable, sourceGuildId, targetGuildId) {
  if (!sourceGuildId || !targetGuildId || sourceGuildId === targetGuildId) return;
  await copyCommunityStockCategories(queryable, sourceGuildId, targetGuildId);
  await queryable.query(
    `INSERT INTO community_oauth_joins
       (discord_user_id, guild_id, username, avatar_url, encrypted_refresh_token, encrypted_access_token, access_token_expires_at, status, stock_type, details, authorized_at, joined_at, reserved_order_id, sort_position)
     SELECT discord_user_id, $2, username, avatar_url, NULL, encrypted_access_token, access_token_expires_at,
            CASE WHEN status = 'failed' THEN 'failed' ELSE 'authorized' END,
            stock_type, NULL, authorized_at, NULL, NULL, sort_position
     FROM community_oauth_joins
     WHERE guild_id = $1
     ON CONFLICT (discord_user_id, guild_id) DO UPDATE SET
       username = EXCLUDED.username,
       avatar_url = EXCLUDED.avatar_url,
       encrypted_refresh_token = NULL,
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       status = CASE
         WHEN community_oauth_joins.reserved_order_id IS NOT NULL THEN community_oauth_joins.status
         WHEN EXCLUDED.status = 'failed' THEN 'failed'
         WHEN community_oauth_joins.status IN ('joined', 'already_member') THEN community_oauth_joins.status
         ELSE 'authorized'
       END,
       stock_type = EXCLUDED.stock_type,
       details = CASE WHEN community_oauth_joins.reserved_order_id IS NOT NULL THEN community_oauth_joins.details ELSE EXCLUDED.details END,
       joined_at = community_oauth_joins.joined_at,
       reserved_order_id = community_oauth_joins.reserved_order_id,
       sort_position = community_oauth_joins.sort_position`,
    [sourceGuildId, targetGuildId]
  );
}

async function normalizeCommunityStockRecords(config) {
  await pool.query(
    `UPDATE community_oauth_joins
     SET status = 'authorized', details = NULL, joined_at = NULL
     WHERE guild_id = $1
       AND encrypted_access_token IS NOT NULL
       AND access_token_expires_at > NOW()
       AND (
         status IN ('joined', 'already_member')
         OR (status = 'authorized' AND details IS NOT NULL)
       )`,
    [config.guildId]
  );
}

function normalizeCommunityStockType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : "offline";
}

function parseCommunityCategoryId(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized) ? normalized : null;
}

function getCommunityStockTypeFromService(service) {
  return service === "COMMUNITY-ONLINE" ? "online" : "offline";
}

function getCommunityOrderStockType(order) {
  return normalizeCommunityStockType(order?.categoryId ?? order?.stockType ?? getCommunityStockTypeFromService(order?.service));
}

function createCommunityCategoryId() {
  return `cat_${crypto.randomBytes(8).toString("hex")}`;
}

const COMMUNITY_CATEGORY_ICON_NAMES = new Set(["Users", "Timer", "Crown", "Gem", "Gamepad2", "Globe2", "Heart", "Rocket", "Shield", "Star", "Zap"]);
const COMMUNITY_CATEGORY_COLOR_KEYS = new Set(["violet", "cyan", "emerald", "amber", "rose", "black"]);

function parseCommunityCategoryIconName(value) {
  const iconName = String(value ?? "").trim();
  return COMMUNITY_CATEGORY_ICON_NAMES.has(iconName) ? iconName : null;
}

function parseCommunityCategoryColorKey(value) {
  const colorKey = String(value ?? "").trim().toLowerCase();
  return COMMUNITY_CATEGORY_COLOR_KEYS.has(colorKey) ? colorKey : null;
}

function addUtcMonths(value, months) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

function isCommunityOrderManagementExpired(order) {
  if (!order?.expiredAt) return false;
  const expiresAt = new Date(order.expiredAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function isCommunityServiceType(service) {
  return service === "COMMUNITY-OFFLINE" || service === "COMMUNITY-ONLINE";
}

async function loadCommunityPreviouslyDeliveredUserIds(queryable, guildId) {
  const result = await queryable.query(
    `WITH member_history AS (
       SELECT
         member_result->>'discordUserId' AS discord_user_id,
         COALESCE(member_result->>'completedAt', payload->>'createdAt', '') AS delivered_at,
         CASE
           WHEN LOWER(COALESCE(member_result->>'membershipStatus', '')) = 'removed'
             THEN COALESCE(member_result->>'authorizationCheckedAt', '')
           ELSE ''
         END AS removed_at
       FROM tracked_orders
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN jsonb_typeof(payload->'communityResults') = 'array' THEN payload->'communityResults'
           ELSE '[]'::jsonb
         END
       ) AS member_result
       WHERE payload->>'provider' = 'community'
         AND payload->>'serverId' = $1
         AND LOWER(COALESCE(member_result->>'state', '')) IN ('joined', 'pending_join', 'already_member')
         AND COALESCE(member_result->>'discordUserId', '') <> ''
     )
     SELECT discord_user_id
     FROM member_history
     GROUP BY discord_user_id
     HAVING MAX(removed_at) < MAX(delivered_at)`,
    [guildId]
  );
  return result.rows.map((row) => String(row.discord_user_id ?? "").trim()).filter(isDiscordGuildId);
}

async function isCommunityMemberStillInGuild(config, guildId, discordUserId) {
  const cacheKey = `${guildId}:${discordUserId}`;
  const cached = communityMemberPresenceCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.present;

  let result = await requestDiscord(
    `guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordUserId)}`,
    { headers: { Authorization: `Bot ${config.botToken}` } }
  );
  if (result.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(result.payload?.retry_after) || 1, 1), 5);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1_000));
    result = await requestDiscord(
      `guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordUserId)}`,
      { headers: { Authorization: `Bot ${config.botToken}` } }
    );
  }

  const discordCode = Number(result.payload?.code ?? 0);
  const definitelyAbsent = result.response.status === 404 && [10007, 10013].includes(discordCode);
  const present = result.response.ok || !definitelyAbsent;
  communityMemberPresenceCache.set(cacheKey, {
    present,
    expiresAt: Date.now() + (present ? 60_000 : 30_000)
  });
  return present;
}

async function loadCommunityDeliveredUsersStillPresent(queryable, config, guildId) {
  const historicalIds = await loadCommunityPreviouslyDeliveredUserIds(queryable, guildId);
  const presentIds = [];
  for (let offset = 0; offset < historicalIds.length; offset += 8) {
    const batch = historicalIds.slice(offset, offset + 8);
    const checks = await Promise.all(batch.map(async (discordUserId) => ({
      discordUserId,
      present: await isCommunityMemberStillInGuild(config, guildId, discordUserId)
    })));
    presentIds.push(...checks.filter((item) => item.present).map((item) => item.discordUserId));
  }
  return presentIds;
}

let credentialEncryptionKey = null;

function getCredentialEncryptionKey() {
  if (credentialEncryptionKey) return credentialEncryptionKey;
  const secret = process.env.ADMIN_PASSWORD ?? process.env.VITE_ADMIN_PASSWORD;
  if (!secret) {
    const error = new Error("Admin credentials are not configured.");
    error.statusCode = 503;
    throw error;
  }

  credentialEncryptionKey = crypto.scryptSync(secret, "pulcip-members-tokenu-credential-v1", 32);
  return credentialEncryptionKey;
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

function getDcordOrderProxiesSettingKey(uniqid) {
  return `dcord_order_proxies_${hashToken(String(uniqid ?? "").trim())}`;
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

async function loadDcordOrderProxies(uniqid) {
  if (!uniqid) return [];
  const raw = await loadEncryptedSetting(getDcordOrderProxiesSettingKey(uniqid));
  if (!raw) return [];

  try {
    return normalizeDcordStickyProxies(JSON.parse(raw));
  } catch {
    return normalizeDcordStickyProxies(raw);
  }
}

async function saveDcordOrderProxies(uniqid, proxies) {
  const normalized = normalizeDcordStickyProxies(proxies);
  await saveEncryptedSetting(getDcordOrderProxiesSettingKey(uniqid), JSON.stringify(normalized));
  return normalized;
}

async function revealDcordOrderTokens(order) {
  if (!order || typeof order !== "object" || Array.isArray(order) || !Array.isArray(order.dcordResults)) return order;

  const assignedTokens = await loadDcordOrderTokens(order.uniqid);
  const assignedProxies = order.useProxy === true ? await loadDcordOrderProxies(order.uniqid) : [];
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
        boostCount: getDcordResultBoostCount(result),
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
      const proxy = getDcordProxyLabel(assignedProxies[index]);
      return { ...result, ...(fullToken ? { token: fullToken } : {}), ...(proxy ? { proxy } : {}) };
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
        boostCount: Math.min(Math.max(Number.parseInt(item.boostCount, 10) || (item.boosted === true ? 2 : 0), 0), 2),
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
    const proxy = normalizeDcordProxyForDcord(item);
    if (!proxy || proxy.length > 1000 || seen.has(proxy)) return;
    seen.add(proxy);
    normalized.push(proxy);
  });
  return normalized.slice(0, 1000);
}

function normalizeDcordProxyForDcord(value) {
  const proxy = String(value ?? "").trim();
  if (!proxy) return "";
  if (/^https?:\/\//i.test(proxy) || proxy.includes("@")) return proxy;
  const [host, port, username, password, ...extra] = proxy.split(":");
  if (!host || !port || !username || !password || extra.length) return "";
  return `${username}:${password}@${host}:${port}`;
}

function getDcordProxyLabel(value) {
  const proxy = String(value ?? "").trim();
  if (!proxy) return "";
  if (/^https?:\/\//i.test(proxy)) {
    try {
      const parsed = new URL(proxy);
      return parsed.username ? `${decodeURIComponent(parsed.username)}@${parsed.host}` : parsed.host;
    } catch {
      return proxy;
    }
  }
  const authenticatedSeparator = proxy.lastIndexOf("@");
  if (authenticatedSeparator >= 0) {
    const username = proxy.slice(0, authenticatedSeparator).split(":")[0];
    const endpoint = proxy.slice(authenticatedSeparator + 1);
    return username && endpoint ? `${username}@${endpoint}` : endpoint;
  }
  const parts = proxy.split(":");
  return parts.length >= 4 ? `${parts[2]}@${parts[0]}:${parts[1]}` : parts.length >= 2 ? `${parts[0]}:${parts[1]}` : proxy;
}

function getDcordProxyUrl(value) {
  const proxy = normalizeDcordProxyForDcord(value);
  if (!proxy) return "";
  if (/^https?:\/\//i.test(proxy)) return proxy;
  if (proxy.includes("@")) return `http://${proxy}`;
  return "";
}

async function checkDcordProxy(proxy) {
  const proxyUrl = getDcordProxyUrl(proxy);
  if (!proxyUrl) throw new Error("Proxy format is invalid.");

  try {
    await execFile("curl", [
      "--proxy", proxyUrl,
      "--connect-timeout", String(Math.ceil(dcordProxyCheckTimeoutMs / 1000)),
      "--max-time", String(Math.ceil(dcordProxyCheckTimeoutMs / 1000)),
      "--silent",
      "--show-error",
      "--fail",
      "--output", process.platform === "win32" ? "NUL" : "/dev/null",
      dcordProxyCheckUrl
    ], {
      timeout: dcordProxyCheckTimeoutMs + 2_000,
      maxBuffer: 64 * 1024
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "connection failed")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    throw new Error(`Proxy connection check failed${detail ? `: ${detail}` : "."}`);
  }
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

async function reserveDcordProxies(count) {
  const requested = Number.parseInt(count, 10);
  if (!Number.isFinite(requested) || requested < 1) return [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT encrypted_value FROM app_settings WHERE setting_key = 'dcord_sticky_proxies' FOR UPDATE"
    );
    const proxies = result.rowCount
      ? (() => {
        const raw = decryptCredential(result.rows[0].encrypted_value);
        try {
          return normalizeDcordStickyProxies(JSON.parse(raw));
        } catch {
          return normalizeDcordStickyProxies(raw);
        }
      })()
      : [];
    if (proxies.length < requested) {
      const error = new Error(`Add at least ${requested} proxies before creating this proxy order.`);
      error.statusCode = 409;
      throw error;
    }

    const reserved = proxies.slice(0, requested);
    const remaining = proxies.slice(requested);
    await client.query(
      `INSERT INTO app_settings (setting_key, encrypted_value, updated_at)
       VALUES ('dcord_sticky_proxies', $1, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
      [encryptCredential(JSON.stringify(remaining))]
    );
    await client.query("COMMIT");
    return reserved;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeDcordBoostConcurrency(value) {
  return Math.min(Math.max(Number.parseInt(value, 10) || defaultDcordBoostConcurrency, 1), 1_000);
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
      boostCount: getDcordResultBoostCount(result),
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

function parseCommunityAccessTokenExpiry(record) {
  const expiresInSeconds = Number(record?.expires_in ?? record?.expiresIn);
  const rawAuthorizedAt = Number(record?.authed_timestamp ?? record?.authedTimestamp);
  const authorizedAtMs = rawAuthorizedAt > 10_000_000_000 ? rawAuthorizedAt : rawAuthorizedAt * 1000;
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0 || !Number.isFinite(authorizedAtMs) || authorizedAtMs <= 0) {
    return null;
  }
  const expiresAtMs = authorizedAtMs + expiresInSeconds * 1000;
  const expiresAt = new Date(expiresAtMs);
  return Number.isFinite(expiresAt.getTime()) ? expiresAt : null;
}

async function syncCommunityAuthorizations(config) {
  await markCommunityFailedDeliveriesInactive(pool, config.guildId);
  const result = await pool.query(
    `SELECT discord_user_id, encrypted_access_token, access_token_expires_at, authorized_at
     FROM community_oauth_joins
     WHERE guild_id = $1 AND encrypted_access_token IS NOT NULL AND status <> 'failed'
     ORDER BY authorized_at ASC`,
    [config.guildId]
  );
  const summary = { checked: 0, inactive: 0, removed: 0, errors: 0 };

  const failedResults = await pool.query(
    `SELECT result->>'discordUserId' AS discord_user_id, result->>'completedAt' AS completed_at
     FROM tracked_orders
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(payload->'communityResults') = 'array' THEN payload->'communityResults' ELSE '[]'::jsonb END
     ) AS result
     WHERE payload->>'provider' = 'community'
       AND payload->>'serverId' = $1
       AND LOWER(COALESCE(result->>'state', '')) = 'failed'
       AND COALESCE(result->>'details', '') !~* '(400002|access to inviting new users through invite links has been limited for this guild)'`,
    [config.guildId]
  );
  const latestFailureByUserId = new Map();
  for (const failed of failedResults.rows) {
    const discordUserId = String(failed.discord_user_id ?? "");
    const failedAt = new Date(failed.completed_at).getTime();
    if (!isDiscordGuildId(discordUserId) || !Number.isFinite(failedAt)) continue;
    latestFailureByUserId.set(discordUserId, Math.max(latestFailureByUserId.get(discordUserId) ?? 0, failedAt));
  }
  const deliveryFailedUserIds = result.rows
    .filter((member) => (latestFailureByUserId.get(String(member.discord_user_id)) ?? 0) >= new Date(member.authorized_at).getTime())
    .map((member) => String(member.discord_user_id));
  if (deliveryFailedUserIds.length) {
    const disabled = await pool.query(
      `UPDATE community_oauth_joins
       SET status = 'failed', details = 'A previous delivery failed; this member was disabled automatically.', reserved_order_id = NULL
       WHERE guild_id = $1 AND discord_user_id = ANY($2::text[]) AND status <> 'failed'`,
      [config.guildId, deliveryFailedUserIds]
    );
    summary.inactive += disabled.rowCount;
  }
  const deliveryFailedUserIdSet = new Set(deliveryFailedUserIds);

  for (const member of result.rows) {
    summary.checked += 1;
    if (deliveryFailedUserIdSet.has(String(member.discord_user_id))) continue;
    try {
      const expiresAt = new Date(member.access_token_expires_at).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("expired");
      const identity = await requestDiscord("oauth2/@me", {
        headers: { Authorization: `Bearer ${decryptCredential(member.encrypted_access_token)}` }
      });
      if (!identity.response.ok || String(identity.payload?.user?.id ?? "") !== member.discord_user_id) throw new Error("invalid");
      await pool.query("UPDATE community_oauth_joins SET details = NULL WHERE discord_user_id = $1 AND guild_id = $2", [member.discord_user_id, config.guildId]);
    } catch {
      const inactive = await pool.query(
        `UPDATE community_oauth_joins
         SET status = 'failed', details = 'OAuth access token expired or became invalid. Re-import a current export; automatic refresh is disabled.', reserved_order_id = NULL
         WHERE discord_user_id = $1 AND guild_id = $2`,
        [member.discord_user_id, config.guildId]
      );
      summary.inactive += inactive.rowCount;
      summary.removed = summary.inactive;
    }
  }

  summary.removed = summary.inactive;
  return summary;
}

async function checkCommunityOrderAuthorizations(order) {
  if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
    const error = new Error("This order does not contain Members 2 delivery results.");
    error.statusCode = 400;
    throw error;
  }
  const config = await getCommunityOAuthConfig();
  const targetGuildId = String(order.serverId ?? "").trim();
  if (!config.configured || !isDiscordGuildId(targetGuildId)) {
    const error = new Error("To check members, please add the bot to your Discord server.");
    error.statusCode = 409;
    throw error;
  }
  const orderConfig = normalizeCommunityOAuthConfig({ ...config, guildId: targetGuildId });
  const botAccess = await checkCommunityBotGuildAccess(orderConfig, targetGuildId);
  if (!botAccess.accessible) {
    const error = new Error("To check members, please add the bot to your Discord server.");
    error.statusCode = 409;
    throw error;
  }

  const discordUserIds = order.communityResults
    .map((item) => String(item?.discordUserId ?? ""))
    .filter(isDiscordGuildId);
  const stock = discordUserIds.length
    ? await pool.query(
        `SELECT discord_user_id, encrypted_access_token, access_token_expires_at
         FROM community_oauth_joins
         WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])`,
        [targetGuildId, discordUserIds]
      )
    : { rows: [] };
  const stockByUserId = new Map(stock.rows.map((row) => [String(row.discord_user_id), row]));
  const checks = new Map();

  for (let start = 0; start < discordUserIds.length; start += 10) {
    const batch = discordUserIds.slice(start, start + 10);
    const results = await Promise.all(batch.map(async (discordUserId) => {
      const record = stockByUserId.get(discordUserId);
      const expiresAt = new Date(record?.access_token_expires_at).getTime();
      if (!record?.encrypted_access_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        return [discordUserId, { status: "inactive", details: "OAuth access token is missing or expired." }];
      }
      try {
        let identity = await requestDiscord("oauth2/@me", {
          headers: { Authorization: `Bearer ${decryptCredential(record.encrypted_access_token)}` }
        });
        if (identity.response.status === 429) {
          const retrySeconds = Math.min(Math.max(Number(identity.payload?.retry_after) || 1, 1), 5);
          await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
          identity = await requestDiscord("oauth2/@me", {
            headers: { Authorization: `Bearer ${decryptCredential(record.encrypted_access_token)}` }
          });
        }
        if (!identity.response.ok || String(identity.payload?.user?.id ?? "") !== discordUserId) {
          if ([401, 403].includes(identity.response.status) || identity.response.ok) {
            return [discordUserId, { status: "inactive", details: "OAuth authorization is expired or invalid." }];
          }
          return [discordUserId, { status: "unknown", details: `Discord could not verify OAuth authorization (HTTP ${identity.response.status}).` }];
        }

        let guildMember = await requestDiscord(
          `guilds/${encodeURIComponent(targetGuildId)}/members/${encodeURIComponent(discordUserId)}`,
          { headers: { Authorization: `Bot ${orderConfig.botToken}` } }
        );
        if (guildMember.response.status === 429) {
          const retrySeconds = Math.min(Math.max(Number(guildMember.payload?.retry_after) || 1, 1), 5);
          await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
          guildMember = await requestDiscord(
            `guilds/${encodeURIComponent(targetGuildId)}/members/${encodeURIComponent(discordUserId)}`,
            { headers: { Authorization: `Bot ${orderConfig.botToken}` } }
          );
        }
        if (guildMember.response.status === 404 || Number(guildMember.payload?.code) === 10007) {
          communityMemberPresenceCache.set(`${targetGuildId}:${discordUserId}`, {
            present: false,
            expiresAt: Date.now() + 5 * 60_000
          });
          return [discordUserId, {
            status: "active",
            details: "OAuth authorization is active.",
            membershipStatus: "removed",
            membershipDetails: "This member is no longer in the Discord server."
          }];
        }
        if (guildMember.response.ok) {
          communityMemberPresenceCache.set(`${targetGuildId}:${discordUserId}`, {
            present: true,
            expiresAt: Date.now() + 60_000
          });
        }
        return [discordUserId, {
          status: "active",
          details: "OAuth authorization is active.",
          membershipStatus: guildMember.response.ok ? "present" : "unknown",
          membershipDetails: guildMember.response.ok ? "This member is in the Discord server." : "Server membership could not be verified right now."
        }];
      } catch {
        return [discordUserId, { status: "unknown", details: "OAuth authorization could not be checked right now." }];
      }
    }));
    results.forEach(([discordUserId, result]) => checks.set(discordUserId, result));
  }

  const inactiveUserIds = [...checks.entries()].filter(([, check]) => check.status === "inactive").map(([discordUserId]) => discordUserId);
  if (inactiveUserIds.length) {
    await pool.query(
      `UPDATE community_oauth_joins
       SET status = 'failed', details = 'OAuth access token expired or became invalid. Re-import a current export; automatic refresh is disabled.', reserved_order_id = NULL
       WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])`,
      [targetGuildId, inactiveUserIds]
    );
  }

  const checkedAt = new Date().toISOString();
  const communityResults = order.communityResults.map((item) => {
    const check = checks.get(String(item?.discordUserId ?? ""));
    return check ? {
      ...item,
      authorizationStatus: check.status,
      authorizationDetails: check.details,
      membershipStatus: check.membershipStatus,
      membershipDetails: check.membershipDetails,
      authorizationCheckedAt: checkedAt
    } : item;
  });
  const summary = {
    checked: checks.size,
    active: [...checks.values()].filter((check) => check.status === "active").length,
    inactive: inactiveUserIds.length,
    unknown: [...checks.values()].filter((check) => check.status === "unknown").length,
    checkedAt
  };
  const checkedOrder = { ...order, communityResults, memberCheckSummary: summary };
  await saveTrackedOrderPayload(checkedOrder);
  return { order: checkedOrder, summary };
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

function getDiscordRequestFailureDetails(label, result) {
  const status = Number(result?.response?.status ?? 0);
  const code = Number(result?.payload?.code ?? 0);
  const message = String(result?.payload?.message ?? "Discord rejected the request.").trim();
  return `${label} failed (HTTP ${status || "unknown"}${code ? `, Discord code ${code}` : ""}): ${message}`;
}

function getCommunityJoinRequests(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.guild_join_requests) ? payload.guild_join_requests : [];
}

async function approveCommunityJoinRequest(config, discordUserId) {
  let request = null;
  let lastListResult = null;

  // The application can be created shortly after guilds.join returns, so give
  // Discord's experimental request index a small window to catch up.
  for (let attempt = 0; attempt < 5 && !request; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    lastListResult = await requestDiscord(
      `guilds/${encodeURIComponent(config.guildId)}/requests?status=SUBMITTED&limit=100`,
      { headers: { Authorization: `Bot ${config.botToken}` } }
    );
    if (lastListResult.response.status === 429) {
      const retrySeconds = Math.min(Math.max(Number(lastListResult.payload?.retry_after) || 1, 1), 5);
      await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
      continue;
    }
    if (!lastListResult.response.ok) break;
    request = getCommunityJoinRequests(lastListResult.payload).find((item) =>
      String(item?.user_id ?? item?.user?.id ?? "") === String(discordUserId)
    ) ?? null;
  }

  if (!request) {
    const status = Number(lastListResult?.response?.status ?? 0);
    const message = String(lastListResult?.payload?.message ?? "").trim();
    const error = new Error(
      status === 403
        ? "The Members bot needs Kick Members permission to approve Apply-to-Join requests."
        : status === 401
          ? "Discord rejected the saved Members bot token while reading Apply-to-Join requests."
          : status >= 400
            ? message || `Discord could not list Apply-to-Join requests (${status}).`
            : "Discord did not expose the pending Apply-to-Join request yet."
    );
    error.discordJoinRequest = true;
    throw error;
  }

  const requestId = String(request.id ?? "").trim();
  if (!isDiscordGuildId(requestId)) {
    const error = new Error("Discord returned an Apply-to-Join request without a valid request ID.");
    error.discordJoinRequest = true;
    throw error;
  }

  let approval = await requestDiscord(
    `guilds/${encodeURIComponent(config.guildId)}/requests/${encodeURIComponent(requestId)}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bot ${config.botToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "APPROVED" })
    }
  );
  if (approval.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(approval.payload?.retry_after) || 1, 1), 5);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    approval = await requestDiscord(
      `guilds/${encodeURIComponent(config.guildId)}/requests/${encodeURIComponent(requestId)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bot ${config.botToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVED" })
      }
    );
  }
  if (!approval.response.ok) {
    const status = Number(approval.response.status);
    const message = String(approval.payload?.message ?? "").trim();
    const error = new Error(
      status === 403
        ? "The Members bot needs Kick Members permission to approve this Apply-to-Join request."
        : message || `Discord could not approve the Apply-to-Join request (${status}).`
    );
    error.discordJoinRequest = true;
    throw error;
  }

  return approval;
}

async function resolveCommunityPendingJoin(config, discordUserId) {
  let member = await requestDiscord(
    `guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(discordUserId)}`,
    { headers: { Authorization: `Bot ${config.botToken}` } }
  );
  if (member.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(member.payload?.retry_after) || 1, 1), 5);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    member = await requestDiscord(
      `guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(discordUserId)}`,
      { headers: { Authorization: `Bot ${config.botToken}` } }
    );
  }

  if (member.response.ok) {
    return {
      joined: true,
      autoApproved: false,
      pendingScreening: member.payload?.pending === true
    };
  }

  if (member.response.status !== 404) {
    const status = Number(member.response.status);
    const message = String(member.payload?.message ?? "").trim();
    const error = new Error(
      status === 403
        ? "The Members bot cannot verify the joined member. Check its server access and permissions."
        : message || `Discord could not verify the joined member (${status}).`
    );
    error.discordJoinRequest = true;
    throw error;
  }

  await approveCommunityJoinRequest(config, discordUserId);
  return { joined: true, autoApproved: true, pendingScreening: false };
}

function isCommunityMembershipScreeningResponse(result) {
  const body = result?.payload;
  const message = String(body?.message ?? "").toLowerCase();
  if (body && typeof body === "object" && !Array.isArray(body) && body.pending === true) return true;
  return String(body?.application_status ?? "").toUpperCase() === "SUBMITTED"
    || /pending|screening|verification|member verification|membership|apply.to.join/i.test(message);
}

function isDiscordUnknownUser(value) {
  const payload = value?.payload && typeof value.payload === "object" ? value.payload : value;
  const code = Number(payload?.code ?? value?.code);
  const message = String(payload?.message ?? value?.message ?? value?.details ?? value?.discordError ?? "");
  return code === 10013 || /unknown user/i.test(message);
}

function isDiscordGuildInviteLimited(value) {
  const payload = value?.payload && typeof value.payload === "object" ? value.payload : value;
  const code = Number(payload?.code ?? value?.code);
  const message = String(payload?.message ?? value?.message ?? value?.details ?? value?.discordError ?? "");
  return code === 400002 || /access to inviting new users through invite links has been limited for this guild/i.test(message);
}

async function recoverCommunityGuildRestrictionOrder(order) {
  if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) return order;
  const restrictedUserIds = order.communityResults
    .filter((item) => String(item?.state ?? "").toLowerCase() === "failed" && isDiscordGuildInviteLimited(item))
    .map((item) => String(item?.discordUserId ?? ""))
    .filter(isDiscordGuildId);
  if (!restrictedUserIds.length) return order;

  await pool.query(
    `UPDATE community_oauth_joins
     SET status = 'authorized', details = NULL, reserved_order_id = NULL
     WHERE guild_id = $1
       AND discord_user_id = ANY($2::text[])
       AND encrypted_access_token IS NOT NULL
       AND access_token_expires_at > NOW()`,
    [order.serverId, restrictedUserIds]
  );

  const currentStatus = String(order.status ?? "").toUpperCase();
  const delivered = Number(order.added ?? 0);
  const amount = Number(order.amount ?? 0);
  if (["COMPLETED", "CANCELLED", "CANCELED", "TERMINATED"].includes(currentStatus) || (amount > 0 && delivered >= amount)) {
    return order;
  }

  const restrictedUserIdSet = new Set(restrictedUserIds);
  const recoveredOrder = {
    ...order,
    status: "INVITES PAUSED",
    waitingCode: "discord_guild_invites_limited",
    details: "Discord has temporarily limited new member access for this server. Delivery is paused and the member accounts remain active.",
    pausedAt: order.pausedAt ?? new Date().toISOString(),
    pausedFromStatus: "PROCESS",
    communityResults: order.communityResults.map((item) => restrictedUserIdSet.has(String(item?.discordUserId ?? ""))
      ? {
          ...item,
          state: "queued",
          details: "Waiting for Discord to restore new member access for this server.",
          completedAt: undefined,
          authorizationStatus: "active",
          authorizationDetails: "The account is active; delivery was blocked by a server restriction.",
          authorizationCheckedAt: new Date().toISOString()
        }
      : item)
  };
  await saveTrackedOrderPayload(recoveredOrder);
  return recoveredOrder;
}

function loadCommunityAccessToken(member) {
  const expiresAt = new Date(member?.access_token_expires_at).getTime();
  if (!member?.encrypted_access_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    const error = new Error("OAuth access token expired. Re-import a current S2Tools export; automatic refresh is disabled.");
    error.oauthAccessInvalid = true;
    throw error;
  }
  return decryptCredential(member.encrypted_access_token);
}

const communityBalancedDelayPattern = [30, 180, 75, 300, 120, 45, 240, 90, 150, 60, 210, 100];

function normalizeCommunitySpeedProfile(value) {
  const profile = String(value ?? "custom").trim().toLowerCase();
  return ["safe", "balanced", "fast"].includes(profile) ? profile : "custom";
}

function getCommunityBotUnavailableStatus(result) {
  const status = Number(result?.response?.status ?? 0);
  const code = Number(result?.payload?.code ?? 0);
  return status === 404 || code === 10004 || code === 50001
    ? status || 403
    : null;
}

async function runCommunityOrder(order, members, config) {
  const savedResults = Array.isArray(order.communityResults) ? order.communityResults : [];
  const results = savedResults.length
    ? savedResults.map((result) => ({ ...result }))
    : members.map((member) => ({
        discordUserId: member.discord_user_id,
        username: member.username,
        avatarUrl: member.avatar_url ?? null,
        state: "queued",
        details: "Waiting for delivery."
      }));
  let added = Math.max(
    Number.isFinite(Number(order.added)) ? Number(order.added) : 0,
    results.filter((result) => String(result?.state ?? "").toLowerCase() === "joined").length
  );
  let blockedByMembershipScreening = false;

  async function saveCommunityProgress(payload) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [order.uniqid]);
      const currentPayload = locked.rows[0]?.payload;
      const currentStatus = String(currentPayload?.status ?? "").toUpperCase();
      if (!currentPayload || currentStatus === "CANCELLED") {
        await client.query("ROLLBACK");
        return false;
      }

      const incomingResults = Array.isArray(payload.communityResults) ? payload.communityResults : [];
      const storedResults = Array.isArray(currentPayload.communityResults) ? currentPayload.communityResults : [];
      const resultCount = Math.max(incomingResults.length, storedResults.length);
      const mergedResults = Array.from({ length: resultCount }, (_, resultIndex) => {
        const incoming = incomingResults[resultIndex];
        const stored = storedResults[resultIndex];
        if (!incoming) return stored;
        if (!stored) return incoming;
        const incomingReplacementAttempt = Number(incoming?.replacementAttempt ?? 0);
        const storedReplacementAttempt = Number(stored?.replacementAttempt ?? 0);
        return storedReplacementAttempt > incomingReplacementAttempt ? stored : incoming;
      }).filter(Boolean);
      const mergedAdded = mergedResults.filter((item) => String(item?.state ?? "").toLowerCase() === "joined").length;
      const amount = Number(payload.amount ?? currentPayload.amount ?? order.amount) || mergedResults.length;
      const requestedStatus = String(payload.status ?? "PROCESS").toUpperCase();
      const terminalStatusRequested = ["COMPLETED", "PARTIAL", "ERROR"].includes(requestedStatus);
      const status = terminalStatusRequested
        ? mergedAdded >= amount ? "COMPLETED" : mergedAdded > 0 ? "PARTIAL" : "ERROR"
        : payload.status;
      const details = terminalStatusRequested
        ? mergedAdded >= amount
          ? `${mergedAdded}/${amount} members delivered.`
          : `${mergedAdded}/${amount} members delivered. Review the member results.`
        : requestedStatus === "PROCESS"
          ? `${mergedAdded}/${amount} members delivered.`
          : String(payload.details ?? `${mergedAdded}/${amount} members delivered.`);
      const latestDelay = Number.parseInt(currentPayload.delay, 10);
      const latestSpeedProfile = normalizeCommunitySpeedProfile(currentPayload.speedProfile ?? order.speedProfile);
      const deliveryPaused = currentStatus === "PAUSED";
      const nextPayload = {
        ...payload,
        added: mergedAdded,
        status: deliveryPaused ? "PAUSED" : status,
        details: deliveryPaused ? "Delivery paused." : details,
        delay: Number.isFinite(latestDelay) && latestDelay >= 0 ? latestDelay : order.delay,
        speedProfile: latestSpeedProfile,
        activeDelay: terminalStatusRequested ? null : currentPayload.activeDelay ?? payload.activeDelay ?? null,
        nextMemberAt: terminalStatusRequested ? null : currentPayload.nextMemberAt ?? payload.nextMemberAt ?? null,
        communityResults: mergedResults,
        ...(deliveryPaused ? {
          waitingCode: "manual_pause",
          pausedAt: currentPayload.pausedAt ?? new Date().toISOString(),
          pausedFromStatus: currentPayload.pausedFromStatus ?? "PROCESS",
          pausedWaitingCode: currentPayload.pausedWaitingCode ?? null
        } : {})
      };
      await client.query(
        "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
        [order.uniqid, JSON.stringify(nextPayload)]
      );
      await client.query("COMMIT");
      order.delay = nextPayload.delay;
      return !deliveryPaused;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function detectMissingCommunityBot() {
    try {
      const access = await checkCommunityBotDirectGuildAccess(config, config.guildId);
      if (access.accessible) return null;
      const status = Number(access.status) || 0;
      return [401, 403, 404].includes(status) ? status : null;
    } catch {
      return null;
    }
  }

  async function pauseForCommunityBotIssue(startIndex, { waitingCode, details, memberDetails, status = "WAITING" }) {
    for (let remainingIndex = startIndex; remainingIndex < members.length; remainingIndex += 1) {
      const remainingMember = members[remainingIndex];
      const queuedIndex = results.findIndex((result) => result?.discordUserId === remainingMember.discord_user_id);
      if (queuedIndex < 0) continue;
      results[queuedIndex] = {
        ...results[queuedIndex],
        state: "queued",
        details: memberDetails
      };
    }
    await saveCommunityProgress({
      ...order,
      added,
      status,
      waitingCode,
      botInvite: createCommunityBotInvite(config, config.guildId),
      details,
      ...(status === "PAUSED" ? { pausedAt: new Date().toISOString(), pausedFromStatus: "PROCESS" } : {}),
      communityResults: results
    });
  }

  async function waitForNextCommunityMember(patternIndex, queuedStartIndex, existingNextMemberAt = null) {
    const existingDeadline = Date.parse(String(existingNextMemberAt ?? ""));
    const existingActiveDelay = Number(order.activeDelay);
    const delayStartedAt = Number.isFinite(existingDeadline) && Number.isFinite(existingActiveDelay)
      ? existingDeadline - existingActiveDelay * 1_000
      : Date.now();
    let lastBotCheckAt = Date.now();
    while (true) {
      const control = await pool.query(
        "SELECT payload->>'status' AS status, payload->>'delay' AS delay, payload->>'speedProfile' AS speed_profile FROM tracked_orders WHERE uniqid = $1 LIMIT 1",
        [order.uniqid]
      );
      if (!control.rowCount || ["CANCELLED", "PAUSED"].includes(String(control.rows[0]?.status ?? "").toUpperCase())) return false;
      const currentDelay = Number.parseInt(control.rows[0]?.delay, 10);
      const originalDelay = Number(order.delay);
      const configuredDelay = Number.isFinite(currentDelay) && currentDelay >= 0
        ? currentDelay
        : Number.isFinite(originalDelay) && originalDelay >= 0 ? originalDelay : 1;
      const speedProfile = normalizeCommunitySpeedProfile(control.rows[0]?.speed_profile);
      const delaySeconds = speedProfile === "balanced" && configuredDelay > 0
        ? communityBalancedDelayPattern[patternIndex % communityBalancedDelayPattern.length]
        : configuredDelay;
      const delayEndsAt = delayStartedAt + delaySeconds * 1_000;
      const nextMemberAt = new Date(delayEndsAt).toISOString();
      const activeDelayUpdate = await pool.query(
        `UPDATE tracked_orders
         SET payload = jsonb_set(
           jsonb_set(payload, '{activeDelay}', to_jsonb($2::int)),
           '{nextMemberAt}', to_jsonb($3::text)
         ), updated_at = NOW()
         WHERE uniqid = $1 AND payload->>'status' = 'PROCESS'
         RETURNING uniqid`,
        [order.uniqid, delaySeconds, nextMemberAt]
      );
      if (!activeDelayUpdate.rowCount) return false;
      order.activeDelay = delaySeconds;
      order.nextMemberAt = nextMemberAt;
      const remainingDelay = delayEndsAt - Date.now();
      if (remainingDelay <= 0) break;

      if (Date.now() - lastBotCheckAt >= 60_000) {
        lastBotCheckAt = Date.now();
        const missingBotStatus = await detectMissingCommunityBot();
        if (missingBotStatus) {
          await pauseForCommunityBotIssue(queuedStartIndex, {
            waitingCode: `discord_${missingBotStatus}`,
            details: "The Members bot was removed or lost access. Add it to the server to continue delivery.",
            memberDetails: "Waiting for the Members bot to return to the server."
          });
          return false;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, remainingDelay)));
    }

    await pool.query(
      `UPDATE tracked_orders
       SET payload = jsonb_set(
         jsonb_set(payload, '{activeDelay}', 'null'::jsonb),
         '{nextMemberAt}', 'null'::jsonb
       ), updated_at = NOW()
       WHERE uniqid = $1 AND payload->>'status' = 'PROCESS'`,
      [order.uniqid]
    );
    order.activeDelay = null;
    order.nextMemberAt = null;
    return true;
  }

  if (members.length && order.nextMemberAt) {
    const resumedPatternIndex = Math.max(0, added - 1);
    if (!await waitForNextCommunityMember(resumedPatternIndex, 0, order.nextMemberAt)) return;
  }

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const missingBotStatus = await detectMissingCommunityBot();
    if (missingBotStatus) {
      await pauseForCommunityBotIssue(index, {
        waitingCode: `discord_${missingBotStatus}`,
        details: "The Members bot was removed or lost access. Add it to the server to continue delivery.",
        memberDetails: "Waiting for the Members bot to return to the server."
      });
      return;
    }
    let resultIndex = results.findIndex((result) => result?.discordUserId === member.discord_user_id);
    if (resultIndex < 0) {
      resultIndex = results.length;
      results.push({ discordUserId: member.discord_user_id, username: member.username, avatarUrl: member.avatar_url ?? null, state: "queued", details: "Waiting for delivery." });
    }
    results[resultIndex] = { discordUserId: member.discord_user_id, username: member.username, avatarUrl: member.avatar_url ?? null, state: "joining", details: "Discord membership request is running." };
    if (!await saveCommunityProgress({ ...order, added, status: "PROCESS", details: `${added}/${order.amount} members delivered.`, communityResults: results })) return;

    let state = "failed";
    let details = "Member could not be added.";
    let botPauseIssue = null;
    let memberAuthorizationInvalid = false;
    try {
      const joined = await addCommunityGuildMember(config, member.discord_user_id, loadCommunityAccessToken(member));
      if (isCommunityMembershipScreeningResponse(joined)) {
        if (experimentalCommunityJoinEnabled) {
          const pendingJoin = await resolveCommunityPendingJoin(config, member.discord_user_id);
          state = "joined";
          details = pendingJoin.autoApproved
            ? "Member applied and the Members bot approved the join request automatically."
            : pendingJoin.pendingScreening
              ? "Member joined the server and is pending Discord's server-rules screening."
              : "Member joined the server.";
          added += 1;
        } else {
          state = "blocked";
          details = "Discord membership screening is enabled on this server.";
          blockedByMembershipScreening = true;
        }
      } else if (joined.response.status === 201) {
        state = "joined";
        details = "Member joined the server.";
        added += 1;
      } else if (joined.response.status === 204) {
        state = "already_member";
        details = "User was already in the server.";
      } else {
        memberAuthorizationInvalid = isDiscordUnknownUser(joined);
        if (isDiscordGuildInviteLimited(joined)) {
          botPauseIssue = {
            status: "INVITES PAUSED",
            waitingCode: "discord_guild_invites_limited",
            details: "Discord has temporarily limited new member access for this server. Delivery is paused and the member accounts remain active.",
            memberDetails: "Waiting for Discord to restore new member access for this server."
          };
        } else {
          const botUnavailableStatus = getCommunityBotUnavailableStatus(joined);
          if (botUnavailableStatus) {
            const confirmedAccess = await checkCommunityBotGuildAccess(config, config.guildId).catch(() => ({ accessible: false }));
            if (!confirmedAccess.accessible) {
              botPauseIssue = {
                waitingCode: `discord_${botUnavailableStatus}`,
                details: "The Members bot was removed or lost access. Add it to the server to continue delivery.",
                memberDetails: "Waiting for the Members bot to return to the server."
              };
            }
          }
        }
        details = getDiscordRequestFailureDetails("Discord Add Guild Member", joined);
      }
    } catch (error) {
      details = error instanceof Error ? error.message : details;
      memberAuthorizationInvalid = isDiscordUnknownUser(error);
    }

    if (botPauseIssue) {
      await pauseForCommunityBotIssue(index, botPauseIssue);
      return;
    }

    if (["joined", "already_member"].includes(state)) {
      communityMemberPresenceCache.set(`${config.guildId}:${member.discord_user_id}`, {
        present: true,
        expiresAt: Date.now() + 60_000
      });
    }
    const memberFailed = state === "failed";
    const memberShouldBeInactive = memberFailed && memberAuthorizationInvalid;
    results[resultIndex] = {
      discordUserId: member.discord_user_id,
      username: member.username,
      avatarUrl: member.avatar_url ?? null,
      state,
      details,
      completedAt: new Date().toISOString(),
      ...(memberShouldBeInactive ? {
        authorizationStatus: "inactive",
        authorizationDetails: "Discord reported Unknown User, so this member was disabled in Members Stock.",
        authorizationCheckedAt: new Date().toISOString()
      } : {})
    };
    await pool.query(
      `UPDATE community_oauth_joins
       SET reserved_order_id = NULL,
           status = CASE WHEN $3 THEN 'failed' ELSE status END,
           details = CASE WHEN $3 THEN $4 ELSE details END
       WHERE discord_user_id = $1 AND guild_id = $2`,
      [member.discord_user_id, config.guildId, memberShouldBeInactive, memberShouldBeInactive ? `Delivery failed: ${details}` : null]
    );
    if (!await saveCommunityProgress({ ...order, added, status: "PROCESS", details: `${added}/${order.amount} members delivered.`, communityResults: results })) return;

    if (blockedByMembershipScreening) {
      for (let remainingIndex = index + 1; remainingIndex < members.length; remainingIndex += 1) {
        const remainingMember = members[remainingIndex];
        const queuedIndex = results.findIndex((result) => result?.discordUserId === remainingMember.discord_user_id);
        if (queuedIndex < 0) continue;
        results[queuedIndex] = {
          ...results[queuedIndex],
          state: "queued",
          details: "Delivery stopped before this member was used."
        };
      }
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

    if (index < members.length - 1 && !await waitForNextCommunityMember(index, index + 1)) return;
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

async function processCommunityOrder(order, members, config) {
  const orderId = String(order?.uniqid ?? "").trim();
  if (!orderId) return false;
  const ownerToken = `${communityWorkerInstanceId}-${crypto.randomBytes(8).toString("hex")}`;
  const lock = await pool.query(
    `INSERT INTO community_order_worker_leases (order_id, owner_token, expires_at)
     VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
     ON CONFLICT (order_id) DO UPDATE SET
       owner_token = EXCLUDED.owner_token,
       expires_at = EXCLUDED.expires_at
     WHERE community_order_worker_leases.expires_at <= NOW()
     RETURNING order_id`,
    [orderId, ownerToken, communityWorkerLeaseSeconds]
  );
  if (!lock.rowCount) return false;

  const heartbeat = setInterval(() => {
    void pool.query(
      `UPDATE community_order_worker_leases
       SET expires_at = NOW() + ($3 * INTERVAL '1 second')
       WHERE order_id = $1 AND owner_token = $2`,
      [orderId, ownerToken, communityWorkerLeaseSeconds]
    ).catch((error) => {
      console.error(`Members worker lease heartbeat failed for ${orderId}:`, error instanceof Error ? error.message : error);
    });
  }, 15_000);
  heartbeat.unref();

  try {
    await runCommunityOrder(order, members, config);
    return true;
  } finally {
    clearInterval(heartbeat);
    await pool.query(
      "DELETE FROM community_order_worker_leases WHERE order_id = $1 AND owner_token = $2",
      [orderId, ownerToken]
    ).catch(() => {});
  }
}

async function processCommunityReplacement(orderId, resultIndex, member, config) {
  let state = "failed";
  let details = "Replacement member could not be added.";
  let botPauseIssue = null;
  let memberAuthorizationInvalid = false;
  try {
    const joined = await addCommunityGuildMember(config, member.discord_user_id, loadCommunityAccessToken(member));
    if (isCommunityMembershipScreeningResponse(joined)) {
      if (experimentalCommunityJoinEnabled) {
        const pendingJoin = await resolveCommunityPendingJoin(config, member.discord_user_id);
        state = "joined";
        details = pendingJoin.autoApproved
          ? "Replacement member applied and the Members bot approved the join request automatically."
          : pendingJoin.pendingScreening
            ? "Replacement member joined and is pending Discord's server-rules screening."
            : "Replacement member joined the server.";
      } else {
        state = "blocked";
        details = "Discord membership screening is enabled on this server.";
      }
    } else if (joined.response.status === 201) {
      state = "joined";
      details = "Replacement member joined the server.";
    } else if (joined.response.status === 204) {
      state = "already_member";
      details = "Replacement user was already in the server.";
    } else {
      memberAuthorizationInvalid = isDiscordUnknownUser(joined);
      if (isDiscordGuildInviteLimited(joined)) {
        botPauseIssue = {
          status: "INVITES PAUSED",
          waitingCode: "discord_guild_invites_limited",
          details: "Discord has temporarily limited new member access for this server. Delivery is paused and the member account remains active.",
          memberDetails: "Waiting for Discord to restore new member access for this server."
        };
      } else {
        const botUnavailableStatus = getCommunityBotUnavailableStatus(joined);
        if (botUnavailableStatus) {
          const confirmedAccess = await checkCommunityBotGuildAccess(config, config.guildId).catch(() => ({ accessible: false }));
          if (!confirmedAccess.accessible) {
            botPauseIssue = {
              waitingCode: `discord_${botUnavailableStatus}`,
              details: "The Members bot was removed or lost access. Add it to the server to continue the replacement.",
              memberDetails: "Waiting for the Members bot to return to the server."
            };
          }
        }
      }
      details = typeof joined.payload?.message === "string" ? joined.payload.message : `Discord request failed (${joined.response.status}).`;
    }
  } catch (error) {
    details = error instanceof Error ? error.message : details;
    memberAuthorizationInvalid = isDiscordUnknownUser(error);
  }

  if (!botPauseIssue) {
    const memberFailed = state === "failed" && memberAuthorizationInvalid;
    await pool.query(
      `UPDATE community_oauth_joins
       SET reserved_order_id = NULL,
           status = CASE WHEN $3 THEN 'failed' ELSE status END,
           details = CASE WHEN $3 THEN $4 ELSE details END
       WHERE discord_user_id = $1 AND guild_id = $2`,
      [member.discord_user_id, config.guildId, memberFailed, memberFailed ? `Replacement failed: ${details}` : null]
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [orderId]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return;
    }
    const results = [...order.communityResults];
    const current = results[resultIndex];
    if (!current || current.discordUserId !== member.discord_user_id || String(current.state).toLowerCase() !== "replacing") {
      await client.query("ROLLBACK");
      return;
    }

    if (botPauseIssue) {
      results[resultIndex] = {
        ...current,
        state: "queued",
        details: botPauseIssue.memberDetails
      };
      const added = results.filter((item) => String(item?.state ?? "").toLowerCase() === "joined").length;
      const waitingOrder = {
        ...order,
        added,
        status: botPauseIssue.status ?? "WAITING",
        waitingCode: botPauseIssue.waitingCode,
        botInvite: createCommunityBotInvite(config, config.guildId),
        details: botPauseIssue.details,
        ...(botPauseIssue.status === "PAUSED" ? { pausedAt: new Date().toISOString(), pausedFromStatus: "PROCESS" } : {}),
        communityResults: results
      };
      await client.query(
        "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
        [orderId, JSON.stringify(waitingOrder)]
      );
      await client.query("COMMIT");
      return;
    }

    if (["joined", "already_member"].includes(state)) {
      communityMemberPresenceCache.set(`${config.guildId}:${member.discord_user_id}`, {
        present: true,
        expiresAt: Date.now() + 60_000
      });
    }
    results[resultIndex] = {
      ...current,
      state,
      details,
      completedAt: new Date().toISOString(),
      ...(state === "failed" && memberAuthorizationInvalid ? {
        authorizationStatus: "inactive",
        authorizationDetails: "Discord reported Unknown User, so this replacement was disabled in Members Stock.",
        authorizationCheckedAt: new Date().toISOString()
      } : {})
    };
    const added = results.filter((item) => String(item?.state ?? "").toLowerCase() === "joined").length;
    const amount = Number(order.amount) || results.length;
    const deliveryStillActive = results.some((item) => ["queued", "joining", "replacing"].includes(String(item?.state ?? "").toLowerCase()));
    const nextStatus = added >= amount ? "COMPLETED" : deliveryStillActive ? "PROCESS" : added > 0 ? "PARTIAL" : "ERROR";
    const updatedOrder = {
      ...order,
      added,
      status: nextStatus,
      details: nextStatus === "PROCESS"
        ? `${added}/${amount} members delivered.`
        : added >= amount ? `${added}/${amount} members delivered.` : `${added}/${amount} members delivered. Review the member results.`,
      communityResults: results
    };
    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [orderId, JSON.stringify(updatedOrder)]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function normalizeDcordJoinResult(result, token) {
  const rawBoostMessage = String(result?.boost_message ?? result?.boostMessage ?? result?.message ?? "").trim();
  const membershipScreeningBlocked = isDcordBoostMembershipScreeningMessage(rawBoostMessage);
  const boostMessage = membershipScreeningBlocked
    ? "Membership screening is enabled on this server. Disable the join form before boosting."
    : rawBoostMessage;
  const boostState = String(result?.boost_status ?? result?.boostStatus ?? "").trim().toLowerCase();
  const joinState = String(result?.join_status ?? result?.joinStatus ?? result?.status ?? "").trim().toLowerCase();
  const fullyBoosted = result?.boost === true || result?.boosted === true || boostState === "boosted" || boostMessage.toLowerCase().includes("boosted");
  const boostCount = fullyBoosted ? 2 : getDcordSuccessfulBoostCount(result, boostMessage);
  const boosted = boostCount >= 2;
  const partiallyBoosted = boostCount === 1;
  const joined = result?.success === true || result?.joined === true || ["ok", "joined", "completed", "success"].includes(joinState);
  return {
    token: redactToken(token),
    success: joined || boostCount > 0,
    status: boosted ? "joined + boosted" : partiallyBoosted ? "partial" : membershipScreeningBlocked ? "blocked" : joined ? "joined" : typeof result?.status === "string" ? result.status : "unknown",
    joinStatus: joined || boostCount > 0 ? "joined" : "failed",
    boostStatus: boosted ? "boosted" : partiallyBoosted ? "partial" : membershipScreeningBlocked ? "blocked" : joined ? (boostState || "failed") : "waiting",
    slots: boostCount,
    boost: boostCount > 0,
    boostCount,
    boostMessage,
    httpStatus: Number.isFinite(result?.http_status) ? result.http_status : undefined,
    boosted
  };
}

function getDcordSuccessfulBoostCount(result, message = "") {
  const explicitCount = Number.parseInt(result?.boost_count ?? result?.boostCount, 10);
  if (Number.isFinite(explicitCount)) return Math.min(Math.max(explicitCount, 0), 2);
  const slotLists = [result?.partial_ok_slots, result?.partialOkSlots, result?.successful_slots, result?.successfulSlots];
  const structuredSlots = slotLists.find((value) => Array.isArray(value));
  if (structuredSlots) return Math.min(new Set(structuredSlots.map(String).filter(Boolean)).size, 2);
  const listMatch = String(message).match(/partial_ok_slots\s*[=:]\s*\[([^\]]*)\]/i);
  if (!listMatch) return 0;
  const slotIds = listMatch[1].match(/\d{10,}/g) ?? [];
  return Math.min(new Set(slotIds).size, 2);
}

function getDcordResultBoostCount(result) {
  const count = Number.parseInt(result?.boostCount, 10);
  if (Number.isFinite(count)) return Math.min(Math.max(count, 0), 2);
  return result?.boosted === true ? 2 : 0;
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
    const partialBoostCount = getDcordSuccessfulBoostCount(result, rawMessage);
    const membershipScreeningBlocked = isDcordBoostMembershipScreeningMessage(rawMessage);
    const message = membershipScreeningBlocked
      ? "Membership screening is enabled on this server. Disable the join form before boosting."
      : rawMessage;
    if (partialBoostCount > 0) return {
      token: redactToken(token), success: true, status: "partial", joinStatus: "joined", boostStatus: "partial",
      slots: partialBoostCount, boost: true, boostCount: partialBoostCount, boostMessage: rawMessage,
      httpStatus: Number.isFinite(taskPayload?.http_status) ? taskPayload.http_status : undefined,
      boosted: false, dcordTaskId: taskId, dcordTaskStatus: taskStatus, taskPending: false, transportUncertain: false
    };
    return {
      token: redactToken(token), success: false, status: membershipScreeningBlocked ? "blocked" : "error", joinStatus: membershipScreeningBlocked ? "joined" : "failed", boostStatus: membershipScreeningBlocked ? "blocked" : "skipped",
      slots: 0, boost: false, boostCount: 0, boostMessage: message || "Dcord task failed.", boosted: false,
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

async function returnDcordTokenToStock(order, token) {
  const duration = Number.parseInt(order?.duration, 10);
  const normalizedToken = String(token ?? "").trim();
  if (![1, 3].includes(duration) || !normalizedToken) return false;

  const stock = await loadBoostTokenStock();
  const stockKey = duration === 3 ? "threeMonth" : "oneMonth";
  if (stock.oneMonth.includes(normalizedToken) || stock.threeMonth.includes(normalizedToken)) return false;
  await saveBoostTokenStock({ ...stock, [stockKey]: [...stock[stockKey], normalizedToken] });
  return true;
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
      const requestStartedAt = Date.now();
      const created = await requestDcord(dcordTaskCreatePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload)
      });
      taskId = getDcordTaskId(created);
      if (!taskId) throw new Error("Dcord created a task without returning a task ID.");
      await options.onTaskCreated?.(taskId, { acceptedMs: Date.now() - requestStartedAt });
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
  const assignedProxies = order.useProxy === true ? await loadDcordOrderProxies(orderId) : [];

  async function saveCurrentProgress(forceWaiting = false) {
    progressSave = progressSave.then(async () => {
      const added = results.reduce((total, item) => total + getDcordResultBoostCount(item), 0);
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
    const added = results.reduce((total, item) => total + getDcordResultBoostCount(item), 0);
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
    const tokenStartedAt = Date.now();
    const existingTaskId = results[index]?.dcordTaskId;
    const proxy = existingTaskId ? "" : assignedProxies[index];
    let proxyCheckMs = Number.isFinite(results[index]?.proxyCheckMs) ? results[index].proxyCheckMs : undefined;
    if (proxy) {
      const proxyCheckStartedAt = Date.now();
      try {
        await checkDcordProxy(proxy);
        proxyCheckMs = Date.now() - proxyCheckStartedAt;
      } catch (error) {
        proxyCheckMs = Date.now() - proxyCheckStartedAt;
        const message = error instanceof Error ? error.message : "Proxy connection check failed.";
        const returnedToStock = await returnDcordTokenToStock(order, token);
        results[index] = {
          ...results[index],
          status: "proxy_failed",
          joinStatus: "not started",
          boostStatus: "not started",
          boostMessage: `${message}${returnedToStock ? " Token returned to active stock." : ""}`,
          returnedToStock,
          proxyCheck: "failed",
          proxyCheckMs,
          totalMs: Date.now() - tokenStartedAt
        };
        await saveCurrentProgress();
        await runNextToken();
        return;
      }
    }
    results[index] = {
      ...results[index],
      status: "joining",
      joinStatus: "joining",
      boostStatus: "waiting",
      boostMessage: "Join + boost request is running.",
      ...(proxyCheckMs !== undefined ? { proxyCheck: "passed", proxyCheckMs } : {})
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
    const dcordStartedAt = Date.now();
    let dcordAcceptedMs = Number.isFinite(results[index]?.dcordAcceptedMs) ? results[index].dcordAcceptedMs : undefined;
    const normalizedResult = await runDcordBoostToken(token, invite, {
      existingTaskId,
      proxy,
      onTaskCreated: async (taskId, timing) => {
        dcordAcceptedMs = Number.isFinite(timing?.acceptedMs) ? timing.acceptedMs : undefined;
        results[index] = {
          ...results[index],
          status: "joining",
          joinStatus: "joining",
          boostStatus: "waiting",
          boostMessage: "Dcord accepted the task. Waiting for its result.",
          dcordTaskId: taskId,
          dcordTaskStatus: "pending",
          taskPending: true,
          usedTokenId,
          ...(dcordAcceptedMs !== undefined ? { dcordAcceptedMs } : {})
        };
        await saveCurrentProgress();
      }
    });
    const normalized = {
      ...normalizedResult,
      ...(proxyCheckMs !== undefined ? { proxyCheckMs } : {}),
      ...(dcordAcceptedMs !== undefined ? { dcordAcceptedMs } : {}),
      dcordElapsedMs: Date.now() - dcordStartedAt,
      totalMs: Date.now() - tokenStartedAt
    };
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
    CREATE TABLE IF NOT EXISTS community_order_worker_leases (
      order_id TEXT PRIMARY KEY,
      owner_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS community_order_worker_leases_expires_at_idx ON community_order_worker_leases (expires_at)");
  await pool.query("DELETE FROM community_order_worker_leases WHERE expires_at <= NOW()");
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
  await pool.query("DROP TABLE IF EXISTS community_oauth_states");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_stock_categories (
      guild_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_periodic BOOLEAN NOT NULL DEFAULT FALSE,
      icon_name TEXT NOT NULL DEFAULT 'Users',
      color_key TEXT NOT NULL DEFAULT 'violet',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, id)
    )
  `);
  await pool.query("ALTER TABLE community_stock_categories DROP CONSTRAINT IF EXISTS community_stock_categories_duration_check");
  await pool.query("ALTER TABLE community_stock_categories DROP COLUMN IF EXISTS duration_months");
  await pool.query("ALTER TABLE community_stock_categories ADD COLUMN IF NOT EXISTS icon_name TEXT");
  await pool.query("ALTER TABLE community_stock_categories ADD COLUMN IF NOT EXISTS color_key TEXT");
  await pool.query("UPDATE community_stock_categories SET icon_name = CASE WHEN id = 'online' THEN 'Timer' ELSE 'Users' END WHERE icon_name IS NULL OR BTRIM(icon_name) = ''");
  await pool.query("UPDATE community_stock_categories SET color_key = CASE WHEN id = 'offline' THEN 'emerald' ELSE 'violet' END WHERE color_key IS NULL OR BTRIM(color_key) = ''");
  await pool.query("ALTER TABLE community_stock_categories ALTER COLUMN icon_name SET DEFAULT 'Users'");
  await pool.query("ALTER TABLE community_stock_categories ALTER COLUMN icon_name SET NOT NULL");
  await pool.query("ALTER TABLE community_stock_categories ALTER COLUMN color_key SET DEFAULT 'violet'");
  await pool.query("ALTER TABLE community_stock_categories ALTER COLUMN color_key SET NOT NULL");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS community_stock_categories_guild_name_idx ON community_stock_categories (guild_id, LOWER(name))");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_oauth_joins (
      discord_user_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      username TEXT NOT NULL,
      avatar_url TEXT,
      encrypted_refresh_token TEXT,
      encrypted_access_token TEXT,
      access_token_expires_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      stock_type TEXT NOT NULL DEFAULT 'offline',
      details TEXT,
      authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      joined_at TIMESTAMPTZ,
      PRIMARY KEY (discord_user_id, guild_id)
    )
  `);
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT");
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT");
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ");
  await pool.query("UPDATE community_oauth_joins SET encrypted_refresh_token = NULL WHERE encrypted_refresh_token IS NOT NULL");
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS reserved_order_id TEXT");
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS stock_type TEXT NOT NULL DEFAULT 'offline'");
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS sort_position BIGINT");
  await pool.query("UPDATE community_oauth_joins SET stock_type = 'offline' WHERE stock_type IS NULL OR BTRIM(stock_type) = ''");
  await pool.query(`
    WITH ranked AS (
      SELECT discord_user_id, guild_id,
             ROW_NUMBER() OVER (
               PARTITION BY guild_id, stock_type
               ORDER BY CASE WHEN status = 'failed' THEN 1 ELSE 0 END ASC,
                        authorized_at ASC,
                        discord_user_id ASC
             ) * 1024 AS position
      FROM community_oauth_joins
      WHERE sort_position IS NULL
    )
    UPDATE community_oauth_joins AS stock
    SET sort_position = ranked.position
    FROM ranked
    WHERE stock.discord_user_id = ranked.discord_user_id AND stock.guild_id = ranked.guild_id
  `);
  await pool.query("ALTER TABLE community_oauth_joins ALTER COLUMN sort_position SET DEFAULT 1024");
  await pool.query("ALTER TABLE community_oauth_joins ALTER COLUMN sort_position SET NOT NULL");
  await pool.query(`
    INSERT INTO community_stock_categories (guild_id, id, name, is_periodic, icon_name, color_key)
    SELECT DISTINCT guild_id, 'offline', 'Offline', FALSE, 'Users', 'emerald' FROM community_oauth_joins
    ON CONFLICT (guild_id, id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO community_stock_categories (guild_id, id, name, is_periodic, icon_name, color_key)
    SELECT DISTINCT guild_id, 'online', 'Online', FALSE, 'Timer', 'violet' FROM community_oauth_joins
    ON CONFLICT (guild_id, id) DO NOTHING
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS community_oauth_joins_guild_status_idx ON community_oauth_joins (guild_id, status)");
  await pool.query("CREATE INDEX IF NOT EXISTS community_oauth_joins_guild_type_status_idx ON community_oauth_joins (guild_id, stock_type, status)");
  await pool.query("CREATE INDEX IF NOT EXISTS community_oauth_joins_reservation_idx ON community_oauth_joins (guild_id, reserved_order_id)");
  await pool.query(`
    UPDATE community_oauth_joins
    SET details = 'Re-import OAuth stock to store its current access token. Automatic refresh is disabled.'
    WHERE encrypted_access_token IS NULL AND status = 'authorized'
  `);
  await pool.query(`
    UPDATE community_oauth_joins
    SET status = 'authorized',
        details = 'The previous delivery attempt failed, but the OAuth authorization remains active.'
    WHERE status = 'failed'
      AND details ~* '^(Delivery|Replacement) failed:'
      AND details !~* '(Unknown User|10013)'
  `);
  await pool.query(`
    UPDATE tracked_orders
    SET payload = jsonb_set(
      payload,
      '{communityResults}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN item->>'authorizationStatus' = 'inactive'
              AND COALESCE(item->>'details', '') !~* '(Unknown User|10013)'
            THEN item - 'authorizationStatus' - 'authorizationDetails' - 'authorizationCheckedAt'
            ELSE item
          END
          ORDER BY ordinal
        )
        FROM jsonb_array_elements(payload->'communityResults') WITH ORDINALITY AS entries(item, ordinal)
      )
    ), updated_at = NOW()
    WHERE payload->>'provider' = 'community'
      AND jsonb_typeof(payload->'communityResults') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(payload->'communityResults') AS entries(item)
        WHERE item->>'authorizationStatus' = 'inactive'
          AND COALESCE(item->>'details', '') !~* '(Unknown User|10013)'
      )
  `);
  await pool.query(`
    UPDATE community_oauth_joins AS stock
    SET reserved_order_id = NULL
    WHERE reserved_order_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM tracked_orders AS tracked
        WHERE tracked.uniqid = stock.reserved_order_id
          AND tracked.payload->>'provider' = 'community'
          AND UPPER(tracked.payload->>'status') IN ('WAITING', 'PROCESS', 'PAUSED', 'INVITES PAUSED')
      )
  `);
  await pool.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
  await recoverBlockedDcordJobOrders();
  await recoverPendingDcordOrders();
  await recoverInterruptedCommunityOrders();
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
app.use(express.json({ limit: "10mb" }));

app.get("/api/community/config", requireSession, async (_req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    const storedResult = await pool.query("SELECT 1 FROM app_settings WHERE setting_key = 'community_oauth_config' LIMIT 1");
    res.set("Cache-Control", "no-store").json({
      configured: config.configured,
      stored: Boolean(storedResult.rowCount),
      clientId: config.clientId,
      guildId: config.guildId,
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
    const requestedGuildId = String(req.body?.guildId ?? current.guildId ?? "").trim();
    const candidateWithoutDetectedGuild = normalizeCommunityOAuthConfig({
      clientId: req.body?.clientId || current.clientId,
      clientSecret: req.body?.clientSecret || current.clientSecret,
      botToken: req.body?.botToken || current.botToken,
      guildId: requestedGuildId
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

    let selectedGuild = null;
    if (requestedGuildId) {
      const requestedGuild = await requestDiscord(`guilds/${encodeURIComponent(requestedGuildId)}?with_counts=true`, {
        headers: { Authorization: `Bot ${candidateWithoutDetectedGuild.botToken}` }
      });
      if (requestedGuild.response.ok) selectedGuild = requestedGuild.payload;
    } else {
      const guildsResult = await requestDiscord("users/@me/guilds?limit=200", {
        headers: { Authorization: `Bot ${candidateWithoutDetectedGuild.botToken}` }
      });
      const botGuilds = Array.isArray(guildsResult.payload) ? guildsResult.payload : [];
      if (guildsResult.response.ok && botGuilds.length === 1) selectedGuild = botGuilds[0];
    }
    if (!selectedGuild) {
      return res.status(400).json({ message: "Enter a server ID that the Members bot has already joined." });
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

    const encryptedConfig = encryptCredential(JSON.stringify({
      clientId: candidate.clientId,
      clientSecret: candidate.clientSecret,
      botToken: candidate.botToken,
      guildId: candidate.guildId
    }));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await copyCommunityStockCategories(client, current.guildId, candidate.guildId);
      await client.query(
        `INSERT INTO app_settings (setting_key, encrypted_value, updated_at)
         VALUES ('community_oauth_config', $1, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
        [encryptedConfig]
      );
      await client.query(
        `INSERT INTO community_stock_categories (guild_id, id, name, is_periodic, icon_name, color_key)
         VALUES ($1, 'offline', 'Offline', FALSE, 'Users', 'emerald'), ($1, 'online', 'Online', FALSE, 'Timer', 'violet')
         ON CONFLICT (guild_id, id) DO NOTHING`,
        [candidate.guildId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    communityGuildCache = null;
    communityBotCache = null;
    res.json({
      configured: true,
      stored: true,
      clientId: candidate.clientId,
      guildId: candidate.guildId,
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

app.post("/api/community/categories", requireSession, async (req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before creating a category." });
    const name = String(req.body?.name ?? "").trim();
    const isPeriodic = req.body?.isPeriodic === true;
    const iconName = parseCommunityCategoryIconName(req.body?.iconName);
    const colorKey = parseCommunityCategoryColorKey(req.body?.colorKey);
    if (!name || name.length > 60) {
      return res.status(400).json({ message: "Enter a category name with up to 60 characters." });
    }
    if (!iconName) return res.status(400).json({ message: "Choose a valid category icon." });
    if (!colorKey) return res.status(400).json({ message: "Choose a valid category color." });
    const id = createCommunityCategoryId();
    const inserted = await pool.query(
      `INSERT INTO community_stock_categories (guild_id, id, name, is_periodic, icon_name, color_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, is_periodic, icon_name, color_key, created_at, updated_at`,
      [config.guildId, id, name, isPeriodic, iconName, colorKey]
    );
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ message: "A category with this name already exists." });
    next(error);
  }
});

app.patch("/api/community/categories/:categoryId", requireSession, async (req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before updating a category." });
    const categoryId = parseCommunityCategoryId(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ message: "Choose a valid category." });
    const name = String(req.body?.name ?? "").trim();
    const isPeriodic = req.body?.isPeriodic === true;
    const iconName = parseCommunityCategoryIconName(req.body?.iconName);
    const colorKey = parseCommunityCategoryColorKey(req.body?.colorKey);
    if (!name || name.length > 60) {
      return res.status(400).json({ message: "Enter a category name with up to 60 characters." });
    }
    if (!iconName) return res.status(400).json({ message: "Choose a valid category icon." });
    if (!colorKey) return res.status(400).json({ message: "Choose a valid category color." });
    const updated = await pool.query(
      `UPDATE community_stock_categories
       SET name = $3, is_periodic = $4, icon_name = $5, color_key = $6, updated_at = NOW()
       WHERE guild_id = $1 AND id = $2
       RETURNING id, name, is_periodic, icon_name, color_key, created_at, updated_at`,
      [config.guildId, categoryId, name, isPeriodic, iconName, colorKey]
    );
    if (!updated.rowCount) return res.status(404).json({ message: "Category not found." });
    res.json(updated.rows[0]);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ message: "A category with this name already exists." });
    next(error);
  }
});

app.delete("/api/community/categories/:categoryId", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before deleting a category." });
    const categoryId = parseCommunityCategoryId(req.params.categoryId);
    if (!categoryId) return res.status(400).json({ message: "Choose a valid category." });
    await client.query("BEGIN");
    const stock = await client.query(
      "SELECT COUNT(*)::int AS count FROM community_oauth_joins WHERE guild_id = $1 AND stock_type = $2",
      [config.guildId, categoryId]
    );
    if (Number(stock.rows[0]?.count ?? 0) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Remove or move this category's stock before deleting it." });
    }
    const removed = await client.query(
      "DELETE FROM community_stock_categories WHERE guild_id = $1 AND id = $2 RETURNING id",
      [config.guildId, categoryId]
    );
    await client.query("COMMIT");
    if (!removed.rowCount) return res.status(404).json({ message: "Category not found." });
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.post("/api/community/import-oauth-stock", requireSession, async (req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "Configure the Members bot before importing OAuth stock." });
    }

    const records = Array.isArray(req.body) ? req.body : req.body?.records;
    const requestedCategoryId = Array.isArray(req.body) ? "offline" : (req.body?.categoryId ?? req.body?.stockType);
    const stockType = normalizeCommunityStockType(requestedCategoryId);
    const category = await pool.query(
      "SELECT id, name FROM community_stock_categories WHERE guild_id = $1 AND id = $2 LIMIT 1",
      [config.guildId, stockType]
    );
    if (!category.rowCount || String(requestedCategoryId ?? "").trim().toLowerCase() !== stockType) {
      return res.status(400).json({ message: "Choose a valid Members Stock category before importing." });
    }
    if (!Array.isArray(records) || !records.length || records.length > 250) {
      return res.status(400).json({ message: "Each import batch must contain between 1 and 250 OAuth records." });
    }

    const result = { total: records.length, imported: 0, failed: 0, skipped: 0, errors: [] };
    const seenSourceUserIds = new Set();
    const seenDiscordUserIds = new Set();
    const positionResult = await pool.query(
      "SELECT COALESCE(MAX(sort_position), 0)::bigint AS maximum FROM community_oauth_joins WHERE guild_id = $1 AND stock_type = $2",
      [config.guildId, stockType]
    );
    let nextSortPosition = Number(positionResult.rows[0]?.maximum ?? 0) + 1024;

    await forEachWithConcurrency(records, 4, async (record, index) => {
      const sourceUserId = String(record?.user_id ?? record?.userId ?? "").trim();
      const accessToken = String(record?.access_token ?? record?.accessToken ?? "").trim();
      const accessTokenExpiresAt = parseCommunityAccessTokenExpiry(record);
      const recordLabel = isDiscordGuildId(sourceUserId) ? sourceUserId : `row ${index + 1}`;

      if (!isDiscordGuildId(sourceUserId) || accessToken.length < 20 || accessToken.length > 4096 || !accessTokenExpiresAt) {
        result.failed += 1;
        if (result.errors.length < 25) result.errors.push({ record: recordLabel, message: "A valid user_id, access_token, authed_timestamp and expires_in are required." });
        return;
      }
      if (accessTokenExpiresAt.getTime() <= Date.now()) {
        result.failed += 1;
        if (result.errors.length < 25) result.errors.push({ record: recordLabel, message: "The OAuth access token has expired. Export the stock again before importing it." });
        return;
      }
      if (seenSourceUserIds.has(sourceUserId)) {
        result.skipped += 1;
        return;
      }
      seenSourceUserIds.add(sourceUserId);
      const sortPosition = nextSortPosition;
      nextSortPosition += 1024;

      try {
        let oauthIdentity = await requestDiscord("oauth2/@me", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (oauthIdentity.response.status === 429) {
          const retrySeconds = Math.min(Math.max(Number(oauthIdentity.payload?.retry_after) || 1, 1), 5);
          await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
          oauthIdentity = await requestDiscord("oauth2/@me", {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
        }
        if (oauthIdentity.response.status === 429) throw new Error("Discord is rate limiting OAuth checks. Import this record again shortly.");
        if (!oauthIdentity.response.ok) throw new Error("The OAuth access token is expired or invalid. Export the stock again before importing it.");
        const verifiedUserId = String(oauthIdentity.payload?.user?.id ?? "").trim();
        const applicationId = String(oauthIdentity.payload?.application?.id ?? "").trim();
        const scopes = Array.isArray(oauthIdentity.payload?.scopes) ? oauthIdentity.payload.scopes.map(String) : [];
        if (verifiedUserId !== sourceUserId) throw new Error("The OAuth access token belongs to a different Discord user.");
        if (applicationId && applicationId !== config.clientId) throw new Error("The OAuth record belongs to a different Discord application.");
        if (!scopes.includes("guilds.join")) throw new Error("The OAuth record does not include the guilds.join permission.");
        const oauthUser = oauthIdentity.payload.user;
        const details = `Imported with a non-refreshing OAuth access token valid until ${accessTokenExpiresAt.toISOString()}.`;
        const discordUserId = sourceUserId;
        const duplicateDiscordUser = seenDiscordUserIds.has(discordUserId);
        seenDiscordUserIds.add(discordUserId);

        const username = String(oauthUser?.global_name ?? oauthUser?.username ?? `Discord user ${discordUserId}`).slice(0, 100);
        const avatarHash = String(oauthUser?.avatar ?? "").trim();
        const avatarUrl = avatarHash
          ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordUserId)}/${encodeURIComponent(avatarHash)}.png?size=128`
          : null;
        await pool.query(
          `INSERT INTO community_oauth_joins
             (discord_user_id, guild_id, username, avatar_url, encrypted_refresh_token, encrypted_access_token, access_token_expires_at, status, stock_type, details, authorized_at, joined_at, reserved_order_id, sort_position)
           VALUES ($1, $2, $3, $4, NULL, $5, $6, 'authorized', $7, $8, NOW(), NULL, NULL, $9)
           ON CONFLICT (discord_user_id, guild_id) DO UPDATE SET
             username = EXCLUDED.username,
             avatar_url = EXCLUDED.avatar_url,
             encrypted_refresh_token = NULL,
             encrypted_access_token = EXCLUDED.encrypted_access_token,
             access_token_expires_at = EXCLUDED.access_token_expires_at,
             status = 'authorized',
             stock_type = EXCLUDED.stock_type,
             details = EXCLUDED.details,
             authorized_at = NOW(),
             joined_at = NULL,
             reserved_order_id = NULL,
             sort_position = CASE
               WHEN community_oauth_joins.stock_type <> EXCLUDED.stock_type THEN EXCLUDED.sort_position
               ELSE community_oauth_joins.sort_position
             END`,
          [discordUserId, config.guildId, username, avatarUrl, encryptCredential(accessToken), accessTokenExpiresAt, stockType, details, sortPosition]
        );
        if (duplicateDiscordUser) result.skipped += 1;
        else result.imported += 1;
      } catch (error) {
        result.failed += 1;
        if (result.errors.length < 25) {
          result.errors.push({ record: recordLabel, message: error instanceof Error ? error.message : "OAuth record could not be imported." });
        }
      }
    });

    res.json({ ...result, stockType, categoryId: stockType, categoryName: category.rows[0].name });
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/export-oauth-stock", requireSession, async (req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "Configure the Members bot before exporting OAuth stock." });
    }

    const requestedCategoryId = req.query?.categoryId ?? req.query?.stockType;
    const stockType = normalizeCommunityStockType(requestedCategoryId);
    const category = await pool.query(
      "SELECT id FROM community_stock_categories WHERE guild_id = $1 AND id = $2 LIMIT 1",
      [config.guildId, stockType]
    );
    if (!category.rowCount || String(requestedCategoryId ?? "").trim().toLowerCase() !== stockType) {
      return res.status(400).json({ message: "Choose a valid Members Stock category before exporting." });
    }

    const result = await pool.query(
      `SELECT discord_user_id, encrypted_access_token, access_token_expires_at, authorized_at
       FROM community_oauth_joins
       WHERE guild_id = $1 AND stock_type = $2 AND encrypted_access_token IS NOT NULL
       ORDER BY CASE WHEN status = 'failed' THEN 1 ELSE 0 END ASC, sort_position ASC, authorized_at ASC`,
      [config.guildId, stockType]
    );
    const records = result.rows.map((row) => {
      const authorizedAtSeconds = Math.floor(new Date(row.authorized_at).getTime() / 1000);
      const expiresAtSeconds = Math.floor(new Date(row.access_token_expires_at).getTime() / 1000);
      return {
        user_id: row.discord_user_id,
        access_token: decryptCredential(row.encrypted_access_token),
        authed_timestamp: authorizedAtSeconds,
        expires_in: Math.max(0, expiresAtSeconds - authorizedAtSeconds)
      };
    });

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache"
    }).json(records);
  } catch (error) {
    next(error);
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
        categories: {},
        stockCategories: [],
        recent: []
      });
    }

    await ensureCommunityStockCategories(config);
    await normalizeCommunityStockRecords(config);
    const [bot, guild, summary, stockCategories, recentResult] = await Promise.all([
      loadCommunityBotSafe(config),
      loadCommunityGuildSafe(config),
      loadCommunityJoinSummary(config),
      loadCommunityStockCategories(config),
      pool.query(
        `SELECT discord_user_id, username, avatar_url, status, stock_type, details, authorized_at, joined_at, reserved_order_id, sort_position
         FROM community_oauth_joins
         WHERE guild_id = $1
         ORDER BY stock_type ASC,
                  CASE WHEN status = 'failed' THEN 1 ELSE 0 END ASC,
                  sort_position ASC,
                  authorized_at ASC`,
        [config.guildId]
      )
    ]);
    res.set("Cache-Control", "no-store").json({
      configured: true,
      bot,
      guild,
      ...summary,
      stockCategories,
      recent: recentResult.rows.map((row) => ({
        id: row.discord_user_id,
        username: row.username,
        avatarUrl: row.avatar_url,
        status: row.status,
        stockType: normalizeCommunityStockType(row.stock_type),
        details: row.details,
        reservedOrderId: row.reserved_order_id,
        sortPosition: Number(row.sort_position),
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
      `SELECT username, reserved_order_id
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
    await client.query(
      "DELETE FROM community_oauth_joins WHERE discord_user_id = $1 AND guild_id = $2",
      [discordUserId, config.guildId]
    );
    await client.query("COMMIT");
    res.json({ removed: true, username: member.rows[0].username, revoked: false });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.post("/api/community/members/bulk-delete", requireSession, async (req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before managing Members Stock." });
    const ids = Array.from(new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map((value) => String(value ?? "").trim())
      .filter(isDiscordGuildId)));
    if (!ids.length || ids.length > 5_000) return res.status(400).json({ message: "Select between 1 and 5,000 members." });

    const removed = await pool.query(
      `DELETE FROM community_oauth_joins
       WHERE guild_id = $1 AND discord_user_id = ANY($2::text[]) AND reserved_order_id IS NULL
       RETURNING discord_user_id`,
      [config.guildId, ids]
    );
    res.json({ removed: removed.rowCount, skippedReserved: Math.max(0, ids.length - removed.rowCount) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/members/reorder", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before managing Members Stock." });
    const categoryId = parseCommunityCategoryId(req.body?.categoryId);
    const direction = String(req.body?.direction ?? "").trim().toLowerCase();
    const ids = Array.from(new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map((value) => String(value ?? "").trim())
      .filter(isDiscordGuildId)));
    if (!categoryId || !["top", "up", "down", "bottom"].includes(direction) || !ids.length || ids.length > 5_000) {
      return res.status(400).json({ message: "Choose members and a valid priority action." });
    }

    await client.query("BEGIN");
    const rows = await client.query(
      `SELECT discord_user_id
       FROM community_oauth_joins
       WHERE guild_id = $1 AND stock_type = $2
       ORDER BY CASE WHEN status = 'failed' THEN 1 ELSE 0 END ASC,
                sort_position ASC,
                authorized_at ASC,
                discord_user_id ASC
       FOR UPDATE`,
      [config.guildId, categoryId]
    );
    const currentIds = rows.rows.map((row) => String(row.discord_user_id));
    const currentIdSet = new Set(currentIds);
    const selected = new Set(ids.filter((id) => currentIdSet.has(id)));
    if (!selected.size) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "The selected members are no longer in this category." });
    }

    let orderedIds = [...currentIds];
    if (direction === "top") orderedIds = [...orderedIds.filter((id) => selected.has(id)), ...orderedIds.filter((id) => !selected.has(id))];
    if (direction === "bottom") orderedIds = [...orderedIds.filter((id) => !selected.has(id)), ...orderedIds.filter((id) => selected.has(id))];
    if (direction === "up") {
      for (let index = 1; index < orderedIds.length; index += 1) {
        if (selected.has(orderedIds[index]) && !selected.has(orderedIds[index - 1])) {
          [orderedIds[index - 1], orderedIds[index]] = [orderedIds[index], orderedIds[index - 1]];
        }
      }
    }
    if (direction === "down") {
      for (let index = orderedIds.length - 2; index >= 0; index -= 1) {
        if (selected.has(orderedIds[index]) && !selected.has(orderedIds[index + 1])) {
          [orderedIds[index], orderedIds[index + 1]] = [orderedIds[index + 1], orderedIds[index]];
        }
      }
    }

    await client.query(
      `UPDATE community_oauth_joins AS stock
       SET sort_position = ordered.position * 1024
       FROM unnest($3::text[]) WITH ORDINALITY AS ordered(discord_user_id, position)
       WHERE stock.guild_id = $1 AND stock.stock_type = $2 AND stock.discord_user_id = ordered.discord_user_id`,
      [config.guildId, categoryId, orderedIds]
    );
    await client.query("COMMIT");
    res.json({ moved: selected.size, direction });
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
    permissions: "35",
    guild_id: guildId,
    disable_guild_select: "true"
  });
  return `https://discord.com/oauth2/authorize?${query.toString()}`;
}

function createCommunityBotGuildAccessError(status, context = {}) {
  const discordStatus = Number(status);
  const message = context.tokenVerified === true
    ? "To continue delivery, please add the bot to your Discord server."
    : discordStatus === 401
    ? "Discord rejected the saved Members bot token. Update it in Settings."
    : discordStatus === 403
      ? "The Members bot cannot access the target server. Check its role and permissions."
      : discordStatus === 404
        ? "The Members bot is not detected in the target server yet."
        : `Discord could not verify the Members bot in the target server (${discordStatus || "unknown"}).`;
  const error = new Error(message);
  error.statusCode = discordStatus >= 500 || !discordStatus ? 502 : 409;
  error.waitingCode = `discord_${discordStatus || "unknown"}`;
  return error;
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
  let targetGuildAccess = null;
  if (serverInfo.guildId !== config.guildId) {
    const invitedGuildAccess = await checkCommunityBotGuildAccess(config, serverInfo.guildId);
    targetGuildAccess = invitedGuildAccess;
    const botInInvitedGuild = invitedGuildAccess.accessible;

    if (allowWaitingForBot && !botInInvitedGuild) {
      const waitingConfig = normalizeCommunityOAuthConfig({ ...config, guildId: serverInfo.guildId });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await copyCommunityStockForGuild(client, config.guildId, waitingConfig.guildId);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return {
        config: waitingConfig,
        invite,
        serverInfo,
        waitingForBot: true,
        botInvite: createCommunityBotInvite(config, serverInfo.guildId)
      };
    }

    if (!botInInvitedGuild) {
      throw createCommunityBotGuildAccessError(invitedGuildAccess.status, {
        guildId: serverInfo.guildId,
        tokenVerified: invitedGuildAccess.tokenVerified
      });
    }

    const nextConfig = normalizeCommunityOAuthConfig({ ...config, guildId: serverInfo.guildId });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Keep a server-specific stock view so active orders on other servers can
      // continue without their reservations being moved underneath them.
      await copyCommunityStockForGuild(client, config.guildId, nextConfig.guildId);
      await client.query(
        `INSERT INTO app_settings (setting_key, encrypted_value, updated_at)
         VALUES ('community_oauth_config', $1, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
        [encryptCredential(JSON.stringify({
          clientId: nextConfig.clientId,
          clientSecret: nextConfig.clientSecret,
          botToken: nextConfig.botToken,
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
  } else {
    const configuredGuildAccess = await checkCommunityBotGuildAccess(config, serverInfo.guildId);
    targetGuildAccess = configuredGuildAccess;
    if (!configuredGuildAccess.accessible) {
      if (allowWaitingForBot) {
        return {
          config,
          invite,
          serverInfo,
          waitingForBot: true,
          botInvite: createCommunityBotInvite(config, serverInfo.guildId)
        };
      }
      throw createCommunityBotGuildAccessError(configuredGuildAccess.status, {
        guildId: serverInfo.guildId,
        tokenVerified: configuredGuildAccess.tokenVerified
      });
    }
  }
  if (isCommunityGuildInvitesRestricted(targetGuildAccess?.payload)) {
    return {
      config,
      invite,
      serverInfo,
      invitesPaused: true,
      waitingCode: "discord_guild_invites_limited",
      waitingDetails: "Discord has temporarily limited new member access for this server. Check the server restriction before restarting delivery.",
      botInvite: createCommunityBotInvite(config, serverInfo.guildId)
    };
  }
  await ensureCommunityApplyToJoin(config, serverInfo.guildId);
  await loadCommunityGuild(config);
  return { config, invite, serverInfo };
}

app.get("/api/community/availability", requireSession, async (req, res, next) => {
  try {
    const { config, serverInfo } = await resolveConfiguredCommunityInvite(req.query?.invite, { allowWaitingForBot: true });
    const service = String(req.query?.service ?? "COMMUNITY-OFFLINE");
    if (!isCommunityServiceType(service)) return res.status(400).json({ message: "Choose a valid Members 2 mode." });
    const requestedCategoryId = req.query?.categoryId ?? getCommunityStockTypeFromService(service);
    const stockType = normalizeCommunityStockType(requestedCategoryId);
    const category = await pool.query(
      "SELECT id FROM community_stock_categories WHERE guild_id = $1 AND id = $2 LIMIT 1",
      [config.guildId, stockType]
    );
    if (!category.rowCount || String(requestedCategoryId ?? "").trim().toLowerCase() !== stockType) {
      return res.status(400).json({ message: "Choose a valid Members 2 category." });
    }
    await markCommunityFailedDeliveriesInactive(pool, config.guildId);
    const previouslyDeliveredUserIds = await loadCommunityPreviouslyDeliveredUserIds(pool, serverInfo.guildId);
    const result = await pool.query(
      `SELECT COUNT(*)::int AS available
       FROM community_oauth_joins
       WHERE guild_id = $1 AND stock_type = $2 AND status = 'authorized' AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()
         AND NOT (discord_user_id = ANY($3::text[]))`,
      [config.guildId, stockType, previouslyDeliveredUserIds]
    );
    const available = Number(result.rows[0]?.available ?? 0);
    res.set("Cache-Control", "no-store").json({ available, maximum: available });
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders", requireSession, async (req, res, next) => {
  let client = null;
  try {
    const amount = Number.parseInt(req.body?.amount, 10);
    const delay = Number.parseInt(req.body?.delay, 10);
    const speedProfile = normalizeCommunitySpeedProfile(req.body?.speedProfile);
    const service = String(req.body?.service ?? "");
    if (!isCommunityServiceType(service) || !Number.isInteger(amount) || amount <= 0 || !Number.isInteger(delay) || delay < 1 || delay > 1200) {
      return res.status(400).json({ message: "A valid Members 2 mode, member amount and delay are required." });
    }
    const { config, serverInfo, waitingForBot, invitesPaused, waitingDetails, waitingCode, botInvite, invite } = await resolveConfiguredCommunityInvite(req.body?.id, { allowWaitingForBot: true });
    const requestedCategoryId = req.body?.categoryId ?? getCommunityStockTypeFromService(service);
    const stockType = normalizeCommunityStockType(requestedCategoryId);
    const categoryResult = await pool.query(
      `SELECT id, name, is_periodic
       FROM community_stock_categories
       WHERE guild_id = $1 AND id = $2
       LIMIT 1`,
      [config.guildId, stockType]
    );
    if (!categoryResult.rowCount || String(requestedCategoryId ?? "").trim().toLowerCase() !== stockType) {
      return res.status(400).json({ message: "Choose a valid Members 2 category." });
    }
    const category = categoryResult.rows[0];
    const durationMonths = category.is_periodic === true ? Number.parseInt(req.body?.durationMonths, 10) : null;
    if (category.is_periodic === true && (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 6)) {
      return res.status(400).json({ message: "Choose an order duration between 1 and 6 months." });
    }
    const memberVerification = await checkCommunityMemberVerification(config, serverInfo.guildId, invite);
    if (memberVerification.status === "open" && !experimentalCommunityJoinEnabled) {
      return res.status(409).json({ message: "This server has a Discord membership screening form enabled. Disable it before creating a Members 2 order." });
    }

    const uniqid = createCommunityOrderId();
    client = await pool.connect();
    await client.query("BEGIN");
    await markCommunityFailedDeliveriesInactive(client, config.guildId);
    const previouslyDeliveredUserIds = await loadCommunityPreviouslyDeliveredUserIds(client, serverInfo.guildId);
    const selected = await client.query(
       `SELECT discord_user_id, username, avatar_url, encrypted_access_token, access_token_expires_at
       FROM community_oauth_joins
       WHERE guild_id = $1 AND stock_type = $2 AND status = 'authorized' AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW() AND reserved_order_id IS NULL
         AND NOT (discord_user_id = ANY($4::text[]))
       ORDER BY sort_position ASC, authorized_at ASC
       LIMIT $3
       FOR UPDATE SKIP LOCKED`,
      [config.guildId, stockType, amount, previouslyDeliveredUserIds]
    );
    if (selected.rowCount < amount) {
      const used = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM community_oauth_joins
         WHERE guild_id = $1 AND stock_type = $2 AND discord_user_id = ANY($3::text[])`,
        [config.guildId, stockType, previouslyDeliveredUserIds]
      );
      await client.query("ROLLBACK");
      const usedCount = Number(used.rows[0]?.count ?? 0);
      const usedNotice = usedCount > 0
        ? ` ${usedCount} stock member(s) were already used for this server; deleting an order does not remove them from Discord or restore them for the same server.`
        : "";
      return res.status(409).json({ message: `Only ${selected.rowCount} ${stockType} members are currently available.${usedNotice}` });
    }
    await client.query(
      "UPDATE community_oauth_joins SET reserved_order_id = $1 WHERE guild_id = $2 AND discord_user_id = ANY($3::text[])",
      [uniqid, config.guildId, selected.rows.map((row) => row.discord_user_id)]
    );
    const createdAt = new Date();
    const order = {
      uniqid,
      provider: "community",
      service,
      stockType,
      categoryId: category.id,
      categoryName: category.name,
      categoryIsPeriodic: category.is_periodic === true,
      durationMonths,
      serverId: serverInfo.guildId,
      serverName: serverInfo.guildName,
      serverInvite: String(req.body?.id ?? "").trim(),
      serverMemberCount: serverInfo.approximateMemberCount,
      amount,
      added: 0,
      delay,
      speedProfile,
      createdAt: createdAt.toISOString(),
      expiredAt: category.is_periodic === true ? addUtcMonths(createdAt, durationMonths).toISOString() : null,
      status: invitesPaused ? "INVITES PAUSED" : waitingForBot ? "WAITING" : "PROCESS",
      waitingCode: invitesPaused ? "discord_guild_invites_limited" : waitingForBot ? (waitingCode ?? "discord_missing") : null,
      details: waitingForBot || invitesPaused ? (waitingDetails ?? "Add the Members bot to this server to start delivery.") : `0/${amount} members delivered.`,
      experimentalJoin: experimentalCommunityJoinEnabled,
      botApplicationId: config.clientId,
      botInvite,
      communityResults: selected.rows.map((row) => ({ discordUserId: row.discord_user_id, username: row.username, avatarUrl: row.avatar_url ?? null, state: "queued", details: "Waiting for delivery." }))
    };
    await client.query(
      `INSERT INTO tracked_orders (uniqid, payload, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())`,
      [uniqid, JSON.stringify(order)]
    );
    await client.query("COMMIT");
    if (!waitingForBot && !invitesPaused) {
      void processCommunityOrder(order, selected.rows, config).catch(async (error) => {
        console.error("Members order failed:", error instanceof Error ? error.message : error);
        await pool.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id = $1", [uniqid]).catch(() => {});
        await saveTrackedOrderPayload({ ...order, status: "ERROR", details: error instanceof Error ? error.message : "Members order failed." }).catch(() => {});
      });
    }
    res.json({
      uniqid,
      bot_invite: botInvite,
      categoryId: order.categoryId,
      categoryName: order.categoryName,
      categoryIsPeriodic: order.categoryIsPeriodic,
      durationMonths: order.durationMonths,
      createdAt: order.createdAt,
      expiredAt: order.expiredAt
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client?.release();
  }
});

async function activateWaitingCommunityOrder(order) {
  if (!order || order.provider !== "community") return order;

  const legacyStoppedMessage = "Delivery stopped after Discord rejected the bot's member-add access.";
  const isLegacyInterruptedOrder = ["ERROR", "PARTIAL"].includes(String(order.status ?? "").toUpperCase())
    && Array.isArray(order.communityResults)
    && order.communityResults.some((item) => String(item?.details ?? "") === legacyStoppedMessage);
  const isInventoryRecoveryError = String(order.status ?? "").toUpperCase() === "ERROR"
    && /^Only \d+ .+ members are available\.$/i.test(String(order.details ?? ""))
    && Array.isArray(order.communityResults)
    && order.communityResults.some((item) => ["queued", "joining"].includes(String(item?.state ?? "").toLowerCase()));
  if (isLegacyInterruptedOrder || isInventoryRecoveryError) {
    const revivedOrder = {
      ...order,
      status: "WAITING",
      waitingCode: isInventoryRecoveryError ? "inventory_recovery_retry" : "legacy_delivery_retry",
      details: "Retrying the unfinished Members delivery.",
      communityResults: isLegacyInterruptedOrder
        ? order.communityResults.map((item) => String(item?.details ?? "") === legacyStoppedMessage
          ? { ...item, state: "queued", details: "Waiting for delivery." }
          : item)
        : order.communityResults
    };
    const revived = await pool.query(
      `UPDATE tracked_orders
       SET payload = $2::jsonb, updated_at = NOW()
       WHERE uniqid = $1 AND payload->>'status' IN ('ERROR', 'PARTIAL')
       RETURNING payload`,
      [order.uniqid, JSON.stringify(revivedOrder)]
    );
    if (revived.rowCount) order = revived.rows[0].payload;
    else {
      const latest = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [order.uniqid]);
      order = latest.rows[0]?.payload ?? order;
    }
  }
  const activationStatus = String(order.status ?? "").toUpperCase();
  if (!["WAITING", "RECOVERING"].includes(activationStatus)) return order;

  const latestConfig = await getCommunityOAuthConfig();
  const targetGuildId = String(order.serverId ?? "").trim();
  if (latestConfig.configured && isDiscordGuildId(targetGuildId)) {
    const currentBotInvite = createCommunityBotInvite(latestConfig, targetGuildId);
    if (order.botInvite !== currentBotInvite || order.botApplicationId !== latestConfig.clientId) {
      order = {
        ...order,
        botInvite: currentBotInvite,
        botApplicationId: latestConfig.clientId,
        details: order.waitingCode === "discord_permissions"
          ? order.details
          : "Checking the currently configured Members bot in the target server."
      };
      const refreshed = await pool.query(
        `UPDATE tracked_orders
         SET payload = $2::jsonb, updated_at = NOW()
         WHERE uniqid = $1 AND payload->>'status' IN ('WAITING', 'RECOVERING')
         RETURNING payload`,
        [order.uniqid, JSON.stringify(order)]
      );
      if (!refreshed.rowCount) {
        const latest = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [order.uniqid]);
        return latest.rows[0]?.payload ?? order;
      }
    }
  }

  const lastCheckAt = activateWaitingCommunityOrder.lastChecks?.get(order.uniqid) ?? 0;
  if (Date.now() - lastCheckAt < 5_000) return order;
  if (!activateWaitingCommunityOrder.lastChecks) activateWaitingCommunityOrder.lastChecks = new Map();
  activateWaitingCommunityOrder.lastChecks.set(order.uniqid, Date.now());

  let resolved = null;
  let storedGuildAccess = null;
  const waitingCode = String(order.waitingCode ?? "");
  const targetConfig = normalizeCommunityOAuthConfig({ ...latestConfig, guildId: targetGuildId });
  const shouldUseStoredGuildRecovery = targetConfig.configured && (
    activationStatus === "RECOVERING"
    || ["server_restart_resume", "inventory_recovery_retry", "restriction_check"].includes(String(order.waitingCode ?? ""))
    || ["discord_403", "discord_404", "discord_unknown", "discord_missing"].includes(waitingCode)
  );
  if (shouldUseStoredGuildRecovery) {
    const attempts = activationStatus === "RECOVERING" ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const access = await checkCommunityBotDirectGuildAccess(targetConfig, targetGuildId).catch(() => null);
      storedGuildAccess = access;
      if (access?.accessible) {
        resolved = {
          config: targetConfig,
          invite: extractDiscordInviteCode(order.serverInvite),
          serverInfo: {
            guildId: targetGuildId,
            guildName: String(access.payload?.name ?? order.serverName ?? "Discord server"),
            approximateMemberCount: Number.isFinite(access.payload?.approximate_member_count)
              ? access.payload.approximate_member_count
              : Number.isFinite(access.payload?.member_count) ? access.payload.member_count : order.serverMemberCount
          },
          ...(isCommunityGuildInvitesRestricted(access.payload) ? {
            invitesPaused: true,
            waitingCode: "discord_guild_invites_limited",
            waitingDetails: "Discord has temporarily limited new member access for this server. Check the server restriction before restarting delivery."
          } : {})
        };
        break;
      }
      if (access?.status === 401) break;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!resolved && shouldUseStoredGuildRecovery) {
    const status = Number(storedGuildAccess?.status) || 0;
    const botUnavailable = [401, 403, 404].includes(status);
    const waitingOrder = {
      ...order,
      status: botUnavailable ? "WAITING" : "RECOVERING",
      waitingCode: `discord_${status || "unknown"}`,
      details: status === 401
        ? "Discord rejected the configured Members bot token. Update the bot settings to continue delivery."
        : [403, 404].includes(status)
          ? "The Members bot is not available in the target server yet. Add it to continue delivery."
          : "Discord is temporarily unavailable while checking this server. The check will retry automatically."
    };
    if (waitingOrder.status !== order.status || waitingOrder.details !== order.details || waitingOrder.waitingCode !== order.waitingCode) {
      await saveTrackedOrderPayload(waitingOrder);
    }
    return waitingOrder;
  }
  try {
    resolved ??= await resolveConfiguredCommunityInvite(order.serverInvite);
  } catch (error) {
    if (error?.statusCode === 409) {
      const waitingOrder = {
        ...order,
        details: error instanceof Error ? error.message : "The Members bot is not ready in the target server.",
        waitingCode: error?.waitingCode ?? "order_blocked"
      };
      if (waitingOrder.details !== order.details || waitingOrder.waitingCode !== order.waitingCode) {
        await saveTrackedOrderPayload(waitingOrder);
      }
      return waitingOrder;
    }
    throw error;
  }

  if (resolved.invitesPaused) {
    const invitesPausedOrder = {
      ...order,
      status: "INVITES PAUSED",
      waitingCode: "discord_guild_invites_limited",
      details: resolved.waitingDetails ?? "Discord has temporarily limited new member access for this server."
    };
    const paused = await pool.query(
      `UPDATE tracked_orders
       SET payload = $2::jsonb, updated_at = NOW()
       WHERE uniqid = $1 AND payload->>'status' IN ('WAITING', 'RECOVERING')
       RETURNING payload`,
      [order.uniqid, JSON.stringify(invitesPausedOrder)]
    );
    return paused.rows[0]?.payload ?? invitesPausedOrder;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [order.uniqid]);
    const current = locked.rows[0]?.payload;
    if (!current || current.provider !== "community" || !["WAITING", "RECOVERING"].includes(String(current.status).toUpperCase())) {
      await client.query("COMMIT");
      return current ?? order;
    }

    const pendingStates = new Set(["queued", "joining", "replacing"]);
    const existingResults = Array.isArray(current.communityResults) ? current.communityResults : [];
    const pendingResultCount = existingResults.filter((item) => pendingStates.has(String(item?.state ?? "").toLowerCase())).length;
    const remainingAmount = existingResults.length
      ? pendingResultCount
      : Math.max(0, Number(current.amount) - Number(current.added ?? 0));

    let members = (await client.query(
      `SELECT discord_user_id, username, avatar_url, encrypted_access_token, access_token_expires_at
       FROM community_oauth_joins
        WHERE guild_id = $1 AND reserved_order_id = $2 AND stock_type = $3 AND status = 'authorized' AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()
       ORDER BY sort_position ASC, authorized_at ASC
       FOR UPDATE`,
      [resolved.config.guildId, current.uniqid, getCommunityOrderStockType(current)]
    )).rows;

    const usedDiscordUserIds = Array.isArray(current.communityResults)
      ? current.communityResults
          .filter((item) => ["joined", "pending_join"].includes(String(item?.state ?? "").toLowerCase()))
          .map((item) => String(item?.discordUserId ?? ""))
          .filter(isDiscordGuildId)
      : [];
    const missing = Math.max(0, remainingAmount - members.length);
    if (missing > 0) {
      const previouslyDeliveredUserIds = await loadCommunityDeliveredUsersStillPresent(client, resolved.config, resolved.config.guildId);
      const excludedUserIds = Array.from(new Set([...usedDiscordUserIds, ...previouslyDeliveredUserIds]));
      const extra = await client.query(
        `SELECT discord_user_id, username, avatar_url, encrypted_access_token, access_token_expires_at
         FROM community_oauth_joins
         WHERE guild_id = $1 AND stock_type = $2 AND reserved_order_id IS NULL AND status = 'authorized' AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()
           AND NOT (discord_user_id = ANY($4::text[]))
         ORDER BY sort_position ASC, authorized_at ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [resolved.config.guildId, getCommunityOrderStockType(current), missing, excludedUserIds]
      );
      if (extra.rowCount) {
        await client.query(
          "UPDATE community_oauth_joins SET reserved_order_id = $1 WHERE guild_id = $2 AND discord_user_id = ANY($3::text[])",
          [current.uniqid, resolved.config.guildId, extra.rows.map((row) => row.discord_user_id)]
        );
        members = [...members, ...extra.rows];
      }
    }

    const existingByUserId = new Map(existingResults.map((item) => [String(item?.discordUserId ?? ""), item]));
    const availableUserIds = new Set(members.map((member) => String(member.discord_user_id)));
    const unavailablePendingResults = existingResults
      .filter((item) => pendingStates.has(String(item?.state ?? "").toLowerCase()) && !availableUserIds.has(String(item?.discordUserId ?? "")))
      .slice(0, Math.max(0, remainingAmount - members.length))
      .map((item) => ({
        ...item,
        state: "failed",
        details: "This member was no longer available when delivery resumed.",
        completedAt: new Date().toISOString()
      }));
    const settledResults = [
      ...existingResults.filter((item) => !pendingStates.has(String(item?.state ?? "").toLowerCase())),
      ...unavailablePendingResults
    ];
    const pendingResults = members.map((member) => {
      const existing = existingByUserId.get(String(member.discord_user_id));
      return existing && pendingStates.has(String(existing?.state ?? "").toLowerCase())
        ? { ...existing, state: "queued", details: "Waiting for delivery." }
        : { discordUserId: member.discord_user_id, username: member.username, avatarUrl: member.avatar_url ?? null, state: "queued", details: "Waiting for delivery." };
    });
    const activeOrder = {
      ...current,
      status: "PROCESS",
      waitingCode: null,
      details: `${Number(current.added ?? 0)}/${current.amount} members delivered.`,
      serverId: resolved.serverInfo.guildId,
      serverName: resolved.serverInfo.guildName,
      serverMemberCount: resolved.serverInfo.approximateMemberCount,
      communityResults: [...settledResults, ...pendingResults]
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

let communityRecoveryRunning = false;

async function recoverInterruptedCommunityOrders() {
  if (communityRecoveryRunning) return;
  communityRecoveryRunning = true;
  try {
    const interrupted = await pool.query(
      `SELECT payload
       FROM tracked_orders
       WHERE payload->>'provider' = 'community'
         AND UPPER(payload->>'status') = 'PROCESS'
         AND updated_at < NOW() - INTERVAL '5 seconds'
       ORDER BY updated_at ASC`
    );

    for (const row of interrupted.rows) {
      const order = row.payload;
      if (!order?.uniqid) continue;
      const resumable = {
        ...order,
        status: "RECOVERING",
        waitingCode: "server_restart_resume",
        details: "Resuming delivery after the service restart."
      };
      const claimed = await pool.query(
        `UPDATE tracked_orders
         SET payload = $2::jsonb, updated_at = NOW()
         WHERE uniqid = $1
           AND payload->>'provider' = 'community'
           AND UPPER(payload->>'status') = 'PROCESS'
           AND updated_at < NOW() - INTERVAL '5 seconds'
         RETURNING payload`,
        [order.uniqid, JSON.stringify(resumable)]
      );
      if (!claimed.rowCount) continue;

      try {
        await activateWaitingCommunityOrder(claimed.rows[0].payload);
        console.log(`Resumed interrupted Members order ${order.uniqid}.`);
      } catch (error) {
        console.error(`Could not resume Members order ${order.uniqid}:`, error instanceof Error ? error.message : error);
      }
    }
  } finally {
    communityRecoveryRunning = false;
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
  return hydrated;
}

async function reconcileCommunityPendingJoinResults(order) {
  if (!order || order.provider !== "community" || String(order.status ?? "").toUpperCase() === "CANCELLED" || !Array.isArray(order.communityResults) || !order.serverId) return order;
  const candidates = order.communityResults.filter((item) =>
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && isDiscordGuildId(String(item.discordUserId ?? ""))
    && ["failed", "blocked"].includes(String(item.state ?? "").toLowerCase())
    && /pending Apply-to-Join request|Apply-to-Join request yet/i.test(String(item.details ?? ""))
  );
  if (!candidates.length) return order;

  const config = await getCommunityOAuthConfig();
  if (!config.configured || config.guildId !== String(order.serverId)) return order;

  const joinedUserIds = new Set();
  const pendingUserIds = new Set();
  for (const item of candidates) {
    try {
      const member = await requestDiscord(
        `guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(item.discordUserId)}`,
        { headers: { Authorization: `Bot ${config.botToken}` } }
      );
      if (member.response.ok) {
        joinedUserIds.add(String(item.discordUserId));
        if (member.payload?.pending === true) pendingUserIds.add(String(item.discordUserId));
      }
    } catch {
      // Keep the original result and retry reconciliation on a later status poll.
    }
  }
  if (!joinedUserIds.size) return order;

  const completedAt = new Date().toISOString();
  const communityResults = order.communityResults.map((item) => {
    const discordUserId = String(item?.discordUserId ?? "");
    if (!joinedUserIds.has(discordUserId)) return item;
    return {
      ...item,
      state: "joined",
      details: pendingUserIds.has(discordUserId)
        ? "Member joined the server and is pending Discord's server-rules screening."
        : "Member joined the server.",
      completedAt
    };
  });
  await pool.query(
    `UPDATE community_oauth_joins
     SET reserved_order_id = NULL
     WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])`,
    [config.guildId, [...joinedUserIds]]
  );

  const joinedCount = communityResults.filter((item) => String(item?.state ?? "").toLowerCase() === "joined").length;
  const added = Math.max(Number(order.added ?? 0), joinedCount);
  const amount = Number(order.amount ?? 0);
  const currentStatus = String(order.status ?? "").toUpperCase();
  const status = amount > 0 && added >= amount
    ? "COMPLETED"
    : ["ERROR", "PARTIAL"].includes(currentStatus) && added > 0
      ? "PARTIAL"
      : order.status;
  const reconciled = {
    ...order,
    added,
    status,
    details: amount > 0 && added >= amount
      ? `${added}/${amount} members delivered.`
      : `${added}/${amount} members delivered. Review the member results.`,
    communityResults
  };
  await saveTrackedOrderPayload(reconciled);
  return reconciled;
}

function sanitizePublicCommunityOrder(order) {
  if (!order || typeof order !== "object" || Array.isArray(order) || !Array.isArray(order.communityResults)) return order;
  const generatedBotInvite = !order.botInvite && isDiscordGuildId(String(order.botApplicationId ?? "")) && isDiscordGuildId(String(order.serverId ?? ""))
    ? createCommunityBotInvite({ clientId: String(order.botApplicationId) }, String(order.serverId))
    : order.botInvite;
  return {
    ...order,
    botInvite: generatedBotInvite,
    communityResults: order.communityResults.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const sanitized = { ...item };
      const state = String(item.state ?? "").toLowerCase();
      sanitized.details = item.authorizationStatus === "inactive"
        ? "This member is inactive and can be replaced."
        : state === "joined"
          ? "Member delivered successfully."
          : state === "already_member"
            ? "This member was already in the server and can be replaced."
            : state === "failed"
              ? "This member could not be delivered and can be replaced."
              : state === "blocked"
                ? "Delivery could not continue for this member."
                : state === "replacing"
                  ? "A replacement member is being delivered."
                  : state === "joining"
                    ? "Member delivery is in progress."
                    : state === "cancelled"
                      ? "Delivery was cancelled before this member completed."
                      : "Waiting for delivery.";
      delete sanitized.discordUserId;
      delete sanitized.replacementHistoryUserIds;
      delete sanitized.authorizationDetails;
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
    payload = await recoverCommunityGuildRestrictionOrder(payload);
    payload = await activateWaitingCommunityOrder(payload);
    payload = await reconcileCommunityPendingJoinResults(payload);
    payload = await hydrateCommunityOrderAvatars(payload);
    res.set("Cache-Control", "no-store").json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders/:uniqid/check-members", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") return res.status(404).json({ message: "Members order could not be found." });
    const result = await checkCommunityOrderAuthorizations(order);
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders/:uniqid/cancel", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }

    const currentStatus = String(order.status ?? "").toUpperCase();
    const delivered = Number(order.added ?? 0);
    const ordered = Number(order.amount ?? 0);
    if (!["WAITING", "PROCESS", "PAUSED", "INVITES PAUSED", "ERROR", "PARTIAL"].includes(currentStatus) || (ordered > 0 && delivered >= ordered)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: `This Members order is already ${currentStatus || "finished"}.` });
    }

    const cancelledAt = new Date().toISOString();
    const communityResults = Array.isArray(order.communityResults)
      ? order.communityResults.map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return item;
          if (!["queued", "joining", "replacing"].includes(String(item.state ?? "").toLowerCase())) return item;
          return { ...item, state: "cancelled", details: "Delivery cancelled before this member completed.", completedAt: cancelledAt };
        })
      : order.communityResults;
    const cancelledOrder = {
      ...order,
      status: "CANCELLED",
      waitingCode: null,
      details: "Members delivery cancelled by an administrator.",
      cancelledAt,
      communityResults
    };

    await client.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id = $1", [uniqid]);
    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [uniqid, JSON.stringify(cancelledOrder)]
    );
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store").json(cancelledOrder);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

async function pauseCommunityOrder(req, res, next) {
  const client = await pool.connect();
  try {
    const isPublicRequest = req.path.startsWith("/api/public/");
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }

    const currentStatus = String(order.status ?? "").toUpperCase();
    if (currentStatus === "PAUSED") {
      await client.query("COMMIT");
      return res.set("Cache-Control", "no-store").json(isPublicRequest ? sanitizePublicCommunityOrder(order) : order);
    }
    if (!["WAITING", "PROCESS"].includes(currentStatus)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only an active Members delivery can be paused." });
    }
    if (Array.isArray(order.communityResults) && order.communityResults.some((item) => String(item?.state ?? "").toLowerCase() === "replacing")) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Wait for the current replacement to finish before pausing delivery." });
    }

    const pausedAt = new Date().toISOString();
    const pausedOrder = {
      ...order,
      status: "PAUSED",
      details: "Delivery paused.",
      pausedAt,
      pausedFromStatus: currentStatus,
      pausedWaitingCode: order.waitingCode ?? null,
      waitingCode: "manual_pause",
      communityResults: Array.isArray(order.communityResults)
        ? order.communityResults.map((item) => String(item?.state ?? "").toLowerCase() === "joining"
          ? { ...item, state: "queued", details: "Waiting for delivery to resume." }
          : item)
        : order.communityResults
    };
    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [uniqid, JSON.stringify(pausedOrder)]
    );
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store").json(isPublicRequest ? sanitizePublicCommunityOrder(pausedOrder) : pausedOrder);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function resumeCommunityOrder(req, res, next) {
  const client = await pool.connect();
  try {
    const isPublicRequest = req.path.startsWith("/api/public/");
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }
    if (String(order.status ?? "").toUpperCase() !== "PAUSED") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This Members delivery is not paused." });
    }

    const resumedOrder = {
      ...order,
      status: "WAITING",
      details: "Preparing to resume delivery.",
      waitingCode: order.pausedFromStatus === "WAITING" ? order.pausedWaitingCode : "manual_resume",
      resumedAt: new Date().toISOString()
    };
    delete resumedOrder.pausedAt;
    delete resumedOrder.pausedFromStatus;
    delete resumedOrder.pausedWaitingCode;
    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [uniqid, JSON.stringify(resumedOrder)]
    );
    await client.query("COMMIT");

    activateWaitingCommunityOrder.lastChecks?.delete(uniqid);
    const activeOrder = await activateWaitingCommunityOrder(resumedOrder);
    res.set("Cache-Control", "no-store").json(isPublicRequest ? sanitizePublicCommunityOrder(activeOrder) : activeOrder);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

app.post("/api/community/orders/:uniqid/pause", requireSession, pauseCommunityOrder);
app.post("/api/community/orders/:uniqid/resume", requireSession, resumeCommunityOrder);
app.post("/api/public/orders/:uniqid/pause", pauseCommunityOrder);
app.post("/api/public/orders/:uniqid/resume", resumeCommunityOrder);

async function restartCommunityRestrictedOrder(req, res, next) {
  let uniqid = "";
  try {
    const isPublicRequest = req.path.startsWith("/api/public/");
    uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });

    const cooldownKey = `${req.ip}:${uniqid}`;
    const cooldownUntil = publicRestartCooldowns.get(cooldownKey) ?? 0;
    if (isPublicRequest && cooldownUntil > Date.now()) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds before checking again.`
      });
    }
    if (communityRestrictionChecks.has(uniqid)) {
      return res.status(409).json({ message: "This server restriction is already being checked." });
    }
    communityRestrictionChecks.add(uniqid);

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") {
      return res.status(404).json({ message: "Members order could not be found." });
    }
    if (String(order.status ?? "").trim().toUpperCase() !== "INVITES PAUSED") {
      return res.status(409).json({ message: "This order is not waiting for a Discord server restriction check." });
    }

    const latestConfig = await getCommunityOAuthConfig();
    const targetGuildId = String(order.serverId ?? "").trim();
    const targetConfig = normalizeCommunityOAuthConfig({ ...latestConfig, guildId: targetGuildId });
    if (!targetConfig.configured || !isDiscordGuildId(targetGuildId)) {
      return res.status(503).json({ message: "Configure the Members bot before checking this server." });
    }

    const access = await checkCommunityBotDirectGuildAccess(targetConfig, targetGuildId).catch(() => null);
    if (!access?.accessible) {
      const discordStatus = Number(access?.status) || 0;
      if (![401, 403, 404].includes(discordStatus)) {
        const error = new Error("Discord is temporarily unavailable. The order remains invites paused; try again shortly.");
        error.statusCode = 502;
        throw error;
      }
      const waitingOrder = {
        ...order,
        status: "WAITING",
        waitingCode: `discord_${discordStatus}`,
        botInvite: createCommunityBotInvite(targetConfig, targetGuildId),
        details: discordStatus === 401
          ? "Discord rejected the configured Members bot token. Update the bot settings to continue delivery."
          : "The Members bot is not available in the target server yet. Add it to continue delivery."
      };
      await saveTrackedOrderPayload(waitingOrder);
      if (isPublicRequest) publicRestartCooldowns.set(cooldownKey, Date.now() + publicRestartCooldownMs);
      return res.set("Cache-Control", "no-store").json(isPublicRequest ? sanitizePublicCommunityOrder(waitingOrder) : waitingOrder);
    }

    if (isCommunityGuildInvitesRestricted(access.payload)) {
      if (isPublicRequest) publicRestartCooldowns.set(cooldownKey, Date.now() + publicRestartCooldownMs);
      return res.set("Cache-Control", "no-store").json(isPublicRequest ? sanitizePublicCommunityOrder(order) : order);
    }

    const waitingOrder = {
      ...order,
      status: "WAITING",
      waitingCode: "restriction_check",
      details: "The bot is available. Starting delivery to verify the server restriction."
    };
    await saveTrackedOrderPayload(waitingOrder);
    activateWaitingCommunityOrder.lastChecks?.delete(uniqid);
    const checkedOrder = await activateWaitingCommunityOrder(waitingOrder);
    if (isPublicRequest) publicRestartCooldowns.set(cooldownKey, Date.now() + publicRestartCooldownMs);
    res.set("Cache-Control", "no-store").json(isPublicRequest ? sanitizePublicCommunityOrder(checkedOrder) : checkedOrder);
  } catch (error) {
    next(error);
  } finally {
    if (uniqid) communityRestrictionChecks.delete(uniqid);
  }
}

app.post("/api/community/orders/:uniqid/restart", requireSession, restartCommunityRestrictedOrder);
app.post("/api/public/orders/:uniqid/community-restart", restartCommunityRestrictedOrder);

app.post("/api/community/orders/:uniqid/delay", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const delay = Number.parseInt(req.body?.delay, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isInteger(delay) || delay < 0 || delay > 1200) {
      return res.status(400).json({ message: "A valid order ID and delay between 0 and 1200 seconds are required." });
    }
    const updated = await pool.query(
      `UPDATE tracked_orders
       SET payload = jsonb_set(jsonb_set(payload, '{delay}', to_jsonb($2::int)), '{speedProfile}', '"custom"'::jsonb), updated_at = NOW()
       WHERE uniqid = $1 AND payload->>'provider' = 'community' AND payload->>'status' IN ('WAITING', 'PROCESS', 'PAUSED')
       RETURNING payload`,
      [uniqid, delay]
    );
    if (!updated.rowCount) return res.status(409).json({ message: "This Members order is no longer active." });
    res.json(updated.rows[0].payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders/:uniqid/extend", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const months = Number.parseInt(req.body?.months, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isInteger(months) || months < 1 || months > 6) {
      return res.status(400).json({ message: "Choose an extension between 1 and 6 months." });
    }

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }
    if (order.categoryIsPeriodic !== true && !order.expiredAt) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This Members order does not have a support period." });
    }

    const now = new Date();
    const currentExpiration = new Date(order.expiredAt);
    const extensionBase = Number.isFinite(currentExpiration.getTime()) && currentExpiration > now ? currentExpiration : now;
    const nextExpiration = addUtcMonths(extensionBase, months).toISOString();
    const extendedAt = now.toISOString();
    const updatedOrder = {
      ...order,
      durationMonths: Math.max(0, Number(order.durationMonths) || 0) + months,
      expiredAt: nextExpiration,
      supportExtensions: [
        ...(Array.isArray(order.supportExtensions) ? order.supportExtensions : []),
        { months, previousExpiredAt: order.expiredAt ?? null, expiredAt: nextExpiration, extendedAt }
      ]
    };

    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [uniqid, JSON.stringify(updatedOrder)]
    );
    await client.query("COMMIT");
    res.set("Cache-Control", "no-store").json(updatedOrder);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
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
    if (!isAdminRequest && isCommunityOrderManagementExpired(order)) {
      await client.query("ROLLBACK");
      return res.status(410).json({ message: "This order's member support period has expired." });
    }
    if (String(order.serverId ?? "") !== config.guildId) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "The Members bot is no longer configured for this order's server." });
    }
    const replacementAllowedStatuses = new Set(["PARTIAL", "COMPLETED", "ERROR"]);
    if (!replacementAllowedStatuses.has(String(order.status ?? "").toUpperCase())) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Wait for the current delivery to finish before replacing members." });
    }

    const results = [...order.communityResults];
    if (results.some((item) => String(item?.state ?? "").toLowerCase() === "replacing")) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Another replacement member is already running for this order." });
    }
    const failedResult = results[resultIndex];
    const replaceableStates = new Set(["failed", "already_member"]);
    const hasInactiveAuthorization = String(failedResult?.authorizationStatus ?? "").toLowerCase() === "inactive";
    if (!failedResult || typeof failedResult !== "object" || Array.isArray(failedResult) || (!replaceableStates.has(String(failedResult.state ?? "").toLowerCase()) && !hasInactiveAuthorization)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Only failed, already-member or OAuth-inactive results can be replaced." });
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

    const failedState = hasInactiveAuthorization;
    await client.query(
      `UPDATE community_oauth_joins
       SET reserved_order_id = NULL,
           status = CASE WHEN $3 THEN 'failed' ELSE status END,
           details = CASE WHEN $3 THEN 'Previous delivery failed; disabled before replacement.' ELSE details END
       WHERE discord_user_id = $1 AND guild_id = $2`,
      [failedUserId, config.guildId, failedState]
    );

    const replacementHistoryUserIds = Array.from(new Set([
      ...(Array.isArray(failedResult.replacementHistoryUserIds) ? failedResult.replacementHistoryUserIds : []),
      failedUserId
    ].map((value) => String(value ?? "").trim()).filter(isDiscordGuildId)));
    const replacementHistoryUsernames = Array.from(new Set([
      ...(Array.isArray(failedResult.replacementHistoryUsernames) ? failedResult.replacementHistoryUsernames : []),
      failedResult.previousUsername,
      failedResult.username
    ].map((value) => String(value ?? "").trim()).filter(Boolean)));
    const previouslyDeliveredUserIds = await loadCommunityPreviouslyDeliveredUserIds(client, config.guildId);
    const usedUserIds = Array.from(new Set([
      ...replacementHistoryUserIds,
      ...previouslyDeliveredUserIds,
      ...results.flatMap((item) => [
        String(item?.discordUserId ?? "").trim(),
        ...(Array.isArray(item?.replacementHistoryUserIds) ? item.replacementHistoryUserIds.map((value) => String(value ?? "").trim()) : [])
      ]).filter(isDiscordGuildId)
    ]));
    const usedUsernames = Array.from(new Set([
      ...replacementHistoryUsernames,
      ...results.flatMap((item) => [
        String(item?.username ?? "").trim(),
        String(item?.previousUsername ?? "").trim(),
        ...(Array.isArray(item?.replacementHistoryUsernames) ? item.replacementHistoryUsernames.map((value) => String(value ?? "").trim()) : [])
      ]).filter(Boolean)
    ]));
    const replacement = await client.query(
      `SELECT discord_user_id, username, avatar_url, encrypted_access_token, access_token_expires_at
       FROM community_oauth_joins
       WHERE guild_id = $1
         AND stock_type = $4
          AND status = 'authorized'
         AND encrypted_access_token IS NOT NULL
         AND access_token_expires_at > NOW()
         AND reserved_order_id IS NULL
         AND NOT (discord_user_id = ANY($2::text[]))
         AND NOT (username = ANY($3::text[]))
       ORDER BY sort_position ASC, authorized_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [config.guildId, usedUserIds, usedUsernames, getCommunityOrderStockType(order)]
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
      previousUsername: failedResult.username,
      replacementHistoryUserIds,
      replacementHistoryUsernames
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
        "UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE discord_user_id = $1 AND guild_id = $2",
        [member.discord_user_id, config.guildId]
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

const publicCommunityOrderStreams = new Map();
const communityRestrictionChecks = new Set();
let publicCommunityStreamPollRunning = false;

async function pollPublicCommunityOrderStreams() {
  if (publicCommunityStreamPollRunning || publicCommunityOrderStreams.size === 0) return;
  publicCommunityStreamPollRunning = true;
  try {
    const orderIds = [...publicCommunityOrderStreams.keys()];
    const tracked = await pool.query(
      "SELECT uniqid, payload FROM tracked_orders WHERE uniqid = ANY($1::text[]) AND payload->>'provider' = 'community'",
      [orderIds]
    );
    for (const row of tracked.rows) {
      const listeners = publicCommunityOrderStreams.get(row.uniqid);
      if (!listeners?.size) continue;
      let livePayload = row.payload;
      if (["WAITING", "RECOVERING"].includes(String(livePayload?.status ?? "").toUpperCase()) && !communityRestrictionChecks.has(row.uniqid)) {
        try {
          livePayload = await activateWaitingCommunityOrder(livePayload);
        } catch (error) {
          console.error(`Community monitor bot check failed for ${row.uniqid}:`, error instanceof Error ? error.message : error);
        }
      }
      const snapshot = {
        ...sanitizePublicCommunityOrder(livePayload),
        canManageCommunityMembers: !isCommunityOrderManagementExpired(livePayload)
      };
      const serialized = JSON.stringify(snapshot);
      for (const listener of listeners) {
        if (listener.lastSnapshot === serialized) continue;
        listener.lastSnapshot = serialized;
        listener.response.write(`data: ${serialized}\n\n`);
      }
    }
  } finally {
    publicCommunityStreamPollRunning = false;
  }
}

const publicCommunityStreamTimer = setInterval(() => {
  void pollPublicCommunityOrderStreams().catch((error) => {
    console.error("Community monitor stream failed:", error instanceof Error ? error.message : error);
  });
}, 750);
publicCommunityStreamTimer.unref();

app.get("/api/public/orders/:uniqid/stream", async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });
    const tracked = await pool.query(
      "SELECT payload FROM tracked_orders WHERE uniqid = $1 AND payload->>'provider' = 'community' LIMIT 1",
      [uniqid]
    );
    if (!tracked.rowCount) return res.status(404).json({ message: "Members order could not be found." });

    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders?.();
    res.write("retry: 2000\n\n");

    const snapshot = {
      ...sanitizePublicCommunityOrder(tracked.rows[0].payload),
      canManageCommunityMembers: !isCommunityOrderManagementExpired(tracked.rows[0].payload)
    };
    const serialized = JSON.stringify(snapshot);
    res.write(`data: ${serialized}\n\n`);

    const listener = { response: res, lastSnapshot: serialized };
    const listeners = publicCommunityOrderStreams.get(uniqid) ?? new Set();
    listeners.add(listener);
    publicCommunityOrderStreams.set(uniqid, listeners);
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 20_000);
    heartbeat.unref();

    req.on("close", () => {
      clearInterval(heartbeat);
      listeners.delete(listener);
      if (!listeners.size) publicCommunityOrderStreams.delete(uniqid);
    });
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
    if (trackedPayload && typeof trackedPayload === "object" && !Array.isArray(trackedPayload) && trackedPayload.provider === "community") {
      trackedPayload = await recoverCommunityGuildRestrictionOrder(trackedPayload);
      trackedPayload = await activateWaitingCommunityOrder(trackedPayload);
      trackedPayload = await reconcileCommunityPendingJoinResults(trackedPayload);
      trackedPayload = await hydrateCommunityOrderAvatars(trackedPayload);
      return res.set("Cache-Control", "no-store").json({
        ...sanitizePublicCommunityOrder(trackedPayload),
        liveBoostStock,
        canManageCommunityMembers: !isCommunityOrderManagementExpired(trackedPayload)
      });
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

    if (!trackedPayload && /^(members_|dcord_)/i.test(uniqid)) {
      return res.status(404).set("Cache-Control", "no-store").json({ message: "Order could not be found." });
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

app.post("/api/public/orders/:uniqid/check-members", async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });
    const cooldownKey = `${req.ip}:${uniqid}`;
    const cooldownUntil = publicCommunityCheckCooldowns.get(cooldownKey) ?? 0;
    if (cooldownUntil > Date.now()) {
      return res.status(429).json({ message: `Wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)}s before checking these members again.` });
    }
    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") return res.status(404).json({ message: "Members order could not be found." });
    if (isCommunityOrderManagementExpired(order)) {
      return res.status(410).json({ message: "This order's member support period has expired." });
    }
    publicCommunityCheckCooldowns.set(cooldownKey, Date.now() + publicCommunityCheckCooldownMs);
    const result = await checkCommunityOrderAuthorizations(order);
    res.set("Cache-Control", "no-store").json({ order: sanitizePublicCommunityOrder(result.order), summary: result.summary });
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/orders/:uniqid/delay", async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const requestedSpeedProfile = normalizeCommunitySpeedProfile(req.body?.speedProfile);
    const profileDelay = requestedSpeedProfile === "safe" ? 700 : requestedSpeedProfile === "balanced" ? 300 : requestedSpeedProfile === "fast" ? 60 : null;
    const delay = profileDelay ?? Number.parseInt(req.body?.delay, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isFinite(delay) || delay < 0 || delay > 1200) {
      return res.status(400).json({ message: "A valid order ID and delay between 0 and 1200 seconds are required." });
    }

    const cooldownKey = `${req.ip}:${uniqid}`;
    const cooldownUntil = publicDelayCooldowns.get(cooldownKey) ?? 0;
    if (delay !== 0 && cooldownUntil > Date.now()) {
      return res.status(429).json({
        message: `Please wait ${Math.ceil((cooldownUntil - Date.now()) / 1000)} seconds before updating again.`
      });
    }

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const trackedPayload = tracked.rows[0]?.payload;
    if (trackedPayload?.provider === "community") {
      const updated = await pool.query(
        `UPDATE tracked_orders
         SET payload = jsonb_set(jsonb_set(payload, '{delay}', to_jsonb($2::int)), '{speedProfile}', to_jsonb($3::text)), updated_at = NOW()
         WHERE uniqid = $1 AND payload->>'provider' = 'community' AND payload->>'status' IN ('WAITING', 'PROCESS', 'PAUSED')
         RETURNING payload`,
        [uniqid, delay, requestedSpeedProfile]
      );
      if (!updated.rowCount) return res.status(409).json({ message: "This Members order is no longer active." });
      if (delay === 0) publicDelayCooldowns.delete(cooldownKey);
      else publicDelayCooldowns.set(cooldownKey, Date.now() + publicDelayCooldownMs);
      return res.json({ delay, speedProfile: requestedSpeedProfile, updated: true });
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
    const payload = await requestDcord("/api/me", { method: "GET", cache: "no-store" });
    const account = payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : payload;
    const enabled = account?.enabled !== false;
    const balance = Number(account?.balance);
    res.set("Cache-Control", "no-store").json({
      connected: enabled,
      status: enabled ? "ok" : "disabled",
      balance: Number.isFinite(balance) ? balance : undefined,
      message: enabled
        ? `Dcord API is reachable${Number.isFinite(balance) ? `. Available credits: ${balance}` : "."}`
        : "Dcord API key is valid, but the account is disabled."
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
    const useProxy = true;
    const concurrency = normalizeDcordBoostConcurrency(req.body?.concurrency);
    const allowMembershipScreening = req.body?.allowMembershipScreening === true;

    if (!invite || !Number.isFinite(amount) || amount <= 0 || amount % 2 !== 0 || ![1, 3].includes(duration)) {
      return res.status(400).json({ message: "A valid Discord invite, even boost amount, and duration are required." });
    }

    const serverInfo = await resolveDiscordInvite(invite);
    const memberVerification = await checkDcordBoostMembershipScreening(invite, serverInfo);
    if (memberVerification.status === "open" && !allowMembershipScreening) {
      return res.status(409).json({ message: "Membership screening is enabled on this server. Disable the join form before boosting." });
    }

    const stock = await loadBoostTokenStock();
    const stockKey = duration === 3 ? "threeMonth" : "oneMonth";
    const requiredTokens = amount / 2;
    if (stock[stockKey].length < requiredTokens) {
      return res.status(409).json({ message: `Only ${stock[stockKey].length * 2} ${duration} month boosts are in stock.` });
    }

    const assignedProxies = useProxy ? await reserveDcordProxies(requiredTokens) : [];

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
    if (useProxy) await saveDcordOrderProxies(uniqid, assignedProxies);
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
    if (/^(members_|dcord_)/i.test(uniqid)) {
      return res.status(404).json({ message: "Use the matching Members or Boost order status endpoint." });
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
    if (getDcordResultBoostCount(currentResult) > 0) {
      return res.status(409).json({ message: "A partially boosted token cannot be replaced automatically because that could over-deliver the order." });
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

    const replacementProxy = order.useProxy === true ? (await reserveDcordProxies(1))[0] : "";

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
    if (order.useProxy === true) {
      const assignedProxies = await loadDcordOrderProxies(uniqid);
      assignedProxies[resultIndex] = replacementProxy;
      await saveDcordOrderProxies(uniqid, assignedProxies);
    }

    const added = results.reduce((total, item) => total + getDcordResultBoostCount(item), 0);
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

app.delete("/api/orders/:uniqid", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    if (!tracked.rowCount) {
      await client.query("COMMIT");
      return res.json({ removed: true });
    }

    const payload = tracked.rows[0].payload;
    const locallyManaged = payload?.provider === "community" || payload?.provider === "dcord" || payload?.service === "DCORD-BOOSTS";
    if (locallyManaged && String(payload?.status ?? "").toUpperCase() === "PROCESS") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "An actively processing local order cannot be removed until it finishes." });
    }

    if (payload?.provider === "community") {
      await client.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id = $1", [uniqid]);
    }
    await client.query("DELETE FROM tracked_orders WHERE uniqid = $1", [uniqid]);
    await client.query(
      "DELETE FROM app_settings WHERE setting_key = ANY($1::text[])",
      [[getDcordOrderTokensSettingKey(uniqid), getDcordOrderProxiesSettingKey(uniqid)]]
    );
    await client.query("COMMIT");
    res.json({ removed: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
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
    for (const order of orders) {
      const uniqid = order.uniqid.trim();
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
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ message: "The request is too large. Send fewer records at once." });
  }
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
const communityRecoveryTimer = setInterval(() => {
  void recoverInterruptedCommunityOrders().catch((error) => {
    console.error("Members recovery scan failed:", error instanceof Error ? error.message : error);
  });
}, 10_000);
communityRecoveryTimer.unref();
