import crypto from "node:crypto";
import https from "node:https";
import path from "node:path";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import { HttpsProxyAgent } from "https-proxy-agent";
import pg from "pg";
import { SocksProxyAgent } from "socks-proxy-agent";
import WebSocket from "ws";

const { Pool } = pg;
const execFile = promisify(execFileCallback);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const humanizerPrimpScript = path.resolve(__dirname, "humanizer-primp.py");
const humanizerPrimpPython = process.env.PRIMP_PYTHON
  ?? (process.platform === "win32" ? "python" : "python3");
const port = Number(process.env.PORT ?? 3000);
const isProduction = process.env.NODE_ENV === "production";
const requestedServiceRole = String(process.env.SERVICE_ROLE ?? "all").trim().toLowerCase();
const serviceRole = ["web", "onliner", "all"].includes(requestedServiceRole) ? requestedServiceRole : "all";
const serviceRunsWeb = serviceRole === "web" || serviceRole === "all";
const serviceRunsOnliner = serviceRole === "onliner" || serviceRole === "all";
const sessionCookie = "plcp_session";
const sessionDurationMs = 12 * 60 * 60 * 1000;
const dcordApiBase = process.env.DCORD_API_BASE_URL ?? "https://capheaven.dcord.co";
const dcordTaskCreatePath = process.env.DCORD_TASK_CREATE_PATH ?? "/api/task/create";
const dcordTaskStatusPath = process.env.DCORD_TASK_STATUS_PATH ?? "/api/task/status";
const dcordUserAgent = process.env.DCORD_USER_AGENT ?? "plcp-dc/0.1 (+https://capheaven.dcord.co API client)";
const defaultDcordBoostConcurrency = 4;
const dcordRequestTimeoutMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_REQUEST_TIMEOUT_MS ?? "30000", 10) || 30_000, 10_000), 120_000);
const dcordProxyCheckUrl = process.env.DCORD_PROXY_CHECK_URL ?? "https://discord.com/api/v10/gateway";
const dcordProxyCheckTimeoutMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_PROXY_CHECK_TIMEOUT_MS ?? "10000", 10) || 10_000, 3_000), 30_000);
const dcordTaskPollIntervalMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_TASK_POLL_INTERVAL_MS ?? "3000", 10) || 3_000, 2_000), 10_000);
const dcordTaskMaxWaitMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_TASK_MAX_WAIT_MS ?? "620000", 10) || 620_000, 60_000), 900_000);
const dcordRetryBaseMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_RETRY_BASE_MS ?? "30000", 10) || 30_000, 10_000), 300_000);
const dcordRetryMaxMs = Math.min(Math.max(Number.parseInt(process.env.DCORD_RETRY_MAX_MS ?? "600000", 10) || 600_000, dcordRetryBaseMs), 3_600_000);
const dcordMaxRetryAttempts = Math.min(Math.max(Number.parseInt(process.env.DCORD_MAX_RETRY_ATTEMPTS ?? "12", 10) || 12, 1), 100);
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
const communityOrderMemberCheckProgress = new Map();
const communityOrderLeaveAllActive = new Set();
const dcordOrderProcessingJobs = new Set();
const dcordOrderRetryTimers = new Map();
const humanizerJobs = new Map();
const humanizerDiscordIdentityCache = new Map();
let humanizerDiscordBuildCache = { value: null, expiresAt: 0, pending: null };
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

function parseDiscordMessageLink(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);
    if (!["discord.com", "discordapp.com"].includes(hostname) || segments[0] !== "channels") return null;
    const [guildId, channelId, messageId] = segments.slice(1, 4);
    if (![guildId, channelId, messageId].every((id) => isDiscordGuildId(String(id ?? "")))) return null;
    return { guildId, channelId, messageId, url: `https://discord.com/channels/${guildId}/${channelId}/${messageId}` };
  } catch {
    return null;
  }
}

const discordInviteResolutionCache = new Map();
const discordInviteResolutionCacheTtlMs = 30_000;
const DISCORD_INVITE_FLAG_APPLICATION_BYPASS = 1 << 3;

async function resolveDiscordInvite(inviteValue) {
  const inviteCode = extractDiscordInviteCode(inviteValue);
  if (!inviteCode) {
    const error = new Error("Enter a Discord server ID or invite link.");
    error.statusCode = 400;
    throw error;
  }

  const cached = discordInviteResolutionCache.get(inviteCode);
  if (cached?.expiresAt > Date.now()) return cached.value;
  if (cached) discordInviteResolutionCache.delete(inviteCode);

  const inviteUrl = `https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true`;
  let response = await fetch(inviteUrl, { signal: AbortSignal.timeout(10_000) });
  let payload = await response.json().catch(() => ({}));
  if (response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(payload?.retry_after) || 1, 1), 5);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    response = await fetch(inviteUrl, { signal: AbortSignal.timeout(10_000) });
    payload = await response.json().catch(() => ({}));
  }

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

  const resolved = {
    guildId: String(guildId),
    guildName: typeof payload?.guild?.name === "string" && payload.guild.name.trim() ? payload.guild.name.trim() : undefined,
    approximateMemberCount: Number.isFinite(payload?.approximate_member_count)
      ? payload.approximate_member_count
      : undefined,
    bypassesJoinApplication: Number.isInteger(payload?.flags)
      && (payload.flags & DISCORD_INVITE_FLAG_APPLICATION_BYPASS) !== 0
  };
  discordInviteResolutionCache.set(inviteCode, {
    value: resolved,
    expiresAt: Date.now() + discordInviteResolutionCacheTtlMs
  });
  return resolved;
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

async function requestDiscordThroughProxy(pathname, proxyUrl, init = {}) {
  const normalizedProxyUrl = normalizeDiscordOnlinerProxyUrl(proxyUrl);
  if (!normalizedProxyUrl) throw new Error("The account's Onliner proxy is missing or invalid.");
  const target = new URL(`${discordApiBase}/${String(pathname).replace(/^\/+/, "")}`);
  const body = init.body == null ? null : String(init.body);
  const headers = {
    Accept: "application/json",
    ...(init.headers ?? {}),
    ...(body == null ? {} : { "Content-Length": Buffer.byteLength(body) })
  };

  return new Promise((resolve, reject) => {
    const request = https.request(target, {
      method: init.method ?? "GET",
      headers,
      agent: createDiscordOnlinerProxyAgent(normalizedProxyUrl)
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          request.destroy(new Error("Discord proxy response was too large."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const status = Number(response.statusCode) || 0;
        recordDiscordOnlinerProxyHealth(normalizedProxyUrl, status !== 407);
        const raw = Buffer.concat(chunks).toString("utf8");
        let payload = null;
        if (raw) {
          try {
            payload = JSON.parse(raw);
          } catch {
            payload = {};
          }
        }
        resolve({
          response: { status, ok: status >= 200 && status < 300, headers: response.headers },
          payload,
          rawText: raw
        });
      });
    });
    request.setTimeout(15_000, () => request.destroy(new Error("Discord proxy request timed out.")));
    request.on("error", (error) => {
      recordDiscordOnlinerProxyHealth(normalizedProxyUrl, false);
      reject(error);
    });
    if (body != null) request.write(body);
    request.end();
  });
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

function getHumanizerJobSnapshot(job) {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    total: job.total,
    completed: job.completed,
    succeeded: job.succeeded,
    failed: job.failed,
    skipped: job.unavailable ?? [],
    results: job.results
  };
}

function cleanHumanizerLines(value, maximum, maximumLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const line = String(item ?? "").trim().slice(0, maximumLength);
    if (!line || seen.has(line)) continue;
    seen.add(line);
    normalized.push(line);
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

const humanizerFieldNames = ["username", "displayName", "bio", "pronouns", "avatar", "hypesquad"];
const humanizerFieldNameSet = new Set(humanizerFieldNames);

function normalizeHumanizerEnabledFields(value, fallbackPayload = null) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((field) => String(field ?? "").trim()).filter((field) => humanizerFieldNameSet.has(field)))];
  }
  if (!fallbackPayload) return [];
  return humanizerFieldNames.filter((field) => {
    if (field === "username") return Array.isArray(fallbackPayload.usernames) && fallbackPayload.usernames.length > 0;
    if (field === "displayName") return Array.isArray(fallbackPayload.displayNames) && fallbackPayload.displayNames.length > 0;
    if (field === "bio") return Array.isArray(fallbackPayload.bios) && fallbackPayload.bios.length > 0;
    if (field === "pronouns") return Array.isArray(fallbackPayload.pronouns) && fallbackPayload.pronouns.length > 0;
    if (field === "avatar") return Array.isArray(fallbackPayload.avatars) && fallbackPayload.avatars.length > 0;
    return ["random", "bravery", "brilliance", "balance"].includes(fallbackPayload.hypesquad);
  });
}

function normalizeHumanizerAvatar(value) {
  const avatar = String(value ?? "").trim();
  if (!avatar) return "";
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(avatar)) return "";
  return avatar.length <= 1_500_000 ? avatar : "";
}

const humanizerAvatarMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function getHumanizerAvatarSnapshot(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    url: `/api/humanizer/avatars/${encodeURIComponent(row.id)}`,
    size: Number(row.size_bytes) || 0
  };
}

function getHumanizerPackageSnapshot(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  return {
    id: String(row.id),
    name: String(row.name),
    enabledFields: normalizeHumanizerEnabledFields(payload.enabledFields, payload),
    usernames: Array.isArray(payload.usernames) ? payload.usernames : [],
    displayNames: Array.isArray(payload.displayNames) ? payload.displayNames : [],
    bios: Array.isArray(payload.bios) ? payload.bios : [],
    pronouns: Array.isArray(payload.pronouns) ? payload.pronouns : [],
    avatars: Array.isArray(payload.avatars) ? payload.avatars : [],
    hypesquad: ["random", "bravery", "brilliance", "balance"].includes(payload.hypesquad) ? payload.hypesquad : "none",
    concurrency: Math.min(Math.max(Number.parseInt(payload.concurrency, 10) || 2, 1), 5),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function getHumanizerDiscordError(result, fallback) {
  const message = String(result?.payload?.message ?? "").trim();
  const code = result?.payload?.code;
  if (result?.payload?.captcha_key) return "Discord requires CAPTCHA verification; this account was skipped.";
  if (result?.response?.status === 401) return "The saved user token is no longer valid.";
  if (result?.response?.status === 403) return message || "Discord denied access for this account.";
  if (result?.response?.status === 429) return "Discord rate limited this profile update.";
  return `${message || fallback}${code == null ? "" : ` (Discord code ${code})`}`;
}

function getHumanizerDiscordClientHeaders(token, identity) {
  const properties = {
    ...createDiscordGatewayIdentityProperties(),
    client_build_number: identity.buildNumber
  };
  const headers = {
    Authorization: token,
    "Content-Type": "application/json",
    "User-Agent": properties.browser_user_agent,
    "Accept-Language": `${properties.system_locale},en;q=0.9`,
    "X-Discord-Locale": properties.system_locale,
    "X-Discord-Timezone": "Europe/Istanbul",
    "X-Debug-Options": "bugReporterEnabled",
    "X-Super-Properties": Buffer.from(JSON.stringify(properties)).toString("base64"),
    "X-Fingerprint": identity.fingerprint
  };
  if (identity.installationId) headers["X-Installation-ID"] = identity.installationId;
  return headers;
}

async function runHumanizerPrimpHelper(payload, secrets = []) {
  const requestPayload = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const child = spawn(humanizerPrimpPython, [humanizerPrimpScript], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("Humanizer primp request timed out."));
    }, payload.operation === "identity" ? 35_000 : 20_000);

    child.stdout.on("data", (chunk) => {
      stdoutSize += chunk.length;
      if (stdoutSize > 3 * 1024 * 1024) {
        child.kill();
        finish(new Error("Humanizer primp response was too large."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrSize += chunk.length;
      if (stderrSize <= 64 * 1024) stderr.push(chunk);
    });
    child.once("error", () => finish(new Error("Humanizer primp transport could not be started.")));
    child.once("close", (code) => {
      if (settled) return;
      const raw = Buffer.concat(stdout).toString("utf8").trim();
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        const safeDetail = secrets
          .filter(Boolean)
          .map(String)
          .reduce((value, secret) => value.split(secret).join("[redacted]"), detail);
        finish(new Error(safeDetail ? `Humanizer primp transport failed: ${safeDetail}` : "Humanizer primp transport failed."));
        return;
      }
      try {
        finish(null, JSON.parse(raw));
      } catch {
        finish(new Error("Humanizer primp transport returned an invalid response."));
      }
    });
    child.stdin.once("error", (error) => finish(error));
    child.stdin.end(requestPayload);
  });
}

async function getHumanizerDiscordBuildNumber(proxyUrl) {
  if (humanizerDiscordBuildCache.value && humanizerDiscordBuildCache.expiresAt > Date.now()) {
    return humanizerDiscordBuildCache.value;
  }
  if (!humanizerDiscordBuildCache.pending) {
    humanizerDiscordBuildCache.pending = runHumanizerPrimpHelper({
      operation: "build-number",
      proxy: proxyUrl
    }, [proxyUrl]).then((result) => {
      const buildNumber = Number(result?.buildNumber);
      if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
        throw new Error("Discord returned an invalid client build number.");
      }
      humanizerDiscordBuildCache = {
        value: buildNumber,
        expiresAt: Date.now() + 15 * 60_000,
        pending: null
      };
      return buildNumber;
    }).catch((error) => {
      humanizerDiscordBuildCache.pending = null;
      throw error;
    });
  }
  return humanizerDiscordBuildCache.pending;
}

async function getHumanizerDiscordIdentity(proxyUrl, token) {
  const normalizedProxyUrl = normalizeDiscordOnlinerProxyUrl(proxyUrl);
  if (!normalizedProxyUrl) throw new Error("The account's Onliner proxy is missing or invalid.");
  const cacheKey = crypto.createHash("sha256").update(`${normalizedProxyUrl}\0${token}`).digest("hex");
  const cached = humanizerDiscordIdentityCache.get(cacheKey);
  const buildNumber = await getHumanizerDiscordBuildNumber(normalizedProxyUrl);
  if (cached?.expiresAt > Date.now()) return { ...cached, buildNumber };
  if (cached?.pending) return cached.pending;

  const properties = {
    ...createDiscordGatewayIdentityProperties(),
    client_build_number: buildNumber
  };
  const pending = runHumanizerPrimpHelper({
    operation: "identity",
    proxy: normalizedProxyUrl,
    properties
  }, [normalizedProxyUrl, token]).then((result) => {
    const fingerprint = String(result?.fingerprint ?? "").trim();
    const installationId = String(result?.installationId ?? "").trim();
    const discordIdentityPattern = /^\d+\.[A-Za-z0-9_-]+$/;
    if (!discordIdentityPattern.test(fingerprint)) {
      throw new Error("Discord experiments did not return a valid fingerprint.");
    }
    if (installationId && !discordIdentityPattern.test(installationId)) {
      throw new Error("Discord experiments returned an invalid installation ID.");
    }
    const identity = {
      fingerprint,
      installationId: installationId || null,
      buildNumber,
      expiresAt: Date.now() + (installationId ? 12 * 60 * 60_000 : 15 * 60_000),
      pending: null
    };
    humanizerDiscordIdentityCache.set(cacheKey, identity);
    return identity;
  }).catch((error) => {
    humanizerDiscordIdentityCache.delete(cacheKey);
    throw error;
  });
  humanizerDiscordIdentityCache.set(cacheKey, { pending, expiresAt: 0 });
  return pending;
}

async function requestHumanizerDiscordWithPrimp(pathname, proxyUrl, init = {}) {
  const normalizedProxyUrl = normalizeDiscordOnlinerProxyUrl(proxyUrl);
  if (!normalizedProxyUrl) throw new Error("The account's Onliner proxy is missing or invalid.");

  let result;
  try {
    result = await runHumanizerPrimpHelper({
      operation: "request",
      url: `${discordApiBase}/${String(pathname).replace(/^\/+/, "")}`,
      proxy: normalizedProxyUrl,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body == null ? null : String(init.body)
    }, [normalizedProxyUrl, String(init.headers?.Authorization ?? "")]);
  } catch (error) {
    recordDiscordOnlinerProxyHealth(normalizedProxyUrl, false);
    throw error;
  }

  const status = Number(result?.status) || 0;
  recordDiscordOnlinerProxyHealth(normalizedProxyUrl, status !== 407);
  const rawText = String(result?.body ?? "");
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = {};
    }
  }
  return {
    response: {
      status,
      ok: status >= 200 && status < 300,
      headers: result?.headers && typeof result.headers === "object" ? result.headers : {}
    },
    payload,
    rawText
  };
}

async function sendHumanizerDiscordRequest(pathname, proxyUrl, token, method, payload) {
  const identity = await getHumanizerDiscordIdentity(proxyUrl, token);
  const perform = () => requestHumanizerDiscordWithPrimp(pathname, proxyUrl, {
    method,
    headers: getHumanizerDiscordClientHeaders(token, identity),
    body: JSON.stringify(payload)
  });
  let result = await perform();
  if (result.response.status === 429) {
    const retryAfterSeconds = Math.min(Math.max(Number(result.payload?.retry_after) || 1, 1), 15);
    await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
    result = await perform();
  }
  return result;
}

function isHumanizerUnknownSession(result) {
  return result?.response?.status === 400 && (
    Number(result?.payload?.code) === 10020
    || /unknown session/i.test(String(result?.payload?.message ?? ""))
  );
}

async function runWithHumanizerGatewaySession(account, task) {
  const existingRuntime = account.onlinerAccountId
    ? discordOnlinerRuntimes.get(account.onlinerAccountId)
    : null;
  if (
    existingRuntime?.state === "connected"
    && existingRuntime.socket?.readyState === WebSocket.OPEN
    && existingRuntime.bot?.id === account.id
  ) {
    return task();
  }

  const gatewayUrl = "wss://gateway.discord.gg/?v=10&encoding=json";
  const socket = new WebSocket(gatewayUrl, {
    agent: createDiscordOnlinerProxyAgent(account.proxyUrl)
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let heartbeatTimer = null;
    let sequence = null;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(readyTimeout);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      try { socket.close(1000, "Humanizer profile update complete"); } catch {}
      if (error) reject(error);
      else resolve(value);
    };
    const readyTimeout = setTimeout(() => finish(new Error("Gateway session fallback timed out.")), 20_000);

    socket.on("message", (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (Number.isInteger(payload?.s)) sequence = payload.s;
      if (payload?.op === 10) {
        const heartbeatInterval = Math.max(1_000, Number(payload?.d?.heartbeat_interval) || 45_000);
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 1, d: sequence }));
        }, heartbeatInterval);
        heartbeatTimer.unref?.();
        socket.send(JSON.stringify({
          op: 2,
          d: {
            token: account.token,
            properties: createDiscordGatewayIdentityProperties(),
            presence: { status: "online", since: 0, activities: [], afk: false },
            capabilities: 16381,
            compress: false,
            client_state: createDiscordGatewayClientState()
          }
        }));
        return;
      }
      if (payload?.op === 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: 1, d: sequence }));
        return;
      }
      if (payload?.op === 9) {
        finish(new Error("Discord rejected the temporary Gateway session."));
        return;
      }
      if (payload?.op === 0 && payload?.t === "READY") {
        Promise.resolve(task()).then(
          (value) => finish(null, value),
          (error) => finish(error instanceof Error ? error : new Error("Gateway profile retry failed."))
        );
      }
    });
    socket.once("error", (error) => finish(error));
    socket.once("unexpected-response", (_request, response) => {
      finish(new Error(`Gateway session fallback was rejected (HTTP ${response.statusCode ?? "unknown"}).`));
      response.resume();
    });
    socket.once("close", (code) => {
      if (!settled) finish(new Error(`Gateway session fallback closed before READY (code ${code}).`));
    });
  });
}

async function sendHumanizerAccountUpdate(account, payload) {
  if (payload.avatar) {
    try {
      const updated = await runWithHumanizerGatewaySession(account, () =>
        sendHumanizerDiscordRequest("users/@me", account.proxyUrl, account.token, "PATCH", payload)
      );
      return { result: updated, gatewayFallback: true };
    } catch (error) {
      return {
        result: {
          response: { status: 0, ok: false, headers: {} },
          payload: { message: error instanceof Error ? error.message : "Onliner Gateway session failed." },
          rawText: ""
        },
        gatewayFallback: true
      };
    }
  }

  const direct = await sendHumanizerDiscordRequest("users/@me", account.proxyUrl, account.token, "PATCH", payload);
  if (!isHumanizerUnknownSession(direct)) return { result: direct, gatewayFallback: false };
  try {
    const retried = await runWithHumanizerGatewaySession(account, () =>
      sendHumanizerDiscordRequest("users/@me", account.proxyUrl, account.token, "PATCH", payload)
    );
    return { result: retried, gatewayFallback: true };
  } catch (error) {
    return {
      result: {
        response: { status: 0, ok: false, headers: {} },
        payload: { message: error instanceof Error ? error.message : "Gateway session fallback failed." },
        rawText: ""
      },
      gatewayFallback: true
    };
  }
}

async function runHumanizerJob(job, accounts, options) {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  const shuffle = (values) => {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = crypto.randomInt(index + 1);
      [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }
    return shuffled;
  };
  const pools = {
    usernames: shuffle(options.usernames),
    displayNames: shuffle(options.displayNames),
    bios: shuffle(options.bios),
    pronouns: shuffle(options.pronouns),
    avatarIds: shuffle(options.avatarIds)
  };
  const pick = (values, index) => values.length ? values[index % values.length] : null;

  await forEachWithConcurrency(accounts, options.concurrency, async (account, index) => {
    const result = job.results[index];
    result.state = "running";
    result.startedAt = new Date().toISOString();
    try {
      const accountPayload = {};
      const profilePayload = {};
      const username = pick(pools.usernames, index);
      const displayName = pick(pools.displayNames, index);
      const bio = pick(pools.bios, index);
      const pronouns = pick(pools.pronouns, index);
      const avatarId = pick(pools.avatarIds, index);
      let avatar = null;
      if (avatarId) {
        const avatarResult = await pool.query(
          "SELECT mime_type, image_data FROM humanizer_avatar_assets WHERE id = $1 LIMIT 1",
          [avatarId]
        );
        const asset = avatarResult.rows[0];
        if (!asset) throw new Error("A selected avatar is no longer available.");
        avatar = `data:${asset.mime_type};base64,${Buffer.from(asset.image_data).toString("base64")}`;
      }
      if (username) accountPayload.username = username;
      if (displayName) accountPayload.global_name = displayName;
      if (avatar) accountPayload.avatar = avatar;
      if (bio) profilePayload.bio = bio;
      if (pronouns) profilePayload.pronouns = pronouns;

      const failures = [];
      if (Object.keys(accountPayload).length) {
        const accountUpdate = await sendHumanizerAccountUpdate(account, accountPayload);
        const update = accountUpdate.result;
        result.gatewayFallback = accountUpdate.gatewayFallback;
        if (update.response.ok) {
          if (username) result.changed.push("Username");
          if (displayName) result.changed.push("Display name");
          if (avatar) result.changed.push("Avatar");
          await pool.query(
            `UPDATE community_oauth_joins
             SET username = COALESCE($3, username),
                 display_name = COALESCE($4, display_name),
                 avatar_url = CASE
                   WHEN $5::text IS NOT NULL AND NULLIF($6::text, '') IS NOT NULL
                   THEN 'https://cdn.discordapp.com/avatars/' || discord_user_id || '/' || $6 || '.png?size=128'
                   ELSE avatar_url
                 END
             WHERE guild_id = $1 AND discord_user_id = $2`,
            [account.guildId, account.id, username, displayName, avatar || null, String(update.payload?.avatar ?? "")]
          );
        } else {
          failures.push(getHumanizerDiscordError(update, "Account profile could not be updated."));
        }
      }

      if (Object.keys(profilePayload).length) {
        const update = await sendHumanizerDiscordRequest("users/@me/profile", account.proxyUrl, account.token, "PATCH", profilePayload);
        if (update.response.ok) {
          if (bio) result.changed.push("Bio");
          if (pronouns) result.changed.push("Pronouns");
        } else {
          failures.push(getHumanizerDiscordError(update, "Extended profile could not be updated."));
        }
      }

      if (options.hypesquad) {
        const houseId = options.hypesquad === "random"
          ? crypto.randomInt(1, 4)
          : ({ bravery: 1, brilliance: 2, balance: 3 })[options.hypesquad];
        const update = await sendHumanizerDiscordRequest("hypesquad/online", account.proxyUrl, account.token, "POST", { house_id: houseId });
        if (update.response.ok) result.changed.push("HypeSquad");
        else failures.push(getHumanizerDiscordError(update, "HypeSquad could not be updated."));
      }

      result.state = failures.length ? (result.changed.length ? "partial" : "failed") : "success";
      result.error = failures.join(" ") || null;
      if (result.state === "success") job.succeeded += 1;
      else job.failed += 1;
    } catch (error) {
      result.state = "failed";
      result.error = error instanceof Error ? error.message : "Profile update failed.";
      job.failed += 1;
    } finally {
      result.completedAt = new Date().toISOString();
      job.completed += 1;
      if (typeof options.onProgress === "function") {
        await options.onProgress(getHumanizerJobSnapshot(job)).catch(() => {});
      }
    }
  });

  job.status = "completed";
  job.completedAt = new Date().toISOString();
  if (typeof options.onProgress === "function") {
    await options.onProgress(getHumanizerJobSnapshot(job)).catch(() => {});
  }
}

async function runDcordOrderHumanizer(orderId, tokens, proxies, packageRow, jobId = crypto.randomUUID(), onProgress = null) {
  const payload = packageRow?.payload && typeof packageRow.payload === "object" ? packageRow.payload : {};
  const enabledFields = new Set(normalizeHumanizerEnabledFields(payload.enabledFields, payload));
  const accounts = tokens.map((stockToken, index) => {
    const token = extractDcordApiToken(stockToken);
    const proxyUrl = normalizeDiscordOnlinerProxyUrl(proxies[index]);
    if (!token) throw new Error(`Boost token ${index + 1} is invalid.`);
    if (!proxyUrl) throw new Error(`The assigned proxy for boost token ${index + 1} is missing or invalid.`);
    return {
      id: `${orderId}:${index + 1}`,
      username: `Boost token ${index + 1}`,
      displayName: null,
      avatarUrl: null,
      categoryId: "dcord-boost",
      guildId: null,
      onlinerAccountId: null,
      token,
      proxyUrl
    };
  });
  const job = {
    id: jobId,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    total: accounts.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    results: accounts.map((account) => ({
      id: account.id,
      username: account.username,
      displayName: null,
      avatarUrl: null,
      categoryId: account.categoryId,
      state: "pending",
      changed: [],
      error: null,
      gatewayFallback: false,
      startedAt: null,
      completedAt: null
    })),
    unavailable: []
  };
  humanizerJobs.set(job.id, job);
  await runHumanizerJob(job, accounts, {
    usernames: enabledFields.has("username") && Array.isArray(payload.usernames) ? payload.usernames : [],
    displayNames: enabledFields.has("displayName") && Array.isArray(payload.displayNames) ? payload.displayNames : [],
    bios: enabledFields.has("bio") && Array.isArray(payload.bios) ? payload.bios : [],
    pronouns: enabledFields.has("pronouns") && Array.isArray(payload.pronouns) ? payload.pronouns : [],
    avatarIds: enabledFields.has("avatar") && Array.isArray(payload.avatars) ? payload.avatars.map((avatar) => String(avatar?.id ?? "")).filter(Boolean) : [],
    hypesquad: enabledFields.has("hypesquad") && ["random", "bravery", "brilliance", "balance"].includes(payload.hypesquad) ? payload.hypesquad : null,
    concurrency: Math.min(Math.max(Number.parseInt(payload.concurrency, 10) || 1, 1), 5),
    onProgress
  });
  return getHumanizerJobSnapshot(job);
}

const discordOnlinerSettingKey = "discord_onliner_config";
const discordOnlinerAccountLimit = 3000;
const discordOnlinerWorkerId = `${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
const discordOnlinerWorkerLockKey = 1_746_203_913;
const discordOnlinerWorkerPollMs = 2_000;
const discordOnlinerWorkerHeartbeatMs = 5_000;
const discordOnlinerMaxReconnectAttempts = 2;
const discordOnlinerRateLimitCooldownMs = 5 * 60_000;
const discordOnlinerHeartbeatCooldownMs = 60_000;
const discordOnlinerStatusValues = ["online", "idle", "dnd"];
const discordOnlinerActivityTypeValues = ["playing", "streaming", "listening", "watching"];
const discordOnlinerStatuses = new Set([...discordOnlinerStatusValues, "mixed"]);
const discordOnlinerActivityTypes = new Set([...discordOnlinerActivityTypeValues, "none", "mixed"]);
const discordOnlinerActivityCodes = { playing: 0, streaming: 1, listening: 2, watching: 3 };
// Discord messages support a limited number of distinct reaction types. Rotate
// through a varied pool while allowing larger orders to share those reactions.
const communityReactionEmojis = ["👍", "❤️", "🔥", "🎉", "👏", "😍", "🤩", "💯", "✨", "🚀", "✅", "💜", "💙", "💚", "💛", "🧡", "🥳", "🙌", "👌", "😎"];
const communityNaturalReactionEmojis = ["❤️", "🔥", "👍", "🎉", "😂", "😍", "👏", "💯"];

function shuffleReactionValues(values) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function createNaturalCommunityReactionAssignments(deliveredMembers, requestedCount, usedPairs = new Set(), requestedEmojiCount = null) {
  const naturalPalette = shuffleReactionValues(communityNaturalReactionEmojis);
  const fallbackPalette = shuffleReactionValues(communityReactionEmojis.filter((emoji) => !communityNaturalReactionEmojis.includes(emoji)));
  const fullPalette = [...naturalPalette, ...fallbackPalette];
  const automaticEmojiCount = requestedCount <= 12 ? 2 : requestedCount <= 35 ? 3 : requestedCount <= 75 ? 8 : requestedCount <= 200 ? 9 : 10;
  const aestheticCount = Number.isInteger(requestedEmojiCount) ? requestedEmojiCount : automaticEmojiCount;
  const minimumCount = Math.ceil(requestedCount / deliveredMembers.length);
  const maximumPaletteCount = Number.isInteger(requestedEmojiCount) ? aestheticCount : fullPalette.length;

  for (let paletteCount = Math.max(aestheticCount, minimumCount); paletteCount <= maximumPaletteCount; paletteCount += 1) {
    const palette = fullPalette.slice(0, paletteCount);
    const candidates = palette.map((emoji) => shuffleReactionValues(deliveredMembers.filter((member) =>
      !usedPairs.has(`${member.discordUserId}:${emoji}`)
    )));
    if (candidates.reduce((total, values) => total + values.length, 0) < requestedCount) continue;

    const weights = palette.map((_, index) => 0.62 ** index);
    const weightTotal = weights.reduce((total, weight) => total + weight, 0);
    const rawCounts = weights.map((weight) => requestedCount * weight / weightTotal);
    const counts = rawCounts.map((value, index) => Math.min(Math.floor(value), candidates[index].length));
    let remaining = requestedCount - counts.reduce((total, value) => total + value, 0);
    const priority = rawCounts.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
    while (remaining > 0) {
      const available = priority.find(({ index }) => counts[index] < candidates[index].length);
      if (!available) break;
      counts[available.index] += 1;
      remaining -= 1;
      priority.push(priority.shift());
    }
    if (remaining > 0) continue;

    return palette.flatMap((emoji, emojiIndex) => candidates[emojiIndex].slice(0, counts[emojiIndex]).map((member) => ({
      discordUserId: String(member.discordUserId),
      reactionEmoji: emoji,
      reactionState: "pending",
      reactionDetails: "Waiting for the delivered member's Onliner Gateway connection before reacting."
    })));
  }
  return [];
}
const discordOnlinerProxyHealth = new Map();
let discordOnlinerProxySelectionSequence = 0;
function createDiscordGatewayIdentityProperties() {
  return {
    os: "Windows",
    browser: "Discord Client",
    device: "desktop",
    system_locale: "en-US",
    browser_user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9156 Chrome/124.0.6367.243 Electron/30.0.6 Safari/537.36",
    browser_version: "1.0.9156",
    os_version: "10",
    referrer: "",
    referring_domain: "",
    referrer_current: "",
    referring_domain_current: "",
    release_channel: "stable",
    client_build_number: 280000,
    client_event_source: null
  };
}
function createDiscordGatewayClientState() {
  return {
    guild_versions: {},
    highest_last_message_id: "0",
    read_state_version: 0,
    user_guild_settings_version: -1,
    user_settings_version: -1,
    private_channels_version: "0",
    api_code_version: 0
  };
}
const discordOnlinerProxyProtocols = new Set(["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);
const defaultDiscordOnlinerSpotifyPlaylistId = "37i9dQZF1DX0XUsuxWHRQd";
const discordOnlinerSpotifyPlaylistCache = new Map();
const discordOnlinerYouTubePlaylistCache = new Map();
const discordOnlinerApplicationAliases = new Map([
  ["overwatch 2", "overwatch"],
  ["skyrim special edition", "the elder scrolls v skyrim special edition"],
  ["alan wake 2", "alan wake ii"]
]);
let discordOnlinerApplicationCatalogCache = { expiresAt: 0, index: new Map(), pending: null };
const defaultDiscordOnlinerTwitchUsers = ["tarik", "shroud", "xqc", "pokimane", "summit1g", "sodapoppin", "hasanabi", "kaicenat", "ibai", "rubius", "auronplay", "gaules", "fps_shaka", "loltyler1", "ninja", "timthetatman", "zackrawrr", "caseoh_", "jynxzi", "moistcr1tikal"];
const defaultDiscordOnlinerStreamingCategories = ["Just Chatting", "VALORANT", "Minecraft", "Grand Theft Auto V", "Counter-Strike 2", "League of Legends", "Fortnite", "Call of Duty: Warzone", "Apex Legends", "EA Sports FC 26", "Tom Clancy's Rainbow Six Siege", "Dota 2", "World of Warcraft", "Escape from Tarkov", "Rust", "Dead by Daylight", "IRL", "Music", "Software and Game Development", "Sports"];
const defaultDiscordOnlinerStreamingTitles = ["Chill vibes only", "Late night stream", "Ranked grind starts now", "Road to the next rank", "Community games tonight", "Trying something new today", "Come hang out with us", "Climbing the leaderboard", "Casual games and good vibes", "Live with the community", "No sleep, just wins", "Learning the game together", "Chatting before the grind", "Weekend stream is live", "Can we win this one?", "Playing with viewers", "New update, first reactions", "Warm-up then ranked", "One more game", "Highlights incoming"];
const defaultDiscordOnlinerGames = [
  "Minecraft",
  "VALORANT",
  "Counter-Strike 2",
  "League of Legends",
  "Grand Theft Auto V",
  "Elden Ring",
  "Apex Legends",
  "Fortnite",
  "World of Warcraft",
  "Euro Truck Simulator 2",
  "Call of Duty",
  "Overwatch 2",
  "Rainbow Six Siege",
  "Rocket League",
  "Dota 2",
  "PUBG: BATTLEGROUNDS",
  "Dead by Daylight",
  "Rust",
  "DayZ",
  "Escape from Tarkov",
  "Destiny 2",
  "Warframe",
  "Path of Exile 2",
  "Diablo IV",
  "Lost Ark",
  "Final Fantasy XIV",
  "The Elder Scrolls Online",
  "Baldur's Gate 3",
  "Cyberpunk 2077",
  "Red Dead Redemption 2",
  "The Witcher 3: Wild Hunt",
  "Hogwarts Legacy",
  "Black Myth: Wukong",
  "Monster Hunter Wilds",
  "Monster Hunter: World",
  "Palworld",
  "Helldivers 2",
  "Marvel Rivals",
  "Teamfight Tactics",
  "Hearthstone",
  "Genshin Impact",
  "Honkai: Star Rail",
  "Roblox",
  "The Sims 4",
  "Stardew Valley",
  "Terraria",
  "Among Us",
  "Fall Guys",
  "Phasmophobia",
  "Lethal Company",
  "Sea of Thieves",
  "No Man's Sky",
  "ARK: Survival Ascended",
  "Sid Meier's Civilization VI",
  "Age of Empires IV",
  "Crusader Kings III",
  "Hearts of Iron IV",
  "Cities: Skylines II",
  "Microsoft Flight Simulator",
  "American Truck Simulator",
  "Forza Horizon 5",
  "EA SPORTS FC 26",
  "NBA 2K26",
  "Football Manager 26",
  "Assetto Corsa Competizione",
  "iRacing",
  "F1 26",
  "Mortal Kombat 1",
  "Street Fighter 6",
  "TEKKEN 8",
  "War Thunder",
  "Battlefield 2042",
  "Halo Infinite",
  "DOOM Eternal",
  "The Finals",
  "Garry's Mod",
  "Factorio",
  "Satisfactory",
  "RimWorld",
  "Project Zomboid",
  "Don't Starve Together",
  "7 Days to Die",
  "Old School RuneScape",
  "RuneScape",
  "Guild Wars 2",
  "New World: Aeternum",
  "Fallout 76",
  "Skyrim Special Edition",
  "Control",
  "Death Stranding",
  "Resident Evil 4",
  "Silent Hill 2",
  "Alan Wake 2",
  "Subnautica",
  "Hades II",
  "Hollow Knight",
  "Geometry Dash",
  "osu!",
  "VRChat"
];
const discordOnlinerRuntimes = new Map();
const discordOnlinerLogs = [];
let discordOnlinerNextLogId = 1;
const discordOnlinerLogClients = new Set();
const discordOnlinerPendingRuntimeWrites = new Map();
const discordOnlinerPendingLogWrites = [];
let discordOnlinerRuntimeFlushTimer = null;
let discordOnlinerLogFlushTimer = null;
let discordOnlinerConnectionsPaused = false;

function createDiscordOnlinerRuntime(accountId) {
  return {
    accountId,
    config: null,
    generation: 0,
    socket: null,
    startupTimer: null,
    heartbeatTimer: null,
    reconnectTimer: null,
    activityTimer: null,
    connectionQueueTimer: null,
    connectionQueueContinuation: null,
    connectionQueueStartNext: null,
    nextQueuedConnectionAt: null,
    heartbeatAcknowledged: true,
    sequence: null,
    sessionId: null,
    resumeGatewayUrl: null,
    state: "disconnected",
    bot: null,
    guildIds: new Set(),
    connectedAt: null,
    hasConnectedOnce: false,
    lastDisconnectedAt: null,
    lastError: null,
    reconnectAttempt: 0,
    automaticReconnectBlocked: false,
    reconnectNotBefore: 0,
    currentActivity: null,
    currentActivities: null,
    currentStatus: null,
    currentActivityType: null
  };
}

function getDiscordOnlinerRuntime(accountId) {
  let runtime = discordOnlinerRuntimes.get(accountId);
  if (!runtime) {
    runtime = createDiscordOnlinerRuntime(accountId);
    discordOnlinerRuntimes.set(accountId, runtime);
  }
  return runtime;
}

function serializeDiscordOnlinerRuntime(runtime) {
  return {
    currentActivity: runtime.currentActivity,
    connectionState: runtime.state,
    bot: runtime.bot,
    guildCount: runtime.guildIds.size,
    connectedAt: runtime.connectedAt,
    lastDisconnectedAt: runtime.lastDisconnectedAt,
    lastError: runtime.lastError,
    reconnectAttempt: runtime.reconnectAttempt,
    nextQueuedConnectionAt: runtime.nextQueuedConnectionAt
  };
}

function normalizeDiscordOnlinerConnectionState(value) {
  const state = String(value ?? "").trim().toLowerCase();
  return ["connected", "connecting", "reconnecting", "error", "disconnected"].includes(state) ? state : "disconnected";
}

function queueDiscordOnlinerRuntimePersist(runtime) {
  if (!serviceRunsOnliner || !runtime?.accountId) return;
  discordOnlinerPendingRuntimeWrites.set(runtime.accountId, serializeDiscordOnlinerRuntime(runtime));
  if (discordOnlinerRuntimeFlushTimer) return;
  discordOnlinerRuntimeFlushTimer = setTimeout(() => {
    discordOnlinerRuntimeFlushTimer = null;
    const rows = [...discordOnlinerPendingRuntimeWrites.entries()].map(([accountId, payload]) => ({ account_id: accountId, payload }));
    discordOnlinerPendingRuntimeWrites.clear();
    if (!rows.length) return;
    void pool.query(`
      INSERT INTO discord_onliner_runtime (account_id, payload, updated_at)
      SELECT account_id, payload, NOW()
      FROM jsonb_to_recordset($1::jsonb) AS records(account_id text, payload jsonb)
      ON CONFLICT (account_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `, [JSON.stringify(rows)]).catch((error) => console.error("Onliner runtime persistence failed:", error instanceof Error ? error.message : error));
  }, 500);
  discordOnlinerRuntimeFlushTimer.unref?.();
}

function queueDiscordOnlinerLogPersist(entry) {
  if (!serviceRunsOnliner) return;
  discordOnlinerPendingLogWrites.push({
    timestamp: entry.timestamp,
    level: entry.level,
    account_id: entry.accountId,
    message: entry.message
  });
  if (discordOnlinerLogFlushTimer) return;
  discordOnlinerLogFlushTimer = setTimeout(() => {
    discordOnlinerLogFlushTimer = null;
    const rows = discordOnlinerPendingLogWrites.splice(0, discordOnlinerPendingLogWrites.length);
    if (!rows.length) return;
    void pool.query(`
      INSERT INTO discord_onliner_persisted_logs (timestamp, level, account_id, message)
      SELECT timestamp, level, account_id, message
      FROM jsonb_to_recordset($1::jsonb) AS records(timestamp timestamptz, level text, account_id text, message text)
    `, [JSON.stringify(rows)]).then(() => pool.query(`
      DELETE FROM discord_onliner_persisted_logs
      WHERE id < COALESCE((SELECT MAX(id) - 5000 FROM discord_onliner_persisted_logs), 0)
    `)).catch((error) => console.error("Onliner log persistence failed:", error instanceof Error ? error.message : error));
  }, 500);
  discordOnlinerLogFlushTimer.unref?.();
}

function appendDiscordOnlinerLog(level, message, accountId = null) {
  const safeMessage = String(message ?? "")
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1***@")
    .replace(/[a-z\d_-]{20,}\.[a-z\d_-]{6,}\.[a-z\d_-]{20,}/gi, "[redacted token]")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 500);
  if (!safeMessage) return;
  const entry = {
    id: discordOnlinerNextLogId++,
    timestamp: new Date().toISOString(),
    level: ["info", "success", "warn", "error"].includes(level) ? level : "info",
    accountId,
    message: safeMessage
  };
  discordOnlinerLogs.push(entry);
  if (discordOnlinerLogs.length > 300) discordOnlinerLogs.splice(0, discordOnlinerLogs.length - 300);
  queueDiscordOnlinerLogPersist(entry);
  if (accountId) {
    const runtime = discordOnlinerRuntimes.get(accountId);
    if (runtime) queueDiscordOnlinerRuntimePersist(runtime);
  }
  const event = `data: ${JSON.stringify(entry)}\n\n`;
  for (const client of discordOnlinerLogClients) {
    try {
      client.write(event);
      client.flush?.();
    } catch {
      discordOnlinerLogClients.delete(client);
    }
  }
}

function normalizeDiscordOnlinerConfig(value = {}) {
  const sourceAccounts = Array.isArray(value.accounts)
    ? value.accounts
    : String(value.botToken ?? "").trim()
      ? [{ id: "legacy", botToken: value.botToken, proxyUrl: value.proxyUrl }]
      : [];
  const seenAccountIds = new Set();
  const accounts = sourceAccounts.map((account) => {
    const requestedId = String(account?.id ?? "").trim();
    const id = /^[a-z\d_-]{1,80}$/i.test(requestedId) && !seenAccountIds.has(requestedId)
      ? requestedId
      : crypto.randomUUID();
    seenAccountIds.add(id);
    return {
      id,
      botToken: String(account?.botToken ?? "").trim().slice(0, 2000),
      proxyUrl: normalizeDiscordOnlinerProxyUrl(account?.proxyUrl),
      richPresenceEnabled: account?.richPresenceEnabled !== false,
      discordUserId: isDiscordGuildId(String(account?.discordUserId ?? "")) ? String(account.discordUserId) : null
    };
  }).filter((account) => account.botToken).slice(0, discordOnlinerAccountLimit);
  const proxyPoolSource = Array.isArray(value.proxyPool)
    ? value.proxyPool
    : sourceAccounts.map((account) => account?.proxyUrl);
  const proxyPool = [...new Set(proxyPoolSource.map(normalizeDiscordOnlinerProxyUrl).filter(Boolean))].slice(0, 10_000);
  const status = discordOnlinerStatuses.has(String(value.status ?? "").toLowerCase())
    ? String(value.status).toLowerCase()
    : "online";
  const activityType = discordOnlinerActivityTypes.has(String(value.activityType ?? "").toLowerCase())
    ? String(value.activityType).toLowerCase()
    : "playing";
  const rotationItems = [...new Set((Array.isArray(value.rotationItems) ? value.rotationItems : defaultDiscordOnlinerGames)
    .map((item) => String(item ?? "").trim().slice(0, 128))
    .filter(Boolean))].slice(0, 100);
  const rotationMinMinutes = Math.min(Math.max(Number.parseInt(value.rotationMinMinutes ?? "30", 10) || 30, 30), 60);
  const rotationMaxMinutes = Math.min(Math.max(Number.parseInt(value.rotationMaxMinutes ?? "60", 10) || 60, rotationMinMinutes), 60);
  const connectionDelaySeconds = Math.min(Math.max(Number.parseInt(value.connectionDelaySeconds ?? "3", 10) || 3, 1), 300);
  const statuses = [...new Set((Array.isArray(value.statuses)
    ? value.statuses
    : status === "mixed" ? discordOnlinerStatusValues : [status])
    .map((item) => String(item ?? "").toLowerCase())
    .filter((item) => discordOnlinerStatusValues.includes(item)))];
  const normalizePresenceItems = (items, fallback = []) => [...new Set((Array.isArray(items) ? items : fallback)
    .map((item) => String(item ?? "").trim().slice(0, 128))
    .filter(Boolean))].slice(0, 100);
  const hasLegacyPresence = value.activityType != null || value.rotationItems != null || value.rotationEnabled != null;
  const hasGamesSetting = Object.prototype.hasOwnProperty.call(value, "games");
  const legacyActivityChances = Object.fromEntries(discordOnlinerActivityTypeValues.map((type) => [type, (activityType === "mixed" && type !== "streaming") || activityType === type ? 100 : 0]));
  const requestedChances = value.activityChances && typeof value.activityChances === "object"
    ? value.activityChances
    : hasLegacyPresence ? legacyActivityChances : { playing: 75, streaming: 50, listening: 50, watching: 50 };
  const activityChances = Object.fromEntries(discordOnlinerActivityTypeValues.map((type) => [
    type,
    Math.min(100, Math.max(0, Number.parseInt(requestedChances[type] ?? "0", 10) || 0))
  ]));
  return {
    accounts,
    proxyPool,
    enabled: value.enabled !== false,
    status,
    activityType,
    activityText: String(value.activityText ?? "Pulcip Members").trim().slice(0, 128),
    rotationEnabled: value.rotationEnabled !== false,
    rotationItems,
    rotationMinMinutes,
    rotationMaxMinutes,
    connectionDelaySeconds,
    statuses: statuses.length ? statuses : ["online"],
    activityChances,
    randomizeEnabled: value.randomizeEnabled ?? (value.rotationEnabled == null ? false : value.rotationEnabled !== false),
    spotifyPlaylistId: /^[a-z\d]{22}$/i.test(String(value.spotifyPlaylistId ?? defaultDiscordOnlinerSpotifyPlaylistId).trim())
      ? String(value.spotifyPlaylistId ?? defaultDiscordOnlinerSpotifyPlaylistId).trim()
      : "",
    youtubePlaylistId: normalizeDiscordOnlinerYouTubePlaylistId(value.youtubePlaylistId),
    games: normalizePresenceItems(
      Array.isArray(value.games) && value.games.some((item) => String(item ?? "").trim()) ? value.games : null,
      !hasGamesSetting && hasLegacyPresence && rotationItems.length ? rotationItems : defaultDiscordOnlinerGames
    ),
    music: normalizePresenceItems(value.music, [hasLegacyPresence ? value.activityText || "Spotify" : "Spotify"]),
    streamingUsers: normalizePresenceItems(value.streamingUsers, defaultDiscordOnlinerTwitchUsers),
    streamingCategories: normalizePresenceItems(value.streamingCategories, defaultDiscordOnlinerStreamingCategories),
    streamingTitles: normalizePresenceItems(value.streamingTitles, defaultDiscordOnlinerStreamingTitles),
    watch: normalizePresenceItems(value.watch).filter((item) => !["youtube", "twitch", "kick"].includes(item.toLowerCase()))
  };
}

function recordDiscordOnlinerProxyHealth(proxyUrl, success) {
  if (!proxyUrl) return;
  const current = discordOnlinerProxyHealth.get(proxyUrl) ?? { failures: 0, unavailableUntil: 0, lastSuccessAt: 0, lastFailureAt: 0, lastSelectedAt: 0 };
  if (success) {
    current.failures = 0;
    current.unavailableUntil = 0;
    current.lastSuccessAt = Date.now();
  } else {
    current.failures += 1;
    current.lastFailureAt = Date.now();
    current.unavailableUntil = Date.now() + Math.min(30 * 60_000, 60_000 * (2 ** Math.min(current.failures - 1, 5)));
  }
  discordOnlinerProxyHealth.set(proxyUrl, current);
}

function selectDiscordOnlinerProxy(config, additionalAssignments = [], excludedProxies = []) {
  const excluded = new Set(excludedProxies);
  const proxies = (Array.isArray(config?.proxyPool) ? config.proxyPool : []).filter((proxy) => !excluded.has(proxy));
  if (!proxies.length) return "";
  const usage = new Map(proxies.map((proxy) => [proxy, 0]));
  for (const proxy of [...config.accounts.map((account) => account.proxyUrl), ...additionalAssignments]) {
    if (usage.has(proxy)) usage.set(proxy, usage.get(proxy) + 1);
  }
  const now = Date.now();
  const healthy = proxies.filter((proxy) => (discordOnlinerProxyHealth.get(proxy)?.unavailableUntil ?? 0) <= now);
  const candidates = healthy.length ? healthy : proxies;
  const selected = [...candidates].sort((left, right) => {
    const usageDifference = usage.get(left) - usage.get(right);
    if (usageDifference) return usageDifference;
    const leftHealth = discordOnlinerProxyHealth.get(left);
    const rightHealth = discordOnlinerProxyHealth.get(right);
    const failureDifference = (leftHealth?.failures ?? 0) - (rightHealth?.failures ?? 0);
    if (failureDifference) return failureDifference;
    return (leftHealth?.lastSelectedAt ?? 0) - (rightHealth?.lastSelectedAt ?? 0);
  })[0];
  const health = discordOnlinerProxyHealth.get(selected) ?? { failures: 0, unavailableUntil: 0, lastSuccessAt: 0, lastFailureAt: 0, lastSelectedAt: 0 };
  health.lastSelectedAt = now + (discordOnlinerProxySelectionSequence++ % 1000);
  discordOnlinerProxyHealth.set(selected, health);
  return selected;
}

function getDiscordOnlinerProxyPoolResponse(config) {
  const usage = new Map(config.proxyPool.map((proxy) => [proxy, 0]));
  for (const account of config.accounts) {
    if (usage.has(account.proxyUrl)) usage.set(account.proxyUrl, usage.get(account.proxyUrl) + 1);
  }
  const now = Date.now();
  const details = config.proxyPool.map((proxy) => {
    const health = discordOnlinerProxyHealth.get(proxy);
    const unavailableUntil = Math.max(0, Number(health?.unavailableUntil) || 0);
    return {
      proxy,
      assignedAccounts: usage.get(proxy) ?? 0,
      status: unavailableUntil > now ? "cooling" : "available",
      failureCount: Math.max(0, Number(health?.failures) || 0),
      cooldownUntil: unavailableUntil > now ? new Date(unavailableUntil).toISOString() : null,
      lastSuccessAt: health?.lastSuccessAt ? new Date(health.lastSuccessAt).toISOString() : null,
      lastFailureAt: health?.lastFailureAt ? new Date(health.lastFailureAt).toISOString() : null
    };
  });
  const availableCount = details.filter((proxy) => proxy.status === "available").length;
  return {
    proxies: config.proxyPool,
    details,
    count: config.proxyPool.length,
    availableCount,
    coolingDownCount: config.proxyPool.length - availableCount,
    assignedAccounts: config.accounts.filter((account) => Boolean(account.proxyUrl)).length
  };
}

function normalizeDiscordOnlinerYouTubePlaylistId(value) {
  const input = String(value ?? "").trim();
  if (!input) return "";
  try {
    const parsed = new URL(input.startsWith("http") ? input : `https://www.youtube.com/playlist?list=${encodeURIComponent(input)}`);
    const playlistId = String(parsed.searchParams.get("list") ?? "");
    return /^[a-z\d_-]{10,80}$/i.test(playlistId) ? playlistId : "";
  } catch {
    return "";
  }
}

function decodeDiscordOnlinerHtmlText(value) {
  const namedEntities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

async function getDiscordOnlinerSpotifyTracks(playlistId) {
  if (!playlistId) return [];
  const cached = discordOnlinerSpotifyPlaylistCache.get(playlistId);
  if (cached && cached.expiresAt > Date.now()) return cached.tracks;
  try {
    const response = await fetch(`https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PLCP-Onliner/1.0)" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Spotify embed returned ${response.status}`);
    const html = await response.text();
    const nextData = html.match(/<script\b[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    let tracks = [];
    let playlistCoverUrl = "";
    if (nextData) {
      try {
        const entity = JSON.parse(nextData)?.props?.pageProps?.state?.data?.entity;
        const entityTracks = entity?.trackList;
        playlistCoverUrl = String(entity?.coverArt?.sources?.[0]?.url ?? "").trim();
        tracks = (Array.isArray(entityTracks) ? entityTracks : []).map((track) => ({
          title: String(track?.title ?? "").trim().slice(0, 128),
          artist: String(track?.subtitle ?? "").replace(/\u00a0/g, " ").trim().slice(0, 128),
          trackId: String(track?.uri ?? "").match(/^spotify:track:([a-z\d]+)$/i)?.[1] ?? "",
          duration: Math.max(0, Number(track?.duration) || 0),
          coverUrl: playlistCoverUrl
        })).filter((track) => track.title).slice(0, 100);
      } catch {
        // Fall through to the rendered track rows when Spotify changes its state payload.
      }
    }
    if (!tracks.length) {
      const rows = html.match(/<li\b[^>]*data-testid="tracklist-row-[^"]+"[\s\S]*?<\/li>/gi) ?? [];
      tracks = rows.map((row) => {
        const title = decodeDiscordOnlinerHtmlText(row.match(/<h3\b[^>]*TracklistRow_title[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
        const artistHtml = row.match(/<h4\b[^>]*TracklistRow_subtitle[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? "";
        const artist = decodeDiscordOnlinerHtmlText(artistHtml.replace(/<span\b[^>]*data-testid="tag"[^>]*>[\s\S]*?<\/span>/gi, ""));
        return { title, artist, trackId: "", duration: 0, coverUrl: playlistCoverUrl };
      }).filter((track) => track.title).slice(0, 100);
    }
    await forEachWithConcurrency(tracks.filter((track) => track.trackId), 8, async (track) => {
      try {
        const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${track.trackId}`)}`, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; PLCP-Onliner/1.0)" },
          signal: AbortSignal.timeout(5_000)
        });
        if (!response.ok) return;
        const metadata = await response.json().catch(() => null);
        const coverUrl = String(metadata?.thumbnail_url ?? "").trim();
        if (coverUrl) track.coverUrl = coverUrl;
      } catch {
        // Keep the playlist artwork as a fallback if Spotify's track metadata is unavailable.
      }
    });
    discordOnlinerSpotifyPlaylistCache.set(playlistId, { tracks, expiresAt: Date.now() + 30 * 60_000 });
    appendDiscordOnlinerLog(tracks.length ? "success" : "warn", tracks.length
      ? `Spotify playlist loaded: ${tracks.length} tracks are available for Listening.`
      : "Spotify playlist loaded but did not contain any usable tracks.");
    return tracks;
  } catch (error) {
    discordOnlinerSpotifyPlaylistCache.set(playlistId, { tracks: [], expiresAt: Date.now() + 5 * 60_000 });
    appendDiscordOnlinerLog("warn", `Spotify playlist could not be loaded: ${error instanceof Error ? error.message : "unknown error"}.`);
    return [];
  }
}

async function getDiscordOnlinerYouTubeVideos(playlistId) {
  if (!playlistId) return [];
  const cached = discordOnlinerYouTubePlaylistCache.get(playlistId);
  if (cached && cached.expiresAt > Date.now()) return cached.videos;
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PLCP-Onliner/1.0)" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`YouTube playlist feed returned ${response.status}`);
    const xml = await response.text();
    const videos = (xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? []).map((entry) => {
      const videoId = decodeDiscordOnlinerHtmlText(entry.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/i)?.[1]);
      const title = decodeDiscordOnlinerHtmlText(entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1]).slice(0, 128);
      const channel = decodeDiscordOnlinerHtmlText(entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i)?.[1]).slice(0, 128);
      const thumbnailUrl = decodeDiscordOnlinerHtmlText(entry.match(/<media:thumbnail\b[^>]*url="([^"]+)"/i)?.[1]);
      return {
        videoId,
        title,
        channel,
        thumbnailUrl,
        url: videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : ""
      };
    }).filter((video) => /^[a-z\d_-]{11}$/i.test(video.videoId) && video.title).slice(0, 50);
    discordOnlinerYouTubePlaylistCache.set(playlistId, { videos, expiresAt: Date.now() + 30 * 60_000 });
    appendDiscordOnlinerLog(videos.length ? "success" : "warn", videos.length
      ? `YouTube playlist loaded: ${videos.length} videos are available for Watching.`
      : "YouTube playlist feed loaded but did not contain any usable videos.");
    return videos;
  } catch (error) {
    discordOnlinerYouTubePlaylistCache.set(playlistId, { videos: [], expiresAt: Date.now() + 5 * 60_000 });
    appendDiscordOnlinerLog("warn", `YouTube playlist could not be loaded: ${error instanceof Error ? error.message : "unknown error"}.`);
    return [];
  }
}

async function hydrateDiscordOnlinerSpotifyPlaylist(config) {
  const [tracks] = await Promise.all([
    config.spotifyPlaylistId ? getDiscordOnlinerSpotifyTracks(config.spotifyPlaylistId) : Promise.resolve([]),
    config.youtubePlaylistId ? getDiscordOnlinerYouTubeVideos(config.youtubePlaylistId) : Promise.resolve([]),
    getDiscordOnlinerApplicationCatalog()
  ]);
  return tracks.length
    ? { ...config, music: tracks.map((track) => [track.title, track.artist].filter(Boolean).join(" — ").slice(0, 128)) }
    : config;
}

function normalizeDiscordOnlinerApplicationName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[^a-z\d]+/g, " ")
    .trim();
}

async function getDiscordOnlinerApplicationCatalog() {
  if (discordOnlinerApplicationCatalogCache.expiresAt > Date.now()) return discordOnlinerApplicationCatalogCache.index;
  if (discordOnlinerApplicationCatalogCache.pending) return discordOnlinerApplicationCatalogCache.pending;
  discordOnlinerApplicationCatalogCache.pending = (async () => {
    try {
      const response = await fetch("https://discord.com/api/v10/applications/detectable", {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PLCP-Onliner/1.0)" },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`Discord application catalog returned ${response.status}`);
      const applications = await response.json();
      const index = new Map();
      for (const application of Array.isArray(applications) ? applications : []) {
        const id = String(application?.id ?? "");
        if (!/^\d+$/.test(id)) continue;
        for (const name of [application?.name, ...(Array.isArray(application?.aliases) ? application.aliases : [])]) {
          const key = normalizeDiscordOnlinerApplicationName(name);
          if (key && !index.has(key)) index.set(key, { id, name: String(application?.name ?? name) });
        }
      }
      discordOnlinerApplicationCatalogCache = { index, expiresAt: Date.now() + 24 * 60 * 60_000, pending: null };
      return index;
    } catch {
      discordOnlinerApplicationCatalogCache.pending = null;
      return discordOnlinerApplicationCatalogCache.index;
    }
  })();
  return discordOnlinerApplicationCatalogCache.pending;
}

function findDiscordOnlinerApplication(value) {
  const requestedName = normalizeDiscordOnlinerApplicationName(value);
  const compatibleName = discordOnlinerApplicationAliases.get(requestedName) ?? requestedName;
  return discordOnlinerApplicationCatalogCache.index.get(requestedName)
    ?? discordOnlinerApplicationCatalogCache.index.get(compatibleName)
    ?? null;
}

function normalizeDiscordOnlinerProxyUrl(value) {
  let proxyUrl = String(value ?? "").trim();
  if (!proxyUrl || proxyUrl.length > 2000) return "";

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(proxyUrl)) {
    const parts = proxyUrl.split(":");
    if (parts.length === 4 && parts.every(Boolean)) {
      const [host, port, username, password] = parts;
      proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    } else {
      proxyUrl = `http://${proxyUrl}`;
    }
  }

  try {
    const parsed = new URL(proxyUrl);
    if (!discordOnlinerProxyProtocols.has(parsed.protocol) || !parsed.hostname) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeDiscordOnlinerBulkBotToken(value) {
  const input = String(value ?? "").trim();
  const parts = input.split(":");
  return (parts.length >= 3 ? parts.slice(2).join(":") : input).trim();
}

function createDiscordOnlinerProxyAgent(proxyUrl) {
  return proxyUrl.startsWith("socks")
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);
}

function getDiscordOnlinerProxyEndpoint(proxyUrl) {
  try {
    const parsed = new URL(proxyUrl);
    const defaultPort = ["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(parsed.protocol)
      ? "1080"
      : parsed.protocol === "https:" ? "443" : "80";
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || defaultPort}`;
  } catch {
    return "saved proxy";
  }
}

function formatDiscordOnlinerSocketAddress(address, port) {
  if (!address) return "unknown";
  const host = String(address).includes(":") && !String(address).startsWith("[") ? `[${address}]` : String(address);
  return port ? `${host}:${port}` : host;
}

async function getDiscordOnlinerConfig() {
  const raw = await loadEncryptedSetting(discordOnlinerSettingKey);
  if (!raw) return hydrateDiscordOnlinerSpotifyPlaylist(normalizeDiscordOnlinerConfig({ enabled: false, activityText: "Pulcip Members" }));
  try {
    return hydrateDiscordOnlinerSpotifyPlaylist(normalizeDiscordOnlinerConfig(JSON.parse(raw)));
  } catch {
    return hydrateDiscordOnlinerSpotifyPlaylist(normalizeDiscordOnlinerConfig({ enabled: false, activityText: "Pulcip Members" }));
  }
}

function buildDiscordOnlinerSnapshot(config, accounts, logs, worker) {
  const connectedAccounts = accounts.filter((account) => account.connectionState === "connected");
  const firstAccount = accounts[0] ?? null;
  const nextConnectionAt = accounts
    .map((account) => account.nextQueuedConnectionAt)
    .filter(Boolean)
    .sort()[0] ?? null;
  const aggregateState = !accounts.length
    ? "disconnected"
    : connectedAccounts.length === accounts.length
      ? "connected"
      : accounts.some((account) => account.connectionState === "connecting")
        ? "connecting"
        : accounts.some((account) => account.connectionState === "reconnecting")
          ? "reconnecting"
          : accounts.some((account) => account.connectionState === "error") ? "error" : "disconnected";
  return {
    configured: accounts.length > 0,
    hasBotToken: accounts.length > 0,
    hasProxy: accounts.some((account) => account.hasProxy),
    accounts,
    connectedCount: connectedAccounts.length,
    nextConnectionAt,
    enabled: Boolean(config.enabled),
    status: config.status,
    activityType: config.activityType,
    activityText: config.activityText,
    rotationEnabled: config.rotationEnabled,
    rotationItems: config.rotationItems,
    rotationMinMinutes: config.rotationMinMinutes,
    rotationMaxMinutes: config.rotationMaxMinutes,
    connectionDelaySeconds: config.connectionDelaySeconds,
    statuses: config.statuses,
    activityChances: config.activityChances,
    randomizeEnabled: config.randomizeEnabled,
    spotifyPlaylistId: config.spotifyPlaylistId,
    youtubePlaylistId: config.youtubePlaylistId,
    games: config.games,
    music: config.music,
    streamingUsers: config.streamingUsers,
    streamingCategories: config.streamingCategories,
    streamingTitles: config.streamingTitles,
    watch: config.watch,
    currentActivity: firstAccount?.currentActivity ?? null,
    connectionState: aggregateState,
    bot: firstAccount?.bot ?? null,
    guildCount: accounts.reduce((total, account) => total + account.guildCount, 0),
    connectedAt: firstAccount?.connectedAt ?? null,
    lastDisconnectedAt: firstAccount?.lastDisconnectedAt ?? null,
    lastError: accounts.find((account) => account.lastError)?.lastError ?? null,
    reconnectAttempt: accounts.reduce((total, account) => total + account.reconnectAttempt, 0),
    logs,
    worker
  };
}

function getDiscordOnlinerSnapshot(config) {
  const accounts = config.accounts.map((account) => {
    const runtime = discordOnlinerRuntimes.get(account.id) ?? createDiscordOnlinerRuntime(account.id);
    return {
      id: account.id,
      hasBotToken: Boolean(account.botToken),
      hasProxy: Boolean(account.proxyUrl),
      richPresenceEnabled: account.richPresenceEnabled !== false,
      ...serializeDiscordOnlinerRuntime(runtime)
    };
  });
  return buildDiscordOnlinerSnapshot(config, accounts, discordOnlinerLogs.slice(-100), {
    status: serviceRunsOnliner ? "online" : "offline",
    heartbeatAt: serviceRunsOnliner ? new Date().toISOString() : null,
    connectionPaused: discordOnlinerConnectionsPaused
  });
}

async function getDiscordOnlinerSnapshotForApi(config) {
  if (serviceRunsOnliner) return getDiscordOnlinerSnapshot(config);
  const [runtimeResult, logsResult, workerResult] = await Promise.all([
    pool.query("SELECT account_id, payload FROM discord_onliner_runtime WHERE account_id = ANY($1::text[])", [config.accounts.map((account) => account.id)]),
    pool.query("SELECT id, timestamp, level, account_id, message FROM discord_onliner_persisted_logs ORDER BY id DESC LIMIT 100"),
    pool.query("SELECT worker_id, status, started_at, heartbeat_at, last_error, connection_paused FROM discord_onliner_worker_state WHERE singleton = TRUE LIMIT 1")
  ]);
  const runtimeByAccountId = new Map(runtimeResult.rows.map((row) => [String(row.account_id), row.payload ?? {}]));
  const workerRow = workerResult.rows[0] ?? {};
  const heartbeatAt = workerRow.heartbeat_at ? new Date(workerRow.heartbeat_at).toISOString() : null;
  const heartbeatAge = heartbeatAt ? Date.now() - new Date(heartbeatAt).getTime() : Number.POSITIVE_INFINITY;
  const workerOnline = workerRow.status === "online" && heartbeatAge < discordOnlinerWorkerHeartbeatMs * 3;
  const accounts = config.accounts.map((account) => {
    const saved = runtimeByAccountId.get(account.id) ?? {};
    return {
      id: account.id,
      hasBotToken: Boolean(account.botToken),
      hasProxy: Boolean(account.proxyUrl),
      richPresenceEnabled: account.richPresenceEnabled !== false,
      currentActivity: saved.currentActivity ?? null,
      connectionState: workerOnline ? saved.connectionState ?? "disconnected" : "disconnected",
      bot: saved.bot ?? null,
      guildCount: Math.max(0, Number(saved.guildCount) || 0),
      connectedAt: workerOnline ? saved.connectedAt ?? null : null,
      lastDisconnectedAt: saved.lastDisconnectedAt ?? null,
      lastError: workerOnline ? saved.lastError ?? null : "Onliner worker is offline.",
      reconnectAttempt: Math.max(0, Number(saved.reconnectAttempt) || 0),
      nextQueuedConnectionAt: workerOnline ? saved.nextQueuedConnectionAt ?? null : null
    };
  });
  const logs = logsResult.rows.reverse().map((row) => ({
    id: Number(row.id),
    timestamp: new Date(row.timestamp).toISOString(),
    level: row.level,
    accountId: row.account_id,
    message: row.message
  }));
  return buildDiscordOnlinerSnapshot(config, accounts, logs, {
    status: workerOnline ? "online" : workerRow.status === "standby" ? "standby" : "offline",
    workerId: workerRow.worker_id ?? null,
    startedAt: workerRow.started_at ? new Date(workerRow.started_at).toISOString() : null,
    heartbeatAt,
    lastError: workerRow.last_error ?? null,
    connectionPaused: workerRow.connection_paused === true
  });
}

function clearDiscordOnlinerTimers(runtime) {
  if (runtime.startupTimer) clearTimeout(runtime.startupTimer);
  if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
  if (runtime.reconnectTimer) clearTimeout(runtime.reconnectTimer);
  if (runtime.activityTimer) clearTimeout(runtime.activityTimer);
  if (runtime.connectionQueueTimer) clearTimeout(runtime.connectionQueueTimer);
  runtime.startupTimer = null;
  runtime.heartbeatTimer = null;
  runtime.reconnectTimer = null;
  runtime.activityTimer = null;
  runtime.connectionQueueTimer = null;
  runtime.connectionQueueContinuation = null;
  runtime.connectionQueueStartNext = null;
  runtime.nextQueuedConnectionAt = null;
}

function stopDiscordOnlinerRuntime(runtime, { resetIdentity = false } = {}) {
  runtime.generation += 1;
  clearDiscordOnlinerTimers(runtime);
  const socket = runtime.socket;
  runtime.socket = null;
  runtime.state = "disconnected";
  runtime.connectedAt = null;
  runtime.hasConnectedOnce = false;
  runtime.reconnectAttempt = 0;
  runtime.automaticReconnectBlocked = false;
  runtime.reconnectNotBefore = 0;
  runtime.sequence = null;
  runtime.sessionId = null;
  runtime.resumeGatewayUrl = null;
  runtime.guildIds = new Set();
  runtime.currentActivity = null;
  runtime.currentActivities = null;
  runtime.currentStatus = null;
  runtime.currentActivityType = null;
  if (resetIdentity) runtime.bot = null;
  try {
    if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) {
      appendDiscordOnlinerLog("info", "Stopping the active Gateway connection.", runtime.accountId);
      socket.close(1000, "Onliner stopped");
    }
  } catch {
    // The socket may already be closed.
  }
  queueDiscordOnlinerRuntimePersist(runtime);
}

function stopDiscordOnliner({ resetIdentity = false } = {}) {
  for (const runtime of discordOnlinerRuntimes.values()) stopDiscordOnlinerRuntime(runtime, { resetIdentity });
}

function advanceDiscordOnlinerConnectionQueue(runtime, outcome) {
  const continueConnectionQueue = runtime.connectionQueueContinuation;
  runtime.connectionQueueContinuation = null;
  if (continueConnectionQueue) continueConnectionQueue(outcome);
}

function triggerNextDiscordOnlinerQueuedConnection(runtime) {
  const startNext = runtime.connectionQueueStartNext;
  if (!startNext) return false;
  runtime.connectionQueueStartNext = null;
  if (runtime.connectionQueueTimer) clearTimeout(runtime.connectionQueueTimer);
  runtime.connectionQueueTimer = null;
  runtime.nextQueuedConnectionAt = null;
  queueDiscordOnlinerRuntimePersist(runtime);
  appendDiscordOnlinerLog("info", "Connection delay elapsed; starting the next bot.", runtime.accountId);
  startNext();
  return true;
}

function scheduleDiscordOnlinerReconnect(config, account, runtime, generation) {
  const activeConfig = runtime.config ?? config;
  const activeAccount = activeConfig.accounts.find((item) => item.id === account.id) ?? account;
  if (generation !== runtime.generation || !activeConfig.enabled || !activeAccount.botToken) return;
  if (discordOnlinerConnectionsPaused) {
    runtime.state = "disconnected";
    queueDiscordOnlinerRuntimePersist(runtime);
    return;
  }
  if (runtime.automaticReconnectBlocked) {
    runtime.state = "error";
    queueDiscordOnlinerRuntimePersist(runtime);
    advanceDiscordOnlinerConnectionQueue(runtime, "failed");
    return;
  }
  if (runtime.reconnectAttempt >= discordOnlinerMaxReconnectAttempts) {
    runtime.automaticReconnectBlocked = true;
    runtime.state = "error";
    runtime.lastError = `Automatic reconnect stopped after ${discordOnlinerMaxReconnectAttempts} failed attempts. Check the bot token and proxy, then use Continue or Start.`;
    appendDiscordOnlinerLog("error", `[RECONNECT_LIMIT] ${runtime.lastError}`, account.id);
    queueDiscordOnlinerRuntimePersist(runtime);
    advanceDiscordOnlinerConnectionQueue(runtime, "failed");
    return;
  }
  runtime.reconnectAttempt += 1;
  runtime.state = "reconnecting";
  const backoffDelay = Math.min(60_000, 1_000 * (2 ** Math.min(6, runtime.reconnectAttempt - 1)));
  const cooldownDelay = Math.max(0, runtime.reconnectNotBefore - Date.now());
  const delay = Math.max(backoffDelay, cooldownDelay);
  appendDiscordOnlinerLog("warn", `Reconnect attempt ${runtime.reconnectAttempt} scheduled in ${Math.round(delay / 1000)}s.`, account.id);
  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    const latestConfig = runtime.config ?? activeConfig;
    const latestAccount = latestConfig.accounts.find((item) => item.id === activeAccount.id) ?? activeAccount;
    connectDiscordOnliner(latestConfig, latestAccount, runtime, generation);
  }, delay);
  runtime.reconnectTimer.unref?.();
}

function chooseDiscordOnlinerActivity(candidates, currentValue = null) {
  if (!candidates.length) return null;
  const alternatives = candidates.length > 1
    ? candidates.filter((item) => item !== currentValue)
    : candidates;
  return alternatives[Math.floor(Math.random() * alternatives.length)] ?? candidates[0];
}

function chooseDiscordOnlinerVariant(values, currentValue) {
  const alternatives = values.length > 1 ? values.filter((value) => value !== currentValue) : values;
  return alternatives[Math.floor(Math.random() * alternatives.length)] ?? values[0];
}

function chooseDiscordOnlinerStatus(config, runtime) {
  const statuses = Array.isArray(config.statuses) && config.statuses.length ? config.statuses : ["online"];
  if (statuses.length === 1) return statuses[0];
  const usage = new Map(statuses.map((status) => [status, 0]));
  for (const candidate of discordOnlinerRuntimes.values()) {
    if (candidate === runtime || candidate.state !== "connected" || !usage.has(candidate.currentStatus)) continue;
    usage.set(candidate.currentStatus, usage.get(candidate.currentStatus) + 1);
  }
  const minimumUsage = Math.min(...usage.values());
  const leastUsed = statuses.filter((status) => usage.get(status) === minimumUsage);
  return chooseDiscordOnlinerVariant(leastUsed, runtime.currentStatus);
}

function getDiscordOnlinerRandomPlayingStart() {
  const minimumElapsedMs = 3 * 60_000;
  const maximumElapsedMs = 6 * 60 * 60_000;
  return Date.now() - Math.round(minimumElapsedMs + Math.random() * (maximumElapsedMs - minimumElapsedMs));
}

function getDiscordOnlinerSpotifyImageKey(value) {
  const imageId = String(value ?? "").match(/\/image\/([a-z\d]+)(?:[/?#]|$)/i)?.[1];
  return imageId ? `spotify:${imageId}` : undefined;
}

function buildDiscordOnlinerSpotifyActivity(track, runtime) {
  const now = Date.now();
  const duration = Math.max(0, Number(track.duration) || 0);
  const elapsed = duration > 30_000
    ? Math.min(duration - 10_000, Math.max(10_000, Math.round(duration * (0.08 + Math.random() * 0.42))))
    : 0;
  const spotifyUserId = String(runtime.bot?.id ?? runtime.accountId ?? "").replace(/[^a-z\d_-]/gi, "");
  const largeImage = getDiscordOnlinerSpotifyImageKey(track.coverUrl);
  return {
    name: "Spotify",
    type: discordOnlinerActivityCodes.listening,
    details: String(track.title ?? "").trim().slice(0, 128) || "Unknown track",
    state: String(track.artist ?? "").trim().slice(0, 128) || "Unknown artist",
    ...(duration ? { timestamps: { start: now - elapsed, end: now - elapsed + duration } } : {}),
    ...(track.trackId ? { sync_id: track.trackId } : {}),
    ...(spotifyUserId ? {
      session_id: `spotify:${spotifyUserId}`,
      party: { id: `spotify:${spotifyUserId}` }
    } : {}),
    ...(largeImage ? { assets: { large_image: largeImage, large_text: String(track.title ?? "Spotify").slice(0, 128) } } : {}),
    flags: 48
  };
}

function buildDiscordOnlinerPresence(config, runtime, chooseNext = false) {
  if (chooseNext || !runtime.currentStatus) {
    runtime.currentStatus = chooseDiscordOnlinerStatus(config, runtime);
  }
  if (chooseNext || !runtime.currentActivities) {
    const activities = [];
    const addActivity = (type, values, extras = {}) => {
      if (!values.length || Math.random() * 100 >= config.activityChances[type]) return;
      const previous = runtime.currentActivities?.find((activity) => activity.type === discordOnlinerActivityCodes[type])?.name;
      const name = chooseDiscordOnlinerActivity(values, previous);
      const application = findDiscordOnlinerApplication(name);
      if (name) activities.push({
        name,
        type: discordOnlinerActivityCodes[type],
        ...(application ? { application_id: application.id } : {}),
        ...extras
      });
    };
    addActivity("playing", config.games, { timestamps: { start: getDiscordOnlinerRandomPlayingStart() } });
    if (config.streamingUsers.length) {
      const user = chooseDiscordOnlinerActivity(config.streamingUsers);
      const title = chooseDiscordOnlinerActivity(config.streamingTitles.length ? config.streamingTitles : ["Live on Twitch"], runtime.currentActivity);
      const category = chooseDiscordOnlinerActivity(config.streamingCategories);
      if (user && title && Math.random() * 100 < config.activityChances.streaming) {
        activities.push({
          name: "Twitch",
          type: discordOnlinerActivityCodes.streaming,
          url: `https://www.twitch.tv/${encodeURIComponent(user)}`,
          details: title.slice(0, 128),
          state: category || undefined,
          assets: {
            large_image: `twitch:${user}`,
            large_text: title.slice(0, 128)
          }
        });
      }
    }
    if (Math.random() * 100 < config.activityChances.listening) {
      const spotifyTracks = discordOnlinerSpotifyPlaylistCache.get(config.spotifyPlaylistId)?.tracks ?? [];
      const previousListeningActivity = runtime.currentActivities?.find((activity) => activity.type === discordOnlinerActivityCodes.listening);
      const previousTrackId = previousListeningActivity?.sync_id;
      const previousTrackName = [previousListeningActivity?.details, previousListeningActivity?.state].filter(Boolean).join(" — ");
      const track = chooseDiscordOnlinerActivity(spotifyTracks.filter((item) => item.trackId
        ? item.trackId !== previousTrackId
        : [item.title, item.artist].filter(Boolean).join(" — ") !== previousTrackName), null)
        ?? chooseDiscordOnlinerActivity(spotifyTracks, null);
      if (track) {
        activities.push(buildDiscordOnlinerSpotifyActivity(track, runtime));
      } else {
        const fallback = chooseDiscordOnlinerActivity(config.music);
        if (fallback) {
          activities.push({
            name: "Spotify",
            type: discordOnlinerActivityCodes.listening,
            details: fallback.slice(0, 128),
            state: "Spotify"
          });
        }
      }
    }
    if (Math.random() * 100 < config.activityChances.watching) {
      const youtubeVideos = discordOnlinerYouTubePlaylistCache.get(config.youtubePlaylistId)?.videos ?? [];
      const youtubeItems = youtubeVideos.map((video) => ({
        name: video.title,
        state: ["YouTube", video.channel].filter(Boolean).join(" · ").slice(0, 128),
        url: video.url
      }));
      const twitchItems = config.streamingUsers.map((user) => {
        const title = chooseDiscordOnlinerActivity(config.streamingTitles, null) || `${user}'s stream`;
        const category = chooseDiscordOnlinerActivity(config.streamingCategories, null);
        return {
          name: title.slice(0, 128),
          state: ["Twitch", category, user].filter(Boolean).join(" · ").slice(0, 128),
          url: `https://www.twitch.tv/${encodeURIComponent(user)}`
        };
      });
      const previousUrl = runtime.currentActivities?.find((activity) => activity.type === discordOnlinerActivityCodes.watching)?.url;
      const source = chooseDiscordOnlinerActivity([youtubeItems, twitchItems].filter((items) => items.length), null) ?? [];
      const item = chooseDiscordOnlinerActivity(source.filter((candidate) => candidate.url !== previousUrl), null)
        ?? chooseDiscordOnlinerActivity(source, null);
      if (item) {
        activities.push({
          name: item.name,
          type: discordOnlinerActivityCodes.watching,
          state: item.state,
          url: item.url
        });
      } else if (config.youtubePlaylistId) {
        activities.push({
          name: "YouTube",
          type: discordOnlinerActivityCodes.watching,
          state: "Watching playlist videos",
          url: `https://www.youtube.com/playlist?list=${encodeURIComponent(config.youtubePlaylistId)}`
        });
      }
    }
    runtime.currentActivities = activities;
    runtime.currentActivity = activities.map((activity) => activity.type === discordOnlinerActivityCodes.watching
        ? [activity.name, activity.state].filter(Boolean).join(" — ")
        : activity.type === discordOnlinerActivityCodes.streaming
          ? [activity.name, activity.details, activity.state].filter(Boolean).join(" — ")
        : activity.type === discordOnlinerActivityCodes.listening
          ? [activity.details, activity.state].filter(Boolean).join(" — ")
          : activity.name).join(" · ") || null;
    runtime.currentActivityType = activities.map((activity) => discordOnlinerActivityTypeValues.find((type) => discordOnlinerActivityCodes[type] === activity.type)).filter(Boolean).join(", ") || "none";
  }
  return { since: null, activities: runtime.currentActivities, status: runtime.currentStatus, afk: false };
}

function buildDiscordOnlinerAccountPresence(config, account, runtime, chooseNext = false) {
  if (account.richPresenceEnabled !== false) return buildDiscordOnlinerPresence(config, runtime, chooseNext);
  if (chooseNext || !runtime.currentStatus) {
    runtime.currentStatus = chooseDiscordOnlinerStatus(config, runtime);
  }
  runtime.currentActivities = [];
  runtime.currentActivity = null;
  runtime.currentActivityType = "none";
  return { since: null, activities: [], status: runtime.currentStatus, afk: false };
}

function scheduleDiscordOnlinerActivityRotation(config, account, runtime, generation) {
  if (runtime.activityTimer) clearTimeout(runtime.activityTimer);
  runtime.activityTimer = null;
  if (generation !== runtime.generation || account.richPresenceEnabled === false || !config.randomizeEnabled) return;
  const intervalMinutes = config.rotationMinMinutes + Math.random() * (config.rotationMaxMinutes - config.rotationMinMinutes);
  runtime.activityTimer = setTimeout(() => {
    if (generation !== runtime.generation || runtime.socket?.readyState !== WebSocket.OPEN) return;
    runtime.socket.send(JSON.stringify({
      op: 3,
      d: buildDiscordOnlinerAccountPresence(config, account, runtime, true)
    }));
    appendDiscordOnlinerLog("info", `Presence changed: ${runtime.currentStatus}, ${runtime.currentActivityType}${runtime.currentActivity ? ` · ${runtime.currentActivity}` : ""}.`, runtime.accountId);
    scheduleDiscordOnlinerActivityRotation(config, account, runtime, generation);
  }, Math.round(intervalMinutes * 60_000));
  runtime.activityTimer.unref?.();
}

function applyDiscordOnlinerAccountPresenceLive(config, account, message = "Rich Presence updated without reconnecting.") {
  const runtime = discordOnlinerRuntimes.get(account.id);
  if (!runtime) return false;
  runtime.config = config;
  if (runtime.state !== "connected" || runtime.socket?.readyState !== WebSocket.OPEN) return false;
  runtime.socket.send(JSON.stringify({
    op: 3,
    d: buildDiscordOnlinerAccountPresence(config, account, runtime, true)
  }));
  scheduleDiscordOnlinerActivityRotation(config, account, runtime, runtime.generation);
  queueDiscordOnlinerRuntimePersist(runtime);
  appendDiscordOnlinerLog("info", message, account.id);
  return true;
}

function connectDiscordOnliner(config, account, runtime, generation) {
  if (generation !== runtime.generation || !config.enabled || !account.botToken || !account.proxyUrl) return;
  runtime.startupTimer = null;
  runtime.state = runtime.reconnectAttempt ? "reconnecting" : "connecting";
  const defaultGatewayUrl = "wss://gateway.discord.gg/?v=10&encoding=json";
  let gatewayUrl = defaultGatewayUrl;
  let shouldResume = false;
  if (runtime.sessionId && Number.isInteger(runtime.sequence) && runtime.resumeGatewayUrl) {
    try {
      const resumeUrl = new URL(runtime.resumeGatewayUrl);
      if (resumeUrl.protocol !== "wss:") throw new Error("Invalid resume protocol");
      resumeUrl.searchParams.set("v", "10");
      resumeUrl.searchParams.set("encoding", "json");
      gatewayUrl = resumeUrl.toString();
      shouldResume = true;
    } catch {
      runtime.sequence = null;
      runtime.sessionId = null;
      runtime.resumeGatewayUrl = null;
    }
  }
  const parsedGatewayUrl = new URL(gatewayUrl);
  const gatewayEndpoint = `${parsedGatewayUrl.protocol}//${parsedGatewayUrl.hostname}:${parsedGatewayUrl.port || "443"}`;
  const proxyEndpoint = account.proxyUrl ? getDiscordOnlinerProxyEndpoint(account.proxyUrl) : null;
  appendDiscordOnlinerLog("info", proxyEndpoint
    ? `Outbound route: ${proxyEndpoint} -> ${gatewayEndpoint}.`
    : `Outbound route: direct -> ${gatewayEndpoint}.`, account.id);
  const socket = new WebSocket(gatewayUrl, {
    agent: account.proxyUrl ? createDiscordOnlinerProxyAgent(account.proxyUrl) : undefined
  });
  runtime.socket = socket;
  let sequence = shouldResume ? runtime.sequence : null;
  let transportOpened = false;

  socket.on("upgrade", (response) => {
    if (generation === runtime.generation) appendDiscordOnlinerLog("success", proxyEndpoint
      ? `Proxy route reached Discord; Gateway HTTP upgrade accepted (${response.statusCode ?? 101}).`
      : `Direct route reached Discord; Gateway HTTP upgrade accepted (${response.statusCode ?? 101}).`, account.id);
  });
  socket.on("unexpected-response", (_request, response) => {
    if (generation !== runtime.generation) return;
    const statusCode = Number(response.statusCode) || 0;
    if (account.proxyUrl) recordDiscordOnlinerProxyHealth(account.proxyUrl, statusCode !== 407);
    if (statusCode === 407) {
      runtime.automaticReconnectBlocked = true;
      runtime.state = "error";
      runtime.lastError = "Proxy authentication failed (HTTP 407). Automatic reconnect stopped until the proxy credentials change or Start/Continue is used.";
      appendDiscordOnlinerLog("error", `[407] ${runtime.lastError}`, account.id);
    } else if (statusCode === 429) {
      const retryAfterHeader = Array.isArray(response.headers?.["retry-after"])
        ? response.headers["retry-after"][0]
        : response.headers?.["retry-after"];
      const retryAfterSeconds = Math.max(0, Number.parseFloat(String(retryAfterHeader ?? "0")) || 0);
      const cooldownMs = Math.max(discordOnlinerRateLimitCooldownMs, Math.ceil(retryAfterSeconds * 1_000));
      runtime.reconnectNotBefore = Date.now() + cooldownMs;
      runtime.lastError = `Discord Gateway returned HTTP 429. Reconnect delayed for ${Math.ceil(cooldownMs / 1000)} seconds.`;
      appendDiscordOnlinerLog("warn", `[429] ${runtime.lastError}`, account.id);
    } else {
      runtime.lastError = `Discord Gateway returned unexpected HTTP status ${statusCode || "unknown"}.`;
      appendDiscordOnlinerLog("error", runtime.lastError, account.id);
    }
    queueDiscordOnlinerRuntimePersist(runtime);
    response.resume();
    response.destroy();
    try { socket.terminate(); } catch {}
  });
  socket.on("open", () => {
    if (generation !== runtime.generation) return;
    transportOpened = true;
    if (account.proxyUrl) recordDiscordOnlinerProxyHealth(account.proxyUrl, true);
    const networkSocket = socket._socket;
    const localAddress = formatDiscordOnlinerSocketAddress(networkSocket?.localAddress, networkSocket?.localPort);
    const peerAddress = formatDiscordOnlinerSocketAddress(networkSocket?.remoteAddress, networkSocket?.remotePort);
    appendDiscordOnlinerLog("success", `WebSocket open; TCP ${localAddress} -> ${peerAddress}; target ${gatewayEndpoint}${proxyEndpoint ? ` via ${proxyEndpoint}` : ""}.`, account.id);
  });
  socket.on("ping", () => {
    if (generation === runtime.generation) appendDiscordOnlinerLog("info", "WebSocket PING received; PONG handled automatically.", account.id);
  });
  socket.on("pong", () => {
    if (generation === runtime.generation) appendDiscordOnlinerLog("info", "WebSocket PONG received.", account.id);
  });

  socket.on("message", (raw) => {
    if (generation !== runtime.generation) return;
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      appendDiscordOnlinerLog("warn", `Ignored a non-JSON Gateway frame (${raw.length ?? 0} bytes).`, account.id);
      return;
    }
    if (Number.isInteger(payload?.s)) {
      sequence = payload.s;
      runtime.sequence = payload.s;
    }
    if (payload?.op === 10) {
      const interval = Math.max(1_000, Number(payload?.d?.heartbeat_interval) || 45_000);
      appendDiscordOnlinerLog("info", `Gateway HELLO received; heartbeat interval is ${Math.round(interval / 1000)}s.`, account.id);
      const heartbeat = () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        if (!runtime.heartbeatAcknowledged) {
          runtime.reconnectNotBefore = Math.max(runtime.reconnectNotBefore, Date.now() + discordOnlinerHeartbeatCooldownMs);
          runtime.lastError = "Discord stopped acknowledging heartbeats; reconnect delayed for 60 seconds.";
          appendDiscordOnlinerLog("error", `[HEARTBEAT_TIMEOUT] ${runtime.lastError}`, account.id);
          queueDiscordOnlinerRuntimePersist(runtime);
          socket.terminate();
          return;
        }
        runtime.heartbeatAcknowledged = false;
        socket.send(JSON.stringify({ op: 1, d: sequence }));
      };
      runtime.heartbeatAcknowledged = true;
      runtime.heartbeatTimer = setInterval(heartbeat, interval);
      runtime.heartbeatTimer.unref?.();
      if (shouldResume) {
        socket.send(JSON.stringify({
          op: 6,
          d: {
            token: account.botToken,
            session_id: runtime.sessionId,
            seq: sequence
          }
        }));
        appendDiscordOnlinerLog("info", `RESUME payload sent to Discord (seq ${sequence}).`, account.id);
      } else {
        const presence = buildDiscordOnlinerAccountPresence(runtime.config ?? config, account, runtime, true);
        socket.send(JSON.stringify({
        op: 2,
        d: {
          token: account.botToken,
          properties: createDiscordGatewayIdentityProperties(),
          presence,
            capabilities: 16381,
            compress: false,
            client_state: createDiscordGatewayClientState()
          }
        }));
        appendDiscordOnlinerLog("info", "IDENTIFY payload sent to Discord.", account.id);
      }
      return;
    }
    if (payload?.op === 11) {
      runtime.heartbeatAcknowledged = true;
      return;
    }
    if (payload?.op === 1 && socket.readyState === WebSocket.OPEN) {
      runtime.heartbeatAcknowledged = false;
      socket.send(JSON.stringify({ op: 1, d: sequence }));
      appendDiscordOnlinerLog("info", `Discord requested a HEARTBEAT; sent${sequence == null ? " before receiving a sequence" : ` (seq ${sequence})`}.`, account.id);
      return;
    }
    if (payload?.op === 7) {
      appendDiscordOnlinerLog("warn", "RECONNECT requested by Discord (opcode 7).", account.id);
      socket.close(4000, "Discord requested reconnect");
      return;
    }
    if (payload?.op === 9) {
      appendDiscordOnlinerLog("warn", `INVALID SESSION received (opcode 9, resumable: ${payload.d === true ? "yes" : "no"}).`, account.id);
      if (payload.d !== true) {
        runtime.sequence = null;
        runtime.sessionId = null;
        runtime.resumeGatewayUrl = null;
      }
      socket.close(4000, "Discord invalidated session");
      return;
    }
    if (payload?.op !== 0) {
      appendDiscordOnlinerLog("info", `Gateway opcode ${String(payload?.op ?? "unknown")} received.`, account.id);
      return;
    }
    appendDiscordOnlinerLog("info", `DISPATCH ${String(payload.t ?? "UNKNOWN")}${sequence == null ? "" : ` (seq ${sequence})`}.`, account.id);
    if (payload.t === "READY") {
      const user = payload.d?.user ?? {};
      const userId = String(user.id ?? "");
      runtime.sessionId = String(payload.d?.session_id ?? "") || null;
      runtime.resumeGatewayUrl = String(payload.d?.resume_gateway_url ?? "") || null;
      runtime.sequence = sequence;
      runtime.bot = {
        id: userId,
        username: String(user.global_name ?? user.username ?? "Discord Bot"),
        tag: String(user.discriminator ?? "0") === "0" ? String(user.username ?? "") : `${user.username}#${user.discriminator}`,
        avatarUrl: user.avatar && userId ? `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=128` : null
      };
      runtime.guildIds = new Set((Array.isArray(payload.d?.guilds) ? payload.d.guilds : []).map((guild) => String(guild?.id ?? "")).filter(isDiscordGuildId));
      runtime.state = "connected";
      runtime.connectedAt = new Date().toISOString();
      runtime.hasConnectedOnce = true;
      runtime.lastError = null;
      runtime.reconnectAttempt = 0;
      runtime.automaticReconnectBlocked = false;
      runtime.reconnectNotBefore = 0;
      appendDiscordOnlinerLog("success", `READY as ${runtime.bot.tag || runtime.bot.username}.`, account.id);
      scheduleDiscordOnlinerActivityRotation(runtime.config ?? config, account, runtime, generation);
      advanceDiscordOnlinerConnectionQueue(runtime, "connected");
      return;
    }
    if (payload.t === "RESUMED") {
      runtime.state = "connected";
      runtime.connectedAt = new Date().toISOString();
      runtime.hasConnectedOnce = true;
      runtime.lastError = null;
      runtime.reconnectAttempt = 0;
      runtime.automaticReconnectBlocked = false;
      runtime.reconnectNotBefore = 0;
      appendDiscordOnlinerLog("success", `Gateway session RESUMED${sequence == null ? "" : ` from seq ${sequence}`}.`, account.id);
      scheduleDiscordOnlinerActivityRotation(runtime.config ?? config, account, runtime, generation);
      advanceDiscordOnlinerConnectionQueue(runtime, "connected");
      queueDiscordOnlinerRuntimePersist(runtime);
      return;
    }
    if (payload.t === "GUILD_CREATE") {
      const guildId = String(payload.d?.id ?? "");
      if (isDiscordGuildId(guildId)) runtime.guildIds.add(guildId);
      queueDiscordOnlinerRuntimePersist(runtime);
    }
    if (payload.t === "GUILD_DELETE" && payload.d?.unavailable !== true) {
      runtime.guildIds.delete(String(payload.d?.id ?? ""));
      queueDiscordOnlinerRuntimePersist(runtime);
    }
  });
  socket.on("error", (error) => {
    if (generation === runtime.generation) {
      const errorMessage = error instanceof Error ? error.message : "Discord Gateway connection failed.";
      if (/\b407\b/.test(errorMessage)) {
        runtime.automaticReconnectBlocked = true;
        runtime.state = "error";
        runtime.lastError = "Proxy authentication failed (HTTP 407). Automatic reconnect stopped until the proxy credentials change or Start/Continue is used.";
        appendDiscordOnlinerLog("error", `[407] ${runtime.lastError}`, account.id);
      } else if (/\b429\b/.test(errorMessage)) {
        runtime.reconnectNotBefore = Math.max(runtime.reconnectNotBefore, Date.now() + discordOnlinerRateLimitCooldownMs);
        runtime.lastError = "Discord Gateway returned HTTP 429. Reconnect delayed for at least 5 minutes.";
        appendDiscordOnlinerLog("warn", `[429] ${runtime.lastError}`, account.id);
      } else if (runtime.automaticReconnectBlocked || runtime.reconnectNotBefore > Date.now()) {
        // Keep the classified 407/429 error recorded by unexpected-response.
      } else {
        runtime.lastError = errorMessage;
        appendDiscordOnlinerLog("error", `Gateway error: ${runtime.lastError}`, account.id);
      }
      if (proxyEndpoint && !transportOpened) appendDiscordOnlinerLog("error", `Proxy route failed: ${proxyEndpoint} -> ${gatewayEndpoint}.`, account.id);
      if (account.proxyUrl && !transportOpened) recordDiscordOnlinerProxyHealth(account.proxyUrl, false);
      queueDiscordOnlinerRuntimePersist(runtime);
    }
  });
  socket.on("close", (code, reason) => {
    if (generation !== runtime.generation) return;
    if (runtime.heartbeatTimer) clearInterval(runtime.heartbeatTimer);
    if (runtime.activityTimer) clearTimeout(runtime.activityTimer);
    runtime.heartbeatTimer = null;
    runtime.activityTimer = null;
    runtime.socket = null;
    runtime.connectedAt = null;
    runtime.lastDisconnectedAt = new Date().toISOString();
    const closeReason = reason?.toString().trim();
    appendDiscordOnlinerLog(code === 1000 ? "info" : "warn", `Gateway closed with code ${code}${closeReason ? ` (${closeReason})` : ""}.`, account.id);
    if ([4004, 4010, 4011, 4012, 4013, 4014].includes(code)) {
      runtime.sequence = null;
      runtime.sessionId = null;
      runtime.resumeGatewayUrl = null;
      runtime.automaticReconnectBlocked = true;
      runtime.state = "error";
      runtime.lastError = code === 4004
        ? "Discord rejected the saved bot token. Automatic reconnect stopped."
        : `Discord rejected this Gateway session with non-retryable close code ${code}. Automatic reconnect stopped.`;
      appendDiscordOnlinerLog("error", `[${code}] ${runtime.lastError}`, account.id);
      queueDiscordOnlinerRuntimePersist(runtime);
      advanceDiscordOnlinerConnectionQueue(runtime, "failed");
      return;
    }
    if ([1000, 1001, 4003, 4005, 4007, 4009].includes(code)) {
      runtime.sequence = null;
      runtime.sessionId = null;
      runtime.resumeGatewayUrl = null;
    }
    if (code === 4008) {
      runtime.reconnectNotBefore = Math.max(runtime.reconnectNotBefore, Date.now() + discordOnlinerRateLimitCooldownMs);
      runtime.lastError = "Discord Gateway rate limited the connection (4008). Reconnect delayed for 5 minutes.";
      appendDiscordOnlinerLog("warn", `[4008] ${runtime.lastError}`, account.id);
      queueDiscordOnlinerRuntimePersist(runtime);
    }
    const latestConfig = runtime.config ?? config;
    const latestAccount = latestConfig.accounts.find((item) => item.id === account.id) ?? account;
    scheduleDiscordOnlinerReconnect(latestConfig, latestAccount, runtime, generation);
  });
}

function scheduleDiscordOnlinerAccountStart(config, account, delayMs = 0, onConnected = null) {
  const runtime = getDiscordOnlinerRuntime(account.id);
  runtime.config = config;
  runtime.connectionQueueContinuation = typeof onConnected === "function" ? onConnected : null;
  if (discordOnlinerConnectionsPaused) {
    runtime.state = "disconnected";
    queueDiscordOnlinerRuntimePersist(runtime);
    return;
  }
  if (!account.proxyUrl) {
    runtime.state = "error";
    runtime.lastError = "A dedicated proxy is required before this bot can connect.";
    appendDiscordOnlinerLog("error", runtime.lastError, account.id);
    advanceDiscordOnlinerConnectionQueue(runtime, "failed");
    return;
  }
  const generation = runtime.generation;
  if (delayMs <= 0) {
    connectDiscordOnliner(config, account, runtime, generation);
    return;
  }
  runtime.state = "connecting";
  appendDiscordOnlinerLog("info", `Gateway connection queued; starting in ${(delayMs / 1000).toFixed(1)}s.`, account.id);
  runtime.startupTimer = setTimeout(() => {
    runtime.startupTimer = null;
    connectDiscordOnliner(config, account, runtime, generation);
  }, delayMs);
  runtime.startupTimer.unref?.();
}

function startDiscordOnlinerAccounts(config, accounts, { stagger = false } = {}) {
  if (!config.enabled || discordOnlinerConnectionsPaused) return;
  if (!stagger) {
    for (const account of accounts) scheduleDiscordOnlinerAccountStart(config, account);
    return;
  }
  const queue = [...accounts];
  const startNext = () => {
    if (discordOnlinerConnectionsPaused) return;
    const account = queue.shift();
    if (!account) return;
    const continueQueue = queue.length ? (outcome = "connected") => {
      const runtime = getDiscordOnlinerRuntime(account.id);
      const delayMs = config.connectionDelaySeconds * 1_000;
      runtime.nextQueuedConnectionAt = new Date(Date.now() + delayMs).toISOString();
      runtime.connectionQueueStartNext = startNext;
      appendDiscordOnlinerLog(
        outcome === "connected" ? "info" : "warn",
        `${outcome === "connected" ? "Connection succeeded" : "Connection failed permanently; skipping this bot"}; next bot starts in ${config.connectionDelaySeconds}s.`,
        account.id
      );
      runtime.connectionQueueTimer = setTimeout(() => {
        triggerNextDiscordOnlinerQueuedConnection(runtime);
      }, delayMs);
      runtime.connectionQueueTimer.unref?.();
    } : null;
    scheduleDiscordOnlinerAccountStart(config, account, 0, continueQueue);
  };
  startNext();
}

function startDiscordOnliner(config) {
  if (discordOnlinerConnectionsPaused) return;
  stopDiscordOnliner({ resetIdentity: true });
  discordOnlinerRuntimes.clear();
  if (!config.enabled || !config.accounts.length) {
    appendDiscordOnlinerLog("info", config.accounts.length ? "Onliner is disabled; Gateway connections were not started." : "No bot token is saved; Gateway connections were not started.");
    return;
  }
  startDiscordOnlinerAccounts(config, config.accounts, { stagger: true });
}

function pauseDiscordOnlinerConnections() {
  discordOnlinerConnectionsPaused = true;
  for (const runtime of discordOnlinerRuntimes.values()) {
    if (runtime.state === "connected" && runtime.socket?.readyState === WebSocket.OPEN) continue;
    runtime.generation += 1;
    clearDiscordOnlinerTimers(runtime);
    const socket = runtime.socket;
    runtime.socket = null;
    runtime.state = "disconnected";
    runtime.reconnectAttempt = 0;
    try {
      if (socket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) socket.close(1000, "Connection queue paused");
    } catch {
      // The pending socket may already have closed.
    }
    queueDiscordOnlinerRuntimePersist(runtime);
  }
  appendDiscordOnlinerLog("info", "Gateway connection queue paused; already connected bots were kept online.");
}

function continueDiscordOnlinerConnections(config) {
  discordOnlinerConnectionsPaused = false;
  const remainingAccounts = config.accounts.filter((account) => {
    const runtime = discordOnlinerRuntimes.get(account.id);
    const needsConnection = runtime?.state !== "connected" || runtime.socket?.readyState !== WebSocket.OPEN;
    if (runtime && needsConnection) {
      runtime.automaticReconnectBlocked = false;
      runtime.reconnectAttempt = 0;
      runtime.reconnectNotBefore = 0;
      runtime.lastError = null;
    }
    return needsConnection;
  });
  startDiscordOnlinerAccounts(config, remainingAccounts, { stagger: true });
  appendDiscordOnlinerLog("info", `Gateway connection queue continued with ${remainingAccounts.length} remaining bot${remainingAccounts.length === 1 ? "" : "s"}.`);
}

function reconnectDiscordOnlinerAccount(config, account) {
  const runtime = discordOnlinerRuntimes.get(account.id);
  if (runtime) stopDiscordOnlinerRuntime(runtime);
  startDiscordOnlinerAccounts(config, [account]);
  appendDiscordOnlinerLog("info", "Gateway connection restart requested for this bot.", account.id);
}

function getDiscordOnlinerPresenceConfigFingerprint(config) {
  return JSON.stringify({
    statuses: config.statuses,
    activityChances: config.activityChances,
    spotifyPlaylistId: config.spotifyPlaylistId,
    youtubePlaylistId: config.youtubePlaylistId,
    games: config.games,
    music: config.music,
    streamingUsers: config.streamingUsers,
    streamingCategories: config.streamingCategories,
    streamingTitles: config.streamingTitles,
    watch: config.watch
  });
}

function getDiscordOnlinerRotationConfigFingerprint(config) {
  return JSON.stringify({
    randomizeEnabled: config.randomizeEnabled,
    rotationMinMinutes: config.rotationMinMinutes,
    rotationMaxMinutes: config.rotationMaxMinutes,
    connectionDelaySeconds: config.connectionDelaySeconds
  });
}

function applyDiscordOnlinerSettings(current, candidate) {
  if (current.enabled !== candidate.enabled) {
    if (candidate.enabled) startDiscordOnliner(candidate);
    else stopDiscordOnliner();
    return { changed: true, presenceUpdated: false, connectionsRestarted: candidate.enabled };
  }

  const presenceChanged = getDiscordOnlinerPresenceConfigFingerprint(current) !== getDiscordOnlinerPresenceConfigFingerprint(candidate);
  const rotationChanged = getDiscordOnlinerRotationConfigFingerprint(current) !== getDiscordOnlinerRotationConfigFingerprint(candidate);
  if (!presenceChanged && !rotationChanged) return { changed: false, presenceUpdated: false, connectionsRestarted: false };

  let presenceUpdated = false;
  for (const account of candidate.accounts) {
    const runtime = discordOnlinerRuntimes.get(account.id);
    if (!runtime) continue;
    runtime.config = candidate;
    if (presenceChanged && runtime.state === "connected" && runtime.socket?.readyState === WebSocket.OPEN) {
      runtime.socket.send(JSON.stringify({ op: 3, d: buildDiscordOnlinerAccountPresence(candidate, account, runtime, true) }));
      appendDiscordOnlinerLog("info", `Presence updated without reconnecting: ${runtime.currentStatus}, ${runtime.currentActivityType}${runtime.currentActivity ? ` · ${runtime.currentActivity}` : ""}.`, account.id);
      presenceUpdated = true;
    }
    scheduleDiscordOnlinerActivityRotation(candidate, account, runtime, runtime.generation);
  }
  return { changed: true, presenceUpdated, connectionsRestarted: false };
}

let discordOnlinerWorkerLockClient = null;
let discordOnlinerWorkerCurrentConfig = null;
let discordOnlinerWorkerPollTimer = null;
let discordOnlinerWorkerHeartbeatTimer = null;
let discordOnlinerWorkerLockRetryTimer = null;
let discordOnlinerWorkerPollActive = false;

async function reconcileDiscordOnlinerWorkerConfig(current, candidate) {
  if (current.enabled !== candidate.enabled) {
    applyDiscordOnlinerSettings(current, candidate);
    if (!candidate.enabled) {
      for (const account of current.accounts) discordOnlinerPendingRuntimeWrites.delete(account.id);
      if (current.accounts.length) await pool.query("DELETE FROM discord_onliner_runtime WHERE account_id = ANY($1::text[])", [current.accounts.map((account) => account.id)]);
    }
    discordOnlinerWorkerCurrentConfig = candidate;
    return;
  }

  const currentById = new Map(current.accounts.map((account) => [account.id, account]));
  const candidateById = new Map(candidate.accounts.map((account) => [account.id, account]));
  const removedIds = current.accounts.filter((account) => !candidateById.has(account.id)).map((account) => account.id);
  const addedAccounts = candidate.accounts.filter((account) => !currentById.has(account.id));
  const connectionChangedAccounts = candidate.accounts.filter((account) => {
    const previous = currentById.get(account.id);
    return previous && (previous.botToken !== account.botToken
      || previous.proxyUrl !== account.proxyUrl);
  });
  const richPresenceChangedIds = new Set(candidate.accounts
    .filter((account) => {
      const previous = currentById.get(account.id);
      return previous && previous.richPresenceEnabled !== account.richPresenceEnabled;
    })
    .map((account) => account.id));

  for (const accountId of removedIds) {
    const runtime = discordOnlinerRuntimes.get(accountId);
    if (runtime) stopDiscordOnlinerRuntime(runtime, { resetIdentity: true });
    discordOnlinerRuntimes.delete(accountId);
    discordOnlinerPendingRuntimeWrites.delete(accountId);
  }
  if (removedIds.length) await pool.query("DELETE FROM discord_onliner_runtime WHERE account_id = ANY($1::text[])", [removedIds]);

  if (candidate.enabled) {
    for (const account of connectionChangedAccounts) {
      const runtime = discordOnlinerRuntimes.get(account.id);
      if (runtime) stopDiscordOnlinerRuntime(runtime, { resetIdentity: true });
      startDiscordOnlinerAccounts(candidate, [account]);
      appendDiscordOnlinerLog("info", "Bot token or proxy changed; restarting only this Gateway connection.", account.id);
    }
    if (addedAccounts.length) {
      appendDiscordOnlinerLog("info", `${addedAccounts.length} new bot profile${addedAccounts.length === 1 ? "" : "s"} detected by the worker.`);
      startDiscordOnlinerAccounts(candidate, addedAccounts, { stagger: true });
    }
  }

  const changedIds = new Set(connectionChangedAccounts.map((account) => account.id));
  for (const account of candidate.accounts) {
    if (changedIds.has(account.id)) continue;
    const runtime = discordOnlinerRuntimes.get(account.id);
    if (runtime) runtime.config = candidate;
    if (candidate.enabled && richPresenceChangedIds.has(account.id)) {
      applyDiscordOnlinerAccountPresenceLive(
        candidate,
        account,
        `Rich Presence ${account.richPresenceEnabled === false ? "disabled" : "enabled"} on the active Gateway connection.`
      );
    }
  }
  applyDiscordOnlinerSettings(current, candidate);
  discordOnlinerWorkerCurrentConfig = candidate;
}

async function processDiscordOnlinerWorkerCommands() {
  const result = await pool.query(`
    UPDATE discord_onliner_commands
    SET status = 'processing', started_at = NOW()
    WHERE id IN (
      SELECT id FROM discord_onliner_commands
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, command_type, payload
  `);
  for (const command of result.rows) {
    try {
      if (["reconnect_all", "start_all"].includes(command.command_type)) {
        const config = await getDiscordOnlinerConfig();
        discordOnlinerConnectionsPaused = false;
        await pool.query("UPDATE discord_onliner_worker_state SET connection_paused = FALSE WHERE singleton = TRUE");
        startDiscordOnliner(config);
        discordOnlinerWorkerCurrentConfig = config;
        appendDiscordOnlinerLog("info", "Gateway connection process started from the beginning by a panel command.");
      } else if (command.command_type === "pause_connections") {
        pauseDiscordOnlinerConnections();
        await pool.query("UPDATE discord_onliner_worker_state SET connection_paused = TRUE WHERE singleton = TRUE");
      } else if (command.command_type === "continue_connections") {
        const config = await getDiscordOnlinerConfig();
        await pool.query("UPDATE discord_onliner_worker_state SET connection_paused = FALSE WHERE singleton = TRUE");
        continueDiscordOnlinerConnections(config);
        discordOnlinerWorkerCurrentConfig = config;
      } else if (command.command_type === "reconnect_account") {
        if (discordOnlinerConnectionsPaused) throw new Error("Gateway connections are paused. Continue them before reconnecting a bot.");
        const config = await getDiscordOnlinerConfig();
        const accountId = String(command.payload?.accountId ?? "");
        const account = config.accounts.find((item) => item.id === accountId);
        if (!account) throw new Error("Bot profile not found.");
        reconnectDiscordOnlinerAccount(config, account);
        discordOnlinerWorkerCurrentConfig = config;
      } else if (command.command_type === "stop_all") {
        discordOnlinerConnectionsPaused = true;
        stopDiscordOnliner();
        await pool.query("UPDATE discord_onliner_worker_state SET connection_paused = TRUE WHERE singleton = TRUE");
        appendDiscordOnlinerLog("info", "All Gateway connections stopped by a panel command.");
      }
      await pool.query("UPDATE discord_onliner_commands SET status = 'complete', completed_at = NOW(), error = NULL WHERE id = $1", [command.id]);
    } catch (error) {
      await pool.query("UPDATE discord_onliner_commands SET status = 'failed', completed_at = NOW(), error = $2 WHERE id = $1", [command.id, String(error instanceof Error ? error.message : error).slice(0, 500)]);
    }
  }
  await pool.query("DELETE FROM discord_onliner_commands WHERE completed_at < NOW() - INTERVAL '1 day'");
}

async function updateCommunityReactionResult(job, fields) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [job.order_id]);
    const order = tracked.rows[0]?.payload;
    if (!order || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return;
    }
    const communityResults = order.communityResults.map((item) => String(item?.discordUserId ?? "") === String(job.discord_user_id)
      ? { ...item, ...fields }
      : item);
    const reactionRequests = (Array.isArray(order.reactionRequests) ? order.reactionRequests : []).map((request) => ({
      ...request,
      assignments: Array.isArray(request?.assignments)
        ? request.assignments.map((assignment) => request.id === job.request_id
          && String(assignment?.discordUserId ?? "") === String(job.discord_user_id)
          && String(assignment?.reactionEmoji ?? "") === String(job.emoji)
          ? { ...assignment, ...fields }
          : assignment)
        : request?.assignments
    }));
    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [job.order_id, JSON.stringify({ ...order, communityResults, reactionRequests })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function processCommunityReactionJobsUnlocked() {
  const jobs = await pool.query(
    `SELECT order_id, request_id, discord_user_id, account_id, channel_id, message_id, emoji, attempts
     FROM community_reaction_jobs
     WHERE status = 'pending' AND next_attempt_at <= NOW()
     ORDER BY created_at ASC
     LIMIT 20`
  );
  if (!jobs.rowCount) return;
  const config = discordOnlinerWorkerCurrentConfig ?? await getDiscordOnlinerConfig();
  const [persistedRuntimeResult, workerStateResult] = await Promise.all([
    pool.query("SELECT account_id, payload FROM discord_onliner_runtime"),
    pool.query("SELECT status, heartbeat_at, connection_paused FROM discord_onliner_worker_state WHERE singleton = TRUE LIMIT 1")
  ]);
  const persistedRuntimes = persistedRuntimeResult.rows;
  const workerState = workerStateResult.rows[0];
  const workerHeartbeatAt = workerState?.heartbeat_at ? new Date(workerState.heartbeat_at).getTime() : 0;
  const persistedGatewayAvailable = workerState?.status === "online"
    && Number.isFinite(workerHeartbeatAt)
    && workerHeartbeatAt >= Date.now() - discordOnlinerWorkerHeartbeatMs * 3;
  for (const job of jobs.rows) {
    const runtimeAccountId = [...discordOnlinerRuntimes.entries()].find(([, item]) =>
      String(item?.bot?.id ?? "") === String(job.discord_user_id)
    )?.[0];
    const persistedRuntime = persistedRuntimes.find((item) => item.account_id === job.account_id)
      ?? persistedRuntimes.find((item) => String(item.payload?.bot?.id ?? "") === String(job.discord_user_id));
    const account = config.accounts.find((item) => item.id === job.account_id)
      ?? config.accounts.find((item) => String(item.discordUserId ?? "") === String(job.discord_user_id))
      ?? config.accounts.find((item) => item.id === runtimeAccountId)
      ?? config.accounts.find((item) => item.id === persistedRuntime?.account_id);
    const runtime = account ? discordOnlinerRuntimes.get(account.id) : null;
    const localGatewayConnected = runtime?.state === "connected" && runtime.socket?.readyState === WebSocket.OPEN;
    const persistedGatewayConnected = persistedGatewayAvailable
      && persistedRuntime?.payload?.connectionState === "connected";
    if (!account) {
      const waitingDetails = "The Onliner account could not be matched to this Discord member.";
      await pool.query(
        "UPDATE community_reaction_jobs SET account_id = COALESCE($5, account_id), next_attempt_at = NOW() + INTERVAL '15 seconds', last_error = $6 WHERE order_id = $1 AND request_id = $2 AND discord_user_id = $3 AND emoji = $4",
        [job.order_id, job.request_id, job.discord_user_id, job.emoji, null, waitingDetails]
      );
      await updateCommunityReactionResult(job, { reactionState: "pending", reactionEmoji: job.emoji, reactionDetails: waitingDetails });
      continue;
    }
    try {
      const sendReaction = () => sendHumanizerDiscordRequest(
          `channels/${encodeURIComponent(job.channel_id)}/messages/${encodeURIComponent(job.message_id)}/reactions/${encodeURIComponent(job.emoji)}/@me`,
          account.proxyUrl,
          account.botToken,
          "PUT",
          undefined
        );
      let result;
      if (localGatewayConnected || persistedGatewayConnected) {
        result = await sendReaction();
      } else {
        const connectingDetails = "Connecting this member to the Onliner Gateway before reacting.";
        await updateCommunityReactionResult(job, { reactionState: "pending", reactionEmoji: job.emoji, reactionDetails: connectingDetails });
        result = await runWithHumanizerGatewaySession({
          id: String(job.discord_user_id),
          token: account.botToken,
          proxyUrl: account.proxyUrl,
          onlinerAccountId: account.id
        }, sendReaction);
      }
      if (result.response.ok) {
        const completedAt = new Date().toISOString();
        await pool.query(
          "UPDATE community_reaction_jobs SET status = 'completed', account_id = $5, attempts = attempts + 1, completed_at = NOW(), last_error = NULL WHERE order_id = $1 AND request_id = $2 AND discord_user_id = $3 AND emoji = $4",
          [job.order_id, job.request_id, job.discord_user_id, job.emoji, account.id]
        );
        await updateCommunityReactionResult(job, { reactionState: "completed", reactionEmoji: job.emoji, reactionCompletedAt: completedAt, reactionDetails: "Reaction added after the Onliner connection became ready." });
        appendDiscordOnlinerLog("success", `Reaction ${job.emoji} added for Members order ${job.order_id}.`, account.id);
        continue;
      }
      const message = String(result.payload?.message ?? `Discord returned HTTP ${result.response.status}.`).slice(0, 400);
      const terminal = [401, 403, 404].includes(result.response.status) || Number(job.attempts) >= 5;
      await pool.query(
        `UPDATE community_reaction_jobs
         SET status = $5, account_id = $6, attempts = attempts + 1,
             next_attempt_at = NOW() + INTERVAL '1 minute', last_error = $7,
             completed_at = CASE WHEN $5 = 'failed' THEN NOW() ELSE completed_at END
         WHERE order_id = $1 AND request_id = $2 AND discord_user_id = $3 AND emoji = $4`,
        [job.order_id, job.request_id, job.discord_user_id, job.emoji, terminal ? "failed" : "pending", account.id, message]
      );
      await updateCommunityReactionResult(job, { reactionState: terminal ? "failed" : "pending", reactionEmoji: job.emoji, reactionDetails: message });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 400);
      const terminal = Number(job.attempts) >= 5;
      await pool.query(
        `UPDATE community_reaction_jobs SET status = $5, account_id = $6, attempts = attempts + 1,
         next_attempt_at = NOW() + INTERVAL '1 minute', last_error = $7,
         completed_at = CASE WHEN $5 = 'failed' THEN NOW() ELSE completed_at END
         WHERE order_id = $1 AND request_id = $2 AND discord_user_id = $3 AND emoji = $4`,
        [job.order_id, job.request_id, job.discord_user_id, job.emoji, terminal ? "failed" : "pending", account.id, message]
      );
      await updateCommunityReactionResult(job, { reactionState: terminal ? "failed" : "pending", reactionEmoji: job.emoji, reactionDetails: message });
    }
  }
}

const communityReactionJobsLockKey = 1_746_203_914;
let communityReactionJobsActive = false;
async function processCommunityReactionJobs() {
  if (communityReactionJobsActive) return;
  communityReactionJobsActive = true;
  let lockClient = null;
  let acquired = false;
  try {
    lockClient = await pool.connect();
    const lock = await lockClient.query("SELECT pg_try_advisory_lock($1) AS acquired", [communityReactionJobsLockKey]);
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) return;
    await processCommunityReactionJobsUnlocked();
  } finally {
    if (acquired) await lockClient?.query("SELECT pg_advisory_unlock($1)", [communityReactionJobsLockKey]).catch(() => {});
    lockClient?.release();
    communityReactionJobsActive = false;
  }
}

async function pollDiscordOnlinerWorker() {
  if (discordOnlinerWorkerPollActive || !discordOnlinerWorkerLockClient) return;
  discordOnlinerWorkerPollActive = true;
  try {
    const candidate = await getDiscordOnlinerConfig();
    if (!discordOnlinerWorkerCurrentConfig) {
      discordOnlinerWorkerCurrentConfig = candidate;
      startDiscordOnliner(candidate);
    } else if (JSON.stringify(discordOnlinerWorkerCurrentConfig) !== JSON.stringify(candidate)) {
      await reconcileDiscordOnlinerWorkerConfig(discordOnlinerWorkerCurrentConfig, candidate);
    }
    for (const runtime of discordOnlinerRuntimes.values()) {
      const nextAt = runtime.nextQueuedConnectionAt ? new Date(runtime.nextQueuedConnectionAt).getTime() : 0;
      if (nextAt > 0 && nextAt <= Date.now()) triggerNextDiscordOnlinerQueuedConnection(runtime);
    }
    await processDiscordOnlinerWorkerCommands();
    await processCommunityReactionJobs();
  } catch (error) {
    console.error("Onliner worker poll failed:", error instanceof Error ? error.message : error);
    await pool.query("UPDATE discord_onliner_worker_state SET last_error = $1 WHERE singleton = TRUE AND worker_id = $2", [String(error instanceof Error ? error.message : error).slice(0, 500), discordOnlinerWorkerId]).catch(() => {});
  } finally {
    discordOnlinerWorkerPollActive = false;
  }
}

async function activateDiscordOnlinerWorker(lockClient) {
  discordOnlinerWorkerLockClient = lockClient;
  discordOnlinerWorkerCurrentConfig = await getDiscordOnlinerConfig();
  const controlResult = await pool.query("SELECT connection_paused FROM discord_onliner_worker_state WHERE singleton = TRUE LIMIT 1");
  discordOnlinerConnectionsPaused = controlResult.rows[0]?.connection_paused === true;
  await pool.query(`
    UPDATE discord_onliner_worker_state
    SET worker_id = $1, status = 'online', started_at = NOW(), heartbeat_at = NOW(), last_error = NULL
    WHERE singleton = TRUE
  `, [discordOnlinerWorkerId]);
  if (discordOnlinerConnectionsPaused) {
    await pool.query("DELETE FROM discord_onliner_runtime");
    appendDiscordOnlinerLog("info", "Onliner worker started with the Gateway connection queue paused.");
  } else {
    startDiscordOnliner(discordOnlinerWorkerCurrentConfig);
  }
  discordOnlinerWorkerPollTimer = setInterval(() => void pollDiscordOnlinerWorker(), discordOnlinerWorkerPollMs);
  discordOnlinerWorkerHeartbeatTimer = setInterval(() => {
    void pool.query("UPDATE discord_onliner_worker_state SET heartbeat_at = NOW(), status = 'online' WHERE singleton = TRUE AND worker_id = $1", [discordOnlinerWorkerId]);
  }, discordOnlinerWorkerHeartbeatMs);
  console.log(`Discord Onliner worker active (${discordOnlinerWorkerId}).`);
}

async function tryStartDiscordOnlinerWorker() {
  if (discordOnlinerWorkerLockClient) return;
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [discordOnlinerWorkerLockKey]);
    if (result.rows[0]?.acquired) {
      if (discordOnlinerWorkerLockRetryTimer) clearInterval(discordOnlinerWorkerLockRetryTimer);
      discordOnlinerWorkerLockRetryTimer = null;
      await activateDiscordOnlinerWorker(client);
      return;
    }
  } catch (error) {
    console.error("Onliner worker lock failed:", error instanceof Error ? error.message : error);
  }
  client.release();
  if (!discordOnlinerWorkerLockRetryTimer) {
    console.log("Discord Onliner worker is standing by; another instance owns the database lock.");
    discordOnlinerWorkerLockRetryTimer = setInterval(() => void tryStartDiscordOnlinerWorker(), discordOnlinerWorkerHeartbeatMs);
  }
}

async function stopDiscordOnlinerWorker() {
  if (discordOnlinerWorkerPollTimer) clearInterval(discordOnlinerWorkerPollTimer);
  if (discordOnlinerWorkerHeartbeatTimer) clearInterval(discordOnlinerWorkerHeartbeatTimer);
  if (discordOnlinerWorkerLockRetryTimer) clearInterval(discordOnlinerWorkerLockRetryTimer);
  stopDiscordOnliner();
  await pool.query("UPDATE discord_onliner_worker_state SET status = 'offline', heartbeat_at = NOW() WHERE singleton = TRUE AND worker_id = $1", [discordOnlinerWorkerId]).catch(() => {});
  if (discordOnlinerWorkerLockClient) {
    await discordOnlinerWorkerLockClient.query("SELECT pg_advisory_unlock($1)", [discordOnlinerWorkerLockKey]).catch(() => {});
    discordOnlinerWorkerLockClient.release();
    discordOnlinerWorkerLockClient = null;
  }
}

let communityGuildCache = null;
let communityBotCache = null;
let communityBotGuildCountCache = null;
let communityGuildLeaveProgress = { active: false, total: 0, completed: 0, currentGuilds: [], startedAt: null, finishedAt: null };
const communityMemberPresenceCache = new Map();
const communityGatewayPresenceCache = new Map();
const communityGatewayWatchedPresenceKeys = new Map();
let communityPresenceGateway = null;

function normalizeCommunityPresenceStatus(value) {
  const status = String(value ?? "").trim().toLowerCase();
  return ["online", "idle", "dnd", "offline"].includes(status) ? status : "unknown";
}

function cacheCommunityGatewayPresence(guildId, discordUserId, status) {
  const normalizedGuildId = String(guildId ?? "");
  const normalizedUserId = String(discordUserId ?? "");
  if (!isDiscordGuildId(normalizedGuildId) || !isDiscordGuildId(normalizedUserId)) return;
  const cacheKey = `${normalizedGuildId}:${normalizedUserId}`;
  if ((communityGatewayWatchedPresenceKeys.get(cacheKey) ?? 0) <= Date.now()) {
    communityGatewayWatchedPresenceKeys.delete(cacheKey);
    communityGatewayPresenceCache.delete(cacheKey);
    return;
  }
  communityGatewayPresenceCache.set(cacheKey, {
    status: normalizeCommunityPresenceStatus(status),
    updatedAt: Date.now()
  });
}

function stopCommunityPresenceGateway() {
  const gateway = communityPresenceGateway;
  communityPresenceGateway = null;
  if (!gateway) return;
  if (gateway.heartbeatTimer) clearInterval(gateway.heartbeatTimer);
  if (gateway.initialHeartbeatTimer) clearTimeout(gateway.initialHeartbeatTimer);
  for (const pending of gateway.pendingMemberRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("Discord presence connection was closed."));
  }
  gateway.pendingMemberRequests.clear();
  try {
    gateway.socket?.close(1000, "Configuration changed");
  } catch {
    // The socket may already be closed.
  }
}

function completeCommunityPresenceRequest(gateway, nonce) {
  const pending = gateway.pendingMemberRequests.get(nonce);
  if (!pending) return;
  clearTimeout(pending.timeout);
  gateway.pendingMemberRequests.delete(nonce);
  const statuses = new Map();
  for (const discordUserId of pending.requestedUserIds) {
    const status = pending.presences.get(discordUserId)
      ?? (pending.memberIds.has(discordUserId) ? "offline" : "unknown");
    statuses.set(discordUserId, status);
    if (status !== "unknown") cacheCommunityGatewayPresence(pending.guildId, discordUserId, status);
  }
  pending.resolve(statuses);
}

function handleCommunityGatewayDispatch(gateway, eventType, data) {
  if (eventType === "READY") {
    gateway.sessionId = String(data?.session_id ?? "");
    gateway.guildIds = new Set((Array.isArray(data?.guilds) ? data.guilds : [])
      .map((guild) => String(guild?.id ?? ""))
      .filter(isDiscordGuildId));
    gateway.ready = true;
    gateway.resolveReady(gateway);
    return;
  }
  if (eventType === "GUILD_CREATE") {
    const guildId = String(data?.id ?? "");
    if (isDiscordGuildId(guildId)) gateway.guildIds.add(guildId);
    return;
  }
  if (eventType === "GUILD_DELETE") {
    const guildId = String(data?.id ?? "");
    if (data?.unavailable !== true) gateway.guildIds.delete(guildId);
    return;
  }
  if (eventType === "PRESENCE_UPDATE") {
    cacheCommunityGatewayPresence(data?.guild_id, data?.user?.id, data?.status);
    return;
  }
  if (eventType !== "GUILD_MEMBERS_CHUNK") return;

  const guildId = String(data?.guild_id ?? "");
  for (const presence of Array.isArray(data?.presences) ? data.presences : []) {
    cacheCommunityGatewayPresence(guildId, presence?.user?.id, presence?.status);
  }
  const nonce = String(data?.nonce ?? "");
  const pending = gateway.pendingMemberRequests.get(nonce);
  if (!pending || pending.guildId !== guildId) return;
  for (const member of Array.isArray(data?.members) ? data.members : []) {
    const discordUserId = String(member?.user?.id ?? "");
    if (isDiscordGuildId(discordUserId)) pending.memberIds.add(discordUserId);
  }
  for (const presence of Array.isArray(data?.presences) ? data.presences : []) {
    const discordUserId = String(presence?.user?.id ?? "");
    if (isDiscordGuildId(discordUserId)) pending.presences.set(discordUserId, normalizeCommunityPresenceStatus(presence?.status));
  }
  pending.receivedChunks.add(Number(data?.chunk_index ?? 0));
  pending.chunkCount = Math.max(1, Number(data?.chunk_count ?? 1));
  if (pending.receivedChunks.size >= pending.chunkCount) completeCommunityPresenceRequest(gateway, nonce);
}

async function ensureCommunityPresenceGateway(config) {
  const tokenKey = hashToken(config.botToken);
  if (communityPresenceGateway?.tokenKey === tokenKey) {
    if (communityPresenceGateway.ready && communityPresenceGateway.socket?.readyState === WebSocket.OPEN) return communityPresenceGateway;
    if (communityPresenceGateway.readyPromise) return communityPresenceGateway.readyPromise;
  }
  stopCommunityPresenceGateway();

  const socket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const gateway = {
    tokenKey,
    socket,
    ready: false,
    readyPromise,
    resolveReady,
    rejectReady,
    settled: false,
    heartbeatTimer: null,
    initialHeartbeatTimer: null,
    guildIds: new Set(),
    pendingMemberRequests: new Map()
  };
  communityPresenceGateway = gateway;

  const readyTimeout = setTimeout(() => {
    if (gateway.settled) return;
    gateway.settled = true;
    rejectReady(new Error("Discord presence connection timed out."));
    try { socket.close(); } catch {}
  }, 15_000);

  socket.on("message", (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (payload?.op === 10) {
      const heartbeatInterval = Math.max(1_000, Number(payload?.d?.heartbeat_interval) || 45_000);
      const heartbeat = () => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 1, d: null }));
      };
      gateway.initialHeartbeatTimer = setTimeout(heartbeat, Math.floor(Math.random() * heartbeatInterval));
      gateway.heartbeatTimer = setInterval(heartbeat, heartbeatInterval);
      gateway.heartbeatTimer.unref?.();
      socket.send(JSON.stringify({
        op: 2,
        d: {
          token: config.botToken,
          properties: createDiscordGatewayIdentityProperties(),
          capabilities: 16381,
          compress: false,
          client_state: createDiscordGatewayClientState()
        }
      }));
      return;
    }
    if (payload?.op === 1 && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: 1, d: null }));
      return;
    }
    if (payload?.op === 7 || payload?.op === 9) {
      try { socket.close(); } catch {}
      return;
    }
    if (payload?.op === 0) handleCommunityGatewayDispatch(gateway, payload.t, payload.d);
  });
  socket.on("error", () => {
    // The close handler returns a safe Unknown presence result to the caller.
  });
  socket.on("close", (code) => {
    if (gateway.heartbeatTimer) clearInterval(gateway.heartbeatTimer);
    if (gateway.initialHeartbeatTimer) clearTimeout(gateway.initialHeartbeatTimer);
    for (const pending of gateway.pendingMemberRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Discord presence connection closed before the member check completed."));
    }
    gateway.pendingMemberRequests.clear();
    gateway.ready = false;
    gateway.readyPromise = null;
    if (!gateway.settled) {
      gateway.settled = true;
      clearTimeout(readyTimeout);
      rejectReady(new Error(code === 4014
        ? "Discord Presence Intent or Server Members Intent is not enabled for this bot."
        : `Discord presence connection closed (${code}).`));
    }
  });
  readyPromise.then(() => {
    if (!gateway.settled) {
      gateway.settled = true;
      clearTimeout(readyTimeout);
    }
  }, () => {});
  return readyPromise;
}

function requestCommunityGatewayPresences(gateway, guildId, discordUserIds) {
  if (!gateway.ready || gateway.socket?.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Discord presence connection is not ready."));
  }
  const nonce = crypto.randomBytes(12).toString("hex");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      gateway.pendingMemberRequests.delete(nonce);
      reject(new Error("Discord presence member request timed out."));
    }, 10_000);
    gateway.pendingMemberRequests.set(nonce, {
      guildId,
      requestedUserIds: new Set(discordUserIds),
      memberIds: new Set(),
      presences: new Map(),
      receivedChunks: new Set(),
      chunkCount: 1,
      timeout,
      resolve,
      reject
    });
    try {
      gateway.socket.send(JSON.stringify({
        op: 8,
        d: { guild_id: guildId, user_ids: discordUserIds, presences: true, nonce }
      }));
    } catch (error) {
      clearTimeout(timeout);
      gateway.pendingMemberRequests.delete(nonce);
      reject(error);
    }
  });
}

async function loadCommunityGatewayPresences(config, guildId, discordUserIds) {
  const userIds = [...new Set(discordUserIds.map(String).filter(isDiscordGuildId))];
  const statuses = new Map(userIds.map((discordUserId) => {
    const cacheKey = `${guildId}:${discordUserId}`;
    communityGatewayWatchedPresenceKeys.set(cacheKey, Date.now() + 15 * 60_000);
    const cached = communityGatewayPresenceCache.get(cacheKey);
    return [discordUserId, cached?.updatedAt > Date.now() - 5 * 60_000 ? cached.status : "unknown"];
  }));
  if (!userIds.length) return statuses;
  const gateway = await ensureCommunityPresenceGateway(config);
  if (!gateway.guildIds.has(guildId)) return statuses;
  const batches = [];
  for (let index = 0; index < userIds.length; index += 100) batches.push(userIds.slice(index, index + 100));
  await forEachWithConcurrency(batches, 3, async (batch) => {
    try {
      const result = await requestCommunityGatewayPresences(gateway, guildId, batch);
      for (const [discordUserId, status] of result) statuses.set(discordUserId, status);
    } catch {
      // Keep cached/unknown values for a failed Discord presence batch.
    }
  });
  return statuses;
}

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
    verified: (Number(payload?.public_flags ?? payload?.flags ?? 0) & (1 << 16)) !== 0,
    avatarUrl: avatar
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(id)}/${encodeURIComponent(avatar)}.png?size=256`
      : null
  };
  communityBotCache = { clientId: config.clientId, expiresAt: Date.now() + 60_000, value };
  return value;
}

async function loadCommunityBotGuilds(config) {
  if (communityBotGuildCountCache?.clientId === config.clientId && communityBotGuildCountCache.expiresAt > Date.now()) {
    return communityBotGuildCountCache.value;
  }

  const guilds = [];
  let after = "";
  let exact = true;
  for (let page = 0; page < 25; page += 1) {
    const endpoint = `users/@me/guilds?limit=200${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const { response, payload } = await requestDiscord(endpoint, {
      headers: { Authorization: `Bot ${config.botToken}` }
    });
    if (!response.ok || !Array.isArray(payload)) {
      const error = new Error("The Members bot server count could not be loaded.");
      error.statusCode = response.status || 502;
      throw error;
    }
    guilds.push(...payload);
    if (payload.length < 200) break;
    const nextAfter = String(payload[payload.length - 1]?.id ?? "");
    if (!nextAfter || nextAfter === after) break;
    after = nextAfter;
    if (page === 24) exact = false;
  }

  const value = { guilds, count: guilds.length, exact };
  communityBotGuildCountCache = { clientId: config.clientId, expiresAt: Date.now() + 30_000, value };
  return value;
}

async function loadCommunityBotGuildCount(config) {
  const { count, exact } = await loadCommunityBotGuilds(config);
  return { count, exact };
}

async function loadCommunityBotGuildCountSafe(config) {
  try {
    return await loadCommunityBotGuildCount(config);
  } catch {
    return { count: null, exact: false };
  }
}

async function leaveCommunityBotGuilds(config, guilds) {
  if (communityGuildLeaveProgress.active) {
    const error = new Error("A server removal operation is already running.");
    error.statusCode = 409;
    throw error;
  }
  communityGuildLeaveProgress = {
    active: true,
    total: guilds.length,
    completed: 0,
    currentGuilds: [],
    startedAt: new Date().toISOString(),
    finishedAt: null
  };
  const result = { requested: guilds.length, left: 0, alreadyLeft: 0, failed: 0, leftGuildIds: [], alreadyLeftGuildIds: [], failedGuildIds: [], errors: [] };
  await forEachWithConcurrency(guilds, 2, async (guild) => {
    const guildId = String(guild?.id ?? "");
    if (!isDiscordGuildId(guildId)) return;
    const currentGuild = { id: guildId, name: String(guild?.name ?? "Discord server").slice(0, 100) };
    communityGuildLeaveProgress.currentGuilds = [...communityGuildLeaveProgress.currentGuilds, currentGuild];
    try {
      let leaveResult = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        leaveResult = await requestDiscord(`users/@me/guilds/${encodeURIComponent(guildId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bot ${config.botToken}` }
        });
        if (leaveResult.response.status !== 429) break;
        const retrySeconds = Math.min(Math.max(Number(leaveResult.payload?.retry_after) || 1, 1), 10);
        await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
      }
      if (leaveResult?.response.status === 204) {
        result.left += 1;
        result.leftGuildIds.push(guildId);
        return;
      }
      if (leaveResult?.response.status === 404) {
        result.alreadyLeft += 1;
        result.alreadyLeftGuildIds.push(guildId);
        return;
      }
      result.failed += 1;
      result.failedGuildIds.push(guildId);
      if (result.errors.length < 10) {
        result.errors.push({ guildId, guildName: String(guild?.name ?? "Discord server").slice(0, 100), status: Number(leaveResult?.response?.status ?? 0) });
      }
    } catch {
      result.failed += 1;
      result.failedGuildIds.push(guildId);
      if (result.errors.length < 10) {
        result.errors.push({ guildId, guildName: String(guild?.name ?? "Discord server").slice(0, 100), status: 0 });
      }
    } finally {
      communityGuildLeaveProgress.completed += 1;
      communityGuildLeaveProgress.currentGuilds = communityGuildLeaveProgress.currentGuilds.filter((item) => item.id !== guildId);
    }
  });
  communityGuildLeaveProgress = {
    ...communityGuildLeaveProgress,
    active: false,
    completed: guilds.length,
    currentGuilds: [],
    finishedAt: new Date().toISOString()
  };
  communityGuildCache = null;
  communityBotGuildCountCache = null;
  return result;
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

async function createCommunityExperimentalServerInvite(config, guildId) {
  const channelsResult = await requestDiscord(`guilds/${encodeURIComponent(guildId)}/channels`, {
    headers: { Authorization: `Bot ${config.botToken}` }
  });
  if (!channelsResult.response.ok || !Array.isArray(channelsResult.payload)) {
    const error = new Error(getDiscordRequestFailureDetails("Discord server channel list", channelsResult));
    error.statusCode = channelsResult.response.status === 403 ? 409 : 502;
    throw error;
  }

  const preferredTypes = new Map([[0, 0], [5, 1], [2, 2], [13, 3], [15, 4], [16, 5]]);
  const candidates = channelsResult.payload
    .filter((channel) => isDiscordGuildId(String(channel?.id ?? "")) && preferredTypes.has(Number(channel?.type)))
    .sort((left, right) => (preferredTypes.get(Number(left.type)) ?? 99) - (preferredTypes.get(Number(right.type)) ?? 99));
  let lastResult = null;
  for (const channel of candidates) {
    let result = await requestDiscord(`channels/${encodeURIComponent(channel.id)}/invites`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${config.botToken}`,
        "Content-Type": "application/json",
        "X-Audit-Log-Reason": encodeURIComponent("Members 2 Experimental Join delivery invite")
      },
      body: JSON.stringify({ max_age: 0, max_uses: 0, temporary: false, unique: true })
    });
    if (result.response.status === 429) {
      const retrySeconds = Math.min(Math.max(Number(result.payload?.retry_after) || 1, 1), 5);
      await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
      result = await requestDiscord(`channels/${encodeURIComponent(channel.id)}/invites`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${config.botToken}`,
          "Content-Type": "application/json",
          "X-Audit-Log-Reason": encodeURIComponent("Members 2 Experimental Join delivery invite")
        },
        body: JSON.stringify({ max_age: 0, max_uses: 0, temporary: false, unique: true })
      });
    }
    lastResult = result;
    const code = String(result.payload?.code ?? "").trim();
    if (result.response.ok && extractDiscordInviteCode(code)) return `https://discord.gg/${code}`;
    if (![403, 404].includes(result.response.status)) break;
  }

  const error = new Error(lastResult
    ? getDiscordRequestFailureDetails("Discord delivery invite creation", lastResult)
    : "The Members bot could not find a channel where it can create the Experimental Join invite.");
  error.statusCode = [403, 404].includes(Number(lastResult?.response?.status)) ? 409 : 502;
  throw error;
}

async function checkDcordBoostMembershipScreening(invite, serverInfo) {
  if (serverInfo?.bypassesJoinApplication === true) {
    return { status: "closed", enabled: false, bypassedByInvite: true };
  }

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
         ) AS member_result("discordUserId" text, state text, details text, "completedAt" text, "authorizationStatus" text)
         WHERE payload->>'provider' = 'community'
           AND payload->>'serverId' = $1
           AND member_result."discordUserId" = stock.discord_user_id
           AND LOWER(COALESCE(member_result.state, '')) = 'failed'
           AND (
             LOWER(COALESCE(member_result."authorizationStatus", '')) = 'inactive'
             OR COALESCE(member_result.details, '') ~* '(unknown user|discord code 10013|discord code 50178|user account must first be verified)'
           )
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
       AND (
         encrypted_access_token IS NULL
         OR access_token_expires_at IS NULL
         OR (access_token_expires_at <= NOW() AND encrypted_refresh_token IS NULL)
       )`,
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
      `SELECT id, name, is_periodic, check_replacement_enabled, reaction_use_enabled, icon_name, color_key, created_at, updated_at
       FROM community_stock_categories AS category
       WHERE guild_id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM community_stock_category_tombstones AS tombstone
           WHERE tombstone.id = category.id
         )
       ORDER BY created_at ASC, name ASC`,
      [config.guildId]
    ),
    loadCommunityJoinSummary(config)
  ]);
  return categoryResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    isPeriodic: row.is_periodic === true,
    checkReplacementEnabled: row.check_replacement_enabled !== false,
    reactionUseEnabled: row.reaction_use_enabled === true,
    iconName: row.icon_name,
    colorKey: row.color_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summary: summary.categories[row.id] ?? { joined: 0, authorized: 0, ready: 0, alreadyMember: 0, failed: 0 }
  }));
}

async function copyCommunityStockCategories(queryable, sourceGuildId, targetGuildId) {
  if (!sourceGuildId || !targetGuildId || sourceGuildId === targetGuildId) return;

  await queryable.query(
    `INSERT INTO community_stock_categories
       (guild_id, id, name, is_periodic, check_replacement_enabled, reaction_use_enabled, icon_name, color_key, created_at, updated_at)
     SELECT $2, id, name, is_periodic, check_replacement_enabled, reaction_use_enabled, icon_name, color_key, created_at, NOW()
     FROM community_stock_categories AS category
     WHERE guild_id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM community_stock_category_tombstones AS tombstone
         WHERE tombstone.id = category.id
       )
     ON CONFLICT (guild_id, id) DO NOTHING`,
    [sourceGuildId, targetGuildId]
  );
}

async function copyCommunityStockForGuild(queryable, sourceGuildId, targetGuildId) {
  if (!sourceGuildId || !targetGuildId || sourceGuildId === targetGuildId) return;
  await copyCommunityStockCategories(queryable, sourceGuildId, targetGuildId);
  await queryable.query(
    `INSERT INTO community_oauth_joins
       (discord_user_id, guild_id, username, display_name, avatar_url, encrypted_account_token, encrypted_refresh_token, encrypted_access_token, access_token_expires_at, status, stock_type, details, authorized_at, joined_at, reserved_order_id, sort_position)
     SELECT discord_user_id, $2, username, display_name, avatar_url, encrypted_account_token, encrypted_refresh_token, encrypted_access_token, access_token_expires_at,
            CASE WHEN status = 'failed' THEN 'failed' ELSE 'authorized' END,
            stock_type, NULL, authorized_at, NULL, NULL, sort_position
     FROM community_oauth_joins
     WHERE guild_id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM community_stock_category_tombstones AS tombstone
         WHERE tombstone.id = community_oauth_joins.stock_type
       )
     ON CONFLICT (discord_user_id, guild_id) DO UPDATE SET
       username = EXCLUDED.username,
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       encrypted_account_token = COALESCE(EXCLUDED.encrypted_account_token, community_oauth_joins.encrypted_account_token),
       encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, community_oauth_joins.encrypted_refresh_token),
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       status = CASE
         WHEN EXCLUDED.status = 'failed' THEN 'failed'
         WHEN community_oauth_joins.status IN ('joined', 'already_member') THEN community_oauth_joins.status
         ELSE 'authorized'
       END,
       stock_type = EXCLUDED.stock_type,
       details = EXCLUDED.details,
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

function getCommunityResultStockType(order, result) {
  return normalizeCommunityStockType(result?.categoryId ?? getCommunityOrderStockType(order));
}

function interleaveCommunityMembers(groups) {
  const queues = groups.map((group) => [...group]);
  const result = [];
  while (queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const member = queue.shift();
      if (member) result.push(member);
    }
  }
  return result;
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

function isCommunityResultManagementExpired(order, result) {
  const categoryId = getCommunityResultStockType(order, result);
  const allocation = Array.isArray(order?.categoryAllocations)
    ? order.categoryAllocations.find((item) => item?.categoryId === categoryId)
    : null;
  if (!allocation) return isCommunityOrderManagementExpired(order);
  if (allocation.isPeriodic !== true || !allocation.expiredAt) return false;
  const expiresAt = new Date(allocation.expiredAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

const communityOnlinerReplacementCheckMaxAgeMs = 5 * 60_000;

function isCommunityOnlinerCheckEnabled(order, result) {
  const categoryId = getCommunityResultStockType(order, result);
  const allocation = Array.isArray(order?.categoryAllocations)
    ? order.categoryAllocations.find((item) => item?.categoryId === categoryId)
    : null;
  return (allocation?.checkReplacementEnabled ?? order?.categoryCheckReplacementEnabled) !== false;
}

function isCommunityOnlinerReplacementEligible(order, result) {
  if (isCommunityResultManagementExpired(order, result) || !isCommunityOnlinerCheckEnabled(order, result)) return false;
  if (result?.onlinerLive !== false) return false;
  const checkedAt = new Date(result?.onlinerCheckedAt).getTime();
  return Number.isFinite(checkedAt) && checkedAt >= Date.now() - communityOnlinerReplacementCheckMaxAgeMs;
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

async function loadCommunityUnavailableUserIds(queryable, guildId) {
  const deliveredUserIds = await loadCommunityPreviouslyDeliveredUserIds(queryable, guildId);
  const activeAssignments = await queryable.query(
    `SELECT DISTINCT member_result->>'discordUserId' AS discord_user_id
     FROM tracked_orders
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(payload->'communityResults') = 'array' THEN payload->'communityResults'
         ELSE '[]'::jsonb
       END
     ) AS member_result
     WHERE payload->>'provider' = 'community'
       AND payload->>'serverId' = $1
       AND UPPER(COALESCE(payload->>'status', '')) IN ('WAITING', 'RECOVERING', 'PROCESS', 'PAUSED', 'INVITES PAUSED')
       AND LOWER(COALESCE(member_result->>'state', '')) IN ('queued', 'joining', 'replacing')
       AND COALESCE(member_result->>'discordUserId', '') <> ''`,
    [guildId]
  );
  return Array.from(new Set([
    ...deliveredUserIds,
    ...activeAssignments.rows.map((row) => String(row.discord_user_id ?? "").trim()).filter(isDiscordGuildId)
  ]));
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

const communityOAuthRefreshJobs = new Map();
const communityOAuthRefreshEarlyMs = 48 * 60 * 60 * 1000;
const communityOAuthRefreshIntervalMs = 24 * 60 * 60 * 1000;

async function exchangeCommunityOAuthRefreshToken(config, refreshToken) {
  const requestRefresh = async () => {
    const response = await fetch(`${discordApiBase}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }),
      signal: AbortSignal.timeout(15_000)
    });
    return { response, payload: await response.json().catch(() => ({})) };
  };
  let { response, payload } = await requestRefresh();
  if (response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(payload?.retry_after) || 1, 1), 5);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    ({ response, payload } = await requestRefresh());
  }
  if (!response.ok) {
    const message = String(payload?.error_description ?? payload?.message ?? payload?.error ?? "Discord rejected the OAuth refresh request.").trim();
    const error = new Error(`OAuth refresh failed (HTTP ${response.status}): ${message}`);
    error.oauthRefreshInvalid = response.status === 400 && String(payload?.error ?? "").toLowerCase() === "invalid_grant";
    error.oauthRefreshTransient = response.status === 429 || response.status >= 500;
    throw error;
  }
  const accessToken = String(payload?.access_token ?? "").trim();
  const nextRefreshToken = String(payload?.refresh_token ?? refreshToken).trim();
  const expiresIn = Number(payload?.expires_in);
  if (accessToken.length < 20 || nextRefreshToken.length < 20 || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    const error = new Error("Discord returned an incomplete OAuth refresh response.");
    error.oauthRefreshTransient = true;
    throw error;
  }
  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    expiresIn
  };
}

async function exchangeCommunityOAuthAuthorizationCode(config, code, redirectUri) {
  const response = await fetch(`${discordApiBase}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(payload?.error_description ?? payload?.message ?? payload?.error ?? "Discord rejected the OAuth code exchange.").trim();
    const error = new Error(`OAuth token exchange failed (HTTP ${response.status}): ${message}`);
    error.statusCode = response.status >= 500 ? 502 : 409;
    throw error;
  }
  const accessToken = String(payload?.access_token ?? "").trim();
  const refreshToken = String(payload?.refresh_token ?? "").trim();
  const expiresIn = Number(payload?.expires_in);
  if (accessToken.length < 20 || refreshToken.length < 20 || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    const error = new Error("Discord returned an incomplete OAuth authorization response.");
    error.statusCode = 502;
    throw error;
  }
  return { accessToken, refreshToken, expiresAt: new Date(Date.now() + expiresIn * 1000), expiresIn };
}

async function refreshStoredCommunityOAuthCredential(config, member, { force = false } = {}) {
  const discordUserId = String(member?.discord_user_id ?? "").trim();
  if (!isDiscordGuildId(discordUserId)) throw new Error("A valid Discord user is required for OAuth refresh.");
  const currentExpiry = new Date(member?.access_token_expires_at).getTime();
  if (!force && member?.encrypted_access_token && Number.isFinite(currentExpiry) && currentExpiry > Date.now() + communityOAuthRefreshEarlyMs) {
    return {
      accessToken: decryptCredential(member.encrypted_access_token),
      expiresAt: new Date(currentExpiry),
      refreshed: false
    };
  }

  const existingJob = communityOAuthRefreshJobs.get(discordUserId);
  if (existingJob) return existingJob;
  const job = (async () => {
    const current = await pool.query(
      `SELECT discord_user_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at
       FROM community_oauth_joins
       WHERE discord_user_id = $1 AND encrypted_refresh_token IS NOT NULL
       ORDER BY access_token_expires_at DESC NULLS LAST
       LIMIT 1`,
      [discordUserId]
    );
    const credential = current.rows[0] ?? member;
    const expiresAt = new Date(credential?.access_token_expires_at).getTime();
    if (!force && credential?.encrypted_access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + communityOAuthRefreshEarlyMs) {
      return { accessToken: decryptCredential(credential.encrypted_access_token), expiresAt: new Date(expiresAt), refreshed: false };
    }
    if (!credential?.encrypted_refresh_token) {
      const error = new Error("OAuth refresh token is missing. Re-authorize this account before importing it again.");
      error.oauthAccessInvalid = true;
      throw error;
    }

    const refreshed = await exchangeCommunityOAuthRefreshToken(config, decryptCredential(credential.encrypted_refresh_token));
    const identity = await requestDiscord("oauth2/@me", { headers: { Authorization: `Bearer ${refreshed.accessToken}` } });
    const scopes = Array.isArray(identity.payload?.scopes) ? identity.payload.scopes.map(String) : [];
    if (!identity.response.ok || String(identity.payload?.user?.id ?? "") !== discordUserId || !scopes.includes("guilds.join")) {
      const error = new Error("The refreshed OAuth authorization is invalid or no longer includes guilds.join.");
      error.oauthAccessInvalid = true;
      throw error;
    }

    const encryptedAccessToken = encryptCredential(refreshed.accessToken);
    const encryptedRefreshToken = encryptCredential(refreshed.refreshToken);
    await pool.query(
      `UPDATE community_oauth_joins
       SET encrypted_access_token = $2,
           encrypted_refresh_token = $3,
           access_token_expires_at = $4,
           authorized_at = NOW(),
           status = CASE WHEN status = 'failed' AND COALESCE(details, '') ~* 'OAuth' THEN 'authorized' ELSE status END,
           details = CASE WHEN status = 'failed' AND COALESCE(details, '') ~* 'OAuth' THEN NULL ELSE details END
       WHERE discord_user_id = $1`,
      [discordUserId, encryptedAccessToken, encryptedRefreshToken, refreshed.expiresAt]
    );
    return { ...refreshed, refreshed: true };
  })().finally(() => communityOAuthRefreshJobs.delete(discordUserId));
  communityOAuthRefreshJobs.set(discordUserId, job);
  return job;
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

function removeBoostTokenTwoFactor(value) {
  const parts = String(value ?? "").split(":");
  return parts.length >= 4 ? parts.slice(0, -1).join(":") : String(value ?? "");
}

function normalizeBoostTokenStock(value) {
  const stock = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizeTokens = (tokens) => {
    const normalized = normalizeBoostTokenList(tokens);
    return stock.removeTwoFactor === true
      ? normalizeBoostTokenList(normalized.map(removeBoostTokenTwoFactor))
      : normalized;
  };
  return {
    oneMonth: normalizeTokens(stock.oneMonthTokens ?? stock.oneMonth),
    threeMonth: normalizeTokens(stock.threeMonthTokens ?? stock.threeMonth)
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
  return Math.min(Math.max(Number.parseInt(value, 10) || defaultDcordBoostConcurrency, 1), 4);
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

const communityAuthorizationSyncJobs = new Map();

function getCommunityAuthorizationSyncSnapshot(guildId, stockType = null) {
  const jobs = stockType
    ? [communityAuthorizationSyncJobs.get(`${String(guildId ?? "")}:${stockType}`)]
    : [...communityAuthorizationSyncJobs.values()];
  const job = jobs.find(Boolean);
  if (!job) return null;
  return {
    syncing: job.syncing === true,
    total: Number(job.total ?? 0),
    checked: Number(job.checked ?? 0),
    inactive: Number(job.inactive ?? 0),
    reactivated: Number(job.reactivated ?? 0),
    removed: Number(job.removed ?? 0),
    errors: Number(job.errors ?? 0),
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    error: job.error ?? null
  };
}

function startCommunityAuthorizationSync(config, stockType) {
  const guildId = String(config.guildId);
  const jobKey = `${guildId}:${stockType}`;
  const existing = communityAuthorizationSyncJobs.get(jobKey);
  if (existing?.syncing) return { started: false, ...getCommunityAuthorizationSyncSnapshot(guildId, stockType) };

  const job = {
    syncing: true,
    total: 0,
    checked: 0,
    inactive: 0,
    reactivated: 0,
    removed: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null
  };
  communityAuthorizationSyncJobs.set(jobKey, job);
  void syncCommunityAuthorizations(config, stockType, (progress) => Object.assign(job, progress)).then((summary) => {
    Object.assign(job, summary, { syncing: false, completedAt: new Date().toISOString() });
  }).catch((error) => {
    job.syncing = false;
    job.errors += 1;
    job.error = error instanceof Error ? error.message : "Members Stock refresh failed.";
    job.completedAt = new Date().toISOString();
    console.error("Members Stock refresh failed:", job.error);
  });
  return { started: true, ...getCommunityAuthorizationSyncSnapshot(guildId, stockType) };
}

async function syncCommunityAuthorizations(config, stockType, onProgress = () => {}) {
  const result = await pool.query(
    `SELECT discord_user_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, authorized_at, status, details
     FROM community_oauth_joins
     WHERE guild_id = $1 AND stock_type = $2 AND encrypted_access_token IS NOT NULL
     ORDER BY authorized_at ASC`,
    [config.guildId, stockType]
  );
  const summary = { total: result.rows.length, checked: 0, inactive: 0, reactivated: 0, removed: 0, errors: 0 };
  onProgress(summary);

  const failedResults = await pool.query(
    `SELECT result->>'discordUserId' AS discord_user_id, result->>'completedAt' AS completed_at
     FROM tracked_orders
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(payload->'communityResults') = 'array' THEN payload->'communityResults' ELSE '[]'::jsonb END
     ) AS result
     WHERE payload->>'provider' = 'community'
       AND payload->>'serverId' = $1
       AND LOWER(COALESCE(result->>'state', '')) = 'failed'
       AND (
         LOWER(COALESCE(result->>'authorizationStatus', '')) = 'inactive'
         OR COALESCE(result->>'details', '') ~* '(unknown user|discord code 10013|discord code 50178|user account must first be verified)'
       )
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
  await forEachWithConcurrency(result.rows, 4, async (member) => {
    summary.checked += 1;
    let shouldMarkInactive = false;
    try {
      const expiresAt = new Date(member.access_token_expires_at).getTime();
      let accessToken = null;
      if (member.encrypted_refresh_token && (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + communityOAuthRefreshEarlyMs)) {
        accessToken = (await refreshStoredCommunityOAuthCredential(config, member, { force: true })).accessToken;
      } else if (member.encrypted_access_token && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        accessToken = decryptCredential(member.encrypted_access_token);
      }
      if (!accessToken) {
        shouldMarkInactive = true;
      } else {
        let identity = await requestDiscord("oauth2/@me", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (identity.response.status === 401 && member.encrypted_refresh_token) {
          accessToken = (await refreshStoredCommunityOAuthCredential(config, member, { force: true })).accessToken;
          identity = await requestDiscord("oauth2/@me", { headers: { Authorization: `Bearer ${accessToken}` } });
        }
        const identityUserId = String(identity.payload?.user?.id ?? "");
        if (identity.response.status === 401) {
          shouldMarkInactive = true;
        } else if (!identity.response.ok) {
          summary.errors += 1;
        } else if (identityUserId !== member.discord_user_id) {
          shouldMarkInactive = true;
        } else {
          const oauthUser = identity.payload.user;
          const username = String(oauthUser?.username ?? `Discord user ${member.discord_user_id}`).trim().slice(0, 100);
          const displayName = String(oauthUser?.global_name ?? "").trim().slice(0, 100) || null;
          const canReactivate = String(member.status).toLowerCase() === "failed"
            && /^OAuth access token/i.test(String(member.details ?? ""));
          await pool.query(
            `UPDATE community_oauth_joins
             SET username = $3,
                 display_name = $4,
                 status = CASE WHEN $5 THEN 'authorized' ELSE status END,
                 details = CASE WHEN $5 OR status <> 'failed' THEN NULL ELSE details END
             WHERE discord_user_id = $1 AND guild_id = $2`,
            [member.discord_user_id, config.guildId, username, displayName, canReactivate]
          );
          if (canReactivate) summary.reactivated += 1;
        }
      }
    } catch (error) {
      if (error?.oauthRefreshInvalid || error?.oauthAccessInvalid) shouldMarkInactive = true;
      else summary.errors += 1;
    }
    if (shouldMarkInactive) {
      const inactive = await pool.query(
        `UPDATE community_oauth_joins
         SET status = 'failed', details = 'OAuth authorization expired or became invalid and could not be refreshed.', reserved_order_id = NULL
         WHERE discord_user_id = $1 AND guild_id = $2`,
        [member.discord_user_id, config.guildId]
      );
      if (String(member.status).toLowerCase() !== "failed") summary.inactive += inactive.rowCount;
      summary.removed = summary.inactive;
    }
    onProgress(summary);
  });

  summary.removed = summary.inactive;
  onProgress(summary);
  return summary;
}

async function refreshCommunityOAuthTokensDue(config, limit = 5_000) {
  if (!config?.configured) return { checked: 0, refreshed: 0, inactive: 0, errors: 0 };
  const due = await pool.query(
    `SELECT DISTINCT ON (discord_user_id)
            discord_user_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at
     FROM community_oauth_joins
     WHERE encrypted_refresh_token IS NOT NULL
       AND (access_token_expires_at IS NULL OR access_token_expires_at <= NOW() + ($1 * INTERVAL '1 millisecond'))
     ORDER BY discord_user_id, access_token_expires_at DESC NULLS LAST
     LIMIT $2`,
    [communityOAuthRefreshEarlyMs, Math.min(Math.max(Number(limit) || 5_000, 1), 5_000)]
  );
  const summary = { checked: due.rows.length, refreshed: 0, inactive: 0, errors: 0 };
  await forEachWithConcurrency(due.rows, 2, async (member) => {
    try {
      const refreshed = await refreshStoredCommunityOAuthCredential(config, member);
      if (refreshed.refreshed) summary.refreshed += 1;
    } catch (error) {
      if (error?.oauthRefreshInvalid || error?.oauthAccessInvalid) {
        const inactive = await pool.query(
          `UPDATE community_oauth_joins
           SET status = 'failed',
               details = 'OAuth refresh token is invalid. Re-authorize this account.',
               reserved_order_id = NULL
           WHERE discord_user_id = $1`,
          [member.discord_user_id]
        );
        summary.inactive += inactive.rowCount;
      } else {
        summary.errors += 1;
      }
    }
  });
  return summary;
}

async function checkCommunityOrderAuthorizations(order, onProgress = () => {}) {
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
  onProgress({ active: true, total: discordUserIds.length, checked: 0, stage: "onliner" });
  const onlinerEnabledUserIds = new Set(order.communityResults
    .filter((item) => isCommunityOnlinerCheckEnabled(order, item))
    .map((item) => String(item?.discordUserId ?? ""))
    .filter(isDiscordGuildId));
  const onlinerConfig = onlinerEnabledUserIds.size ? await getDiscordOnlinerConfig() : null;
  const onlinerSnapshot = onlinerConfig ? await getDiscordOnlinerSnapshotForApi(onlinerConfig) : { accounts: [] };
  const onlinerAccountByUserId = new Map();
  const configuredAccountById = new Map((onlinerConfig?.accounts ?? []).map((account) => [account.id, account]));
  for (const account of onlinerSnapshot.accounts ?? []) {
    const configuredAccount = configuredAccountById.get(account.id);
    const configuredUserId = String(configuredAccount?.discordUserId ?? "").trim();
    const runtimeUserId = String(account?.bot?.id ?? "").trim();
    const discordUserId = isDiscordGuildId(configuredUserId) ? configuredUserId : runtimeUserId;
    if (isDiscordGuildId(discordUserId)) onlinerAccountByUserId.set(discordUserId, account);
  }
  const onlinerCheckedAt = new Date().toISOString();
  const stock = discordUserIds.length
    ? await pool.query(
        `SELECT DISTINCT ON (discord_user_id)
                discord_user_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at
         FROM community_oauth_joins
         WHERE discord_user_id = ANY($1::text[])
         ORDER BY discord_user_id,
                  (encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()) DESC,
                  access_token_expires_at DESC NULLS LAST,
                  authorized_at DESC NULLS LAST`,
        [discordUserIds]
      )
    : { rows: [] };
  const stockByUserId = new Map(stock.rows.map((row) => [String(row.discord_user_id), row]));
  const checks = new Map();
  onProgress({ active: true, total: discordUserIds.length, checked: 0, stage: "members" });

  for (let start = 0; start < discordUserIds.length; start += 10) {
    const batch = discordUserIds.slice(start, start + 10);
    const results = await Promise.all(batch.map(async (discordUserId) => {
      const record = stockByUserId.get(discordUserId);
      const checkOnliner = onlinerEnabledUserIds.has(discordUserId);
      const onlinerAccount = checkOnliner ? onlinerAccountByUserId.get(discordUserId) : null;
      const onlinerConnectionState = checkOnliner
        ? onlinerAccount
          ? normalizeDiscordOnlinerConnectionState(onlinerAccount.connectionState)
          : "disconnected"
        : undefined;
      const onlinerLive = checkOnliner
        ? onlinerConfig.enabled !== false && Boolean(onlinerAccount) && onlinerConnectionState === "connected"
        : undefined;
      const onlinerFields = checkOnliner ? {
        onlinerLive,
        onlinerConnectionState,
        onlinerDetails: onlinerLive
          ? "This member is Live in Onliner."
          : onlinerAccount?.lastError
            ? `This member is not Live in Onliner: ${String(onlinerAccount.lastError).trim()}`
            : onlinerAccount
              ? `This member is not Live in Onliner (${onlinerConnectionState}).`
              : "This member is not connected to Onliner.",
        onlinerCheckedAt
      } : {};
      let membershipStatus = "unknown";
      let membershipDetails = "Server membership could not be verified right now.";
      try {
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
          membershipStatus = "removed";
          membershipDetails = "This member is no longer in the Discord server.";
          communityMemberPresenceCache.set(`${targetGuildId}:${discordUserId}`, { present: false, expiresAt: Date.now() + 5 * 60_000 });
        } else if (guildMember.response.ok) {
          membershipStatus = "present";
          membershipDetails = "This member is in the Discord server.";
          communityMemberPresenceCache.set(`${targetGuildId}:${discordUserId}`, { present: true, expiresAt: Date.now() + 60_000 });
        }
      } catch {
        // Keep membership unknown; an unknown result must not grant replacement.
      }
      let accessToken = null;
      try {
        const expiresAt = new Date(record?.access_token_expires_at).getTime();
        if (record?.encrypted_refresh_token && (!record?.encrypted_access_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + communityOAuthRefreshEarlyMs)) {
          accessToken = (await refreshStoredCommunityOAuthCredential(config, record)).accessToken;
        } else if (record?.encrypted_access_token && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
          accessToken = decryptCredential(record.encrypted_access_token);
        }
        if (!accessToken) {
          return [discordUserId, { status: "inactive", details: "OAuth access token is missing or expired and no refresh token is available.", membershipStatus, membershipDetails, ...onlinerFields }];
        }
        let identity = await requestDiscord("oauth2/@me", {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (identity.response.status === 429) {
          const retrySeconds = Math.min(Math.max(Number(identity.payload?.retry_after) || 1, 1), 5);
          await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
          identity = await requestDiscord("oauth2/@me", {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
        }
        if (identity.response.status === 401 && record?.encrypted_refresh_token) {
          try {
            accessToken = (await refreshStoredCommunityOAuthCredential(config, record, { force: true })).accessToken;
            identity = await requestDiscord("oauth2/@me", { headers: { Authorization: `Bearer ${accessToken}` } });
          } catch (error) {
            if (error?.oauthRefreshInvalid || error?.oauthAccessInvalid) {
              return [discordUserId, { status: "inactive", details: "OAuth authorization could not be refreshed and is no longer valid.", membershipStatus, membershipDetails, ...onlinerFields }];
            }
            return [discordUserId, { status: "unknown", details: "OAuth refresh could not be completed right now.", membershipStatus, membershipDetails, ...onlinerFields }];
          }
        }
        if (!identity.response.ok || String(identity.payload?.user?.id ?? "") !== discordUserId) {
          if (identity.response.status === 401 || identity.response.ok) {
            return [discordUserId, { status: "inactive", details: "OAuth authorization is expired or invalid.", membershipStatus, membershipDetails, ...onlinerFields }];
          }
          return [discordUserId, { status: "unknown", details: `Discord could not verify OAuth authorization (HTTP ${identity.response.status}).`, membershipStatus, membershipDetails, ...onlinerFields }];
        }
        return [discordUserId, {
          status: "active",
          details: "OAuth authorization is active.",
          membershipStatus,
          membershipDetails,
          ...onlinerFields
        }];
      } catch (error) {
        if (error?.oauthRefreshInvalid || error?.oauthAccessInvalid) {
          return [discordUserId, { status: "inactive", details: "OAuth authorization could not be refreshed and is no longer valid.", membershipStatus, membershipDetails, ...onlinerFields }];
        }
        return [discordUserId, { status: "unknown", details: "OAuth authorization could not be checked right now.", membershipStatus, membershipDetails, ...onlinerFields }];
      }
    }));
    results.forEach(([discordUserId, result]) => checks.set(discordUserId, result));
    onProgress({ active: true, total: discordUserIds.length, checked: Math.min(start + results.length, discordUserIds.length), stage: "members" });
  }

  const inactiveUserIds = [...checks.entries()].filter(([, check]) => check.status === "inactive").map(([discordUserId]) => discordUserId);
  const activeUserIds = [...checks.entries()].filter(([, check]) => check.status === "active").map(([discordUserId]) => discordUserId);
  if (inactiveUserIds.length) {
    await pool.query(
      `UPDATE community_oauth_joins
       SET status = 'failed', details = 'OAuth authorization expired or became invalid and could not be refreshed.', reserved_order_id = NULL
       WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])`,
       [config.guildId, inactiveUserIds]
    );
  }
  if (activeUserIds.length) {
    await pool.query(
      `UPDATE community_oauth_joins
       SET status = 'authorized', details = NULL
       WHERE guild_id = $1
         AND discord_user_id = ANY($2::text[])
         AND status = 'failed'
         AND COALESCE(details, '') ~* 'OAuth'`,
      [config.guildId, activeUserIds]
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
      onlinerLive: check.onlinerLive,
      onlinerConnectionState: check.onlinerConnectionState,
      onlinerDetails: check.onlinerDetails,
      onlinerCheckedAt: check.onlinerCheckedAt,
      authorizationCheckedAt: checkedAt
    } : item;
  });
  const summary = {
    checked: checks.size,
    active: [...checks.values()].filter((check) => check.status === "active").length,
    inactive: inactiveUserIds.length,
    unknown: [...checks.values()].filter((check) => check.status === "unknown").length,
    onliner: {
      live: [...checks.values()].filter((check) => check.onlinerLive === true).length,
      offline: [...checks.values()].filter((check) => check.onlinerLive === false).length,
      skipped: discordUserIds.filter((discordUserId) => !onlinerEnabledUserIds.has(discordUserId)).length
    },
    checkedAt
  };
  const checkedOrder = { ...order, communityResults, memberCheckSummary: summary };
  onProgress({ active: true, total: discordUserIds.length, checked: discordUserIds.length, stage: "saving" });
  await saveTrackedOrderPayload(checkedOrder);
  return { order: checkedOrder, summary };
}

async function runCommunityOrderMemberCheck(order) {
  const uniqid = String(order?.uniqid ?? "").trim();
  const existing = communityOrderMemberCheckProgress.get(uniqid);
  if (existing?.active) {
    const error = new Error("This member check is already running.");
    error.statusCode = 409;
    throw error;
  }
  const initial = {
    active: true,
    total: Array.isArray(order?.communityResults) ? order.communityResults.length : 0,
    checked: 0,
    stage: "starting",
    startedAt: new Date().toISOString()
  };
  communityOrderMemberCheckProgress.set(uniqid, initial);
  try {
    const result = await checkCommunityOrderAuthorizations(order, (progress) => {
      communityOrderMemberCheckProgress.set(uniqid, { ...initial, ...progress });
    });
    communityOrderMemberCheckProgress.set(uniqid, {
      ...initial,
      active: false,
      total: result.summary.checked,
      checked: result.summary.checked,
      stage: "complete",
      completedAt: new Date().toISOString()
    });
    return result;
  } catch (error) {
    communityOrderMemberCheckProgress.set(uniqid, {
      ...initial,
      active: false,
      stage: "failed",
      message: error instanceof Error ? error.message : "Member check failed."
    });
    throw error;
  } finally {
    const cleanup = setTimeout(() => communityOrderMemberCheckProgress.delete(uniqid), 60_000);
    cleanup.unref?.();
  }
}

async function leaveAllCommunityOrderMembers(order) {
  const orderId = String(order?.uniqid ?? "").trim();
  const guildId = String(order?.serverId ?? "").trim();
  const results = Array.isArray(order?.communityResults) ? order.communityResults : [];
  if (!orderId || !isDiscordGuildId(guildId) || !results.length) {
    const error = new Error("This Members order has no accounts that can leave the server.");
    error.statusCode = 409;
    throw error;
  }
  if (communityOrderLeaveAllActive.has(orderId)) {
    const error = new Error("Leave all is already running for this order.");
    error.statusCode = 409;
    throw error;
  }

  communityOrderLeaveAllActive.add(orderId);
  try {
    const userIds = [...new Set(results
      .filter((item) => String(item?.membershipStatus ?? "").toLowerCase() !== "removed")
      .map((item) => String(item?.discordUserId ?? ""))
      .filter(isDiscordGuildId))];
    if (!userIds.length) {
      const error = new Error("Every account in this order has already left the server.");
      error.statusCode = 409;
      throw error;
    }
    const stock = await pool.query(
      `SELECT discord_user_id, encrypted_account_token
       FROM community_oauth_joins
       WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])`,
      [guildId, userIds]
    );
    const stockByUserId = new Map(stock.rows.map((member) => [String(member.discord_user_id), member]));
    const onlinerConfig = await getDiscordOnlinerConfig();
    const outcomeByUserId = new Map();

    await forEachWithConcurrency(userIds, 6, async (discordUserId) => {
      const member = stockByUserId.get(discordUserId);
      if (!member?.encrypted_account_token) {
        outcomeByUserId.set(discordUserId, { state: "failed", details: "No saved user token exists for this stock account." });
        return;
      }

      let accountToken = "";
      try {
        accountToken = decryptCredential(member.encrypted_account_token);
      } catch {
        outcomeByUserId.set(discordUserId, { state: "failed", details: "The saved user token could not be decrypted." });
        return;
      }
      const onlinerAccount = onlinerConfig.accounts.find((account) => String(account.discordUserId ?? "") === discordUserId)
        ?? onlinerConfig.accounts.find((account) => account.botToken === accountToken);
      const proxyUrl = normalizeDiscordOnlinerProxyUrl(onlinerAccount?.proxyUrl);
      if (!proxyUrl) {
        outcomeByUserId.set(discordUserId, { state: "failed", details: "The account has no assigned Onliner proxy; no direct request was sent." });
        return;
      }

      try {
        let leave = await requestDiscordThroughProxy(`users/@me/guilds/${encodeURIComponent(guildId)}`, proxyUrl, {
          method: "DELETE",
          cache: "no-store",
          headers: { Authorization: accountToken }
        });
        if (leave.response.status === 429) {
          const retrySeconds = Math.min(Math.max(Number(leave.payload?.retry_after) || 1, 1), 10);
          await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
          leave = await requestDiscordThroughProxy(`users/@me/guilds/${encodeURIComponent(guildId)}`, proxyUrl, {
            method: "DELETE",
            cache: "no-store",
            headers: { Authorization: accountToken }
          });
        }
        if (leave.response.status === 204) {
          outcomeByUserId.set(discordUserId, { state: "left", details: "Account left the Discord server through its assigned Onliner proxy." });
          communityMemberPresenceCache.set(`${guildId}:${discordUserId}`, { present: false, expiresAt: Date.now() + 60_000 });
        } else if (leave.response.status === 404) {
          outcomeByUserId.set(discordUserId, { state: "already_left", details: "Account was already outside the Discord server." });
          communityMemberPresenceCache.set(`${guildId}:${discordUserId}`, { present: false, expiresAt: Date.now() + 60_000 });
        } else {
          outcomeByUserId.set(discordUserId, {
            state: "failed",
            details: getDiscordRequestFailureDetails("Discord leave server", leave)
          });
        }
      } catch (error) {
        outcomeByUserId.set(discordUserId, {
          state: "failed",
          details: error instanceof Error ? error.message : "The proxied leave request failed."
        });
      }
    });

    const checkedAt = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [orderId]);
      const current = locked.rows[0]?.payload;
      if (!current || current.provider !== "community" || !Array.isArray(current.communityResults)) {
        await client.query("ROLLBACK");
        const error = new Error("Members order could not be found after the leave operation.");
        error.statusCode = 404;
        throw error;
      }
      const communityResults = current.communityResults.map((item) => {
        const outcome = outcomeByUserId.get(String(item?.discordUserId ?? ""));
        if (!outcome) return item;
        if (outcome.state === "failed") {
          return { ...item, membershipDetails: outcome.details, membershipCheckedAt: checkedAt };
        }
        return {
          ...item,
          membershipStatus: "removed",
          membershipDetails: outcome.details,
          membershipCheckedAt: checkedAt,
          leftServerAt: checkedAt
        };
      });
      const updatedOrder = { ...current, communityResults };
      await client.query(
        "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
        [orderId, JSON.stringify(updatedOrder)]
      );
      await client.query("COMMIT");
      const outcomes = [...outcomeByUserId.values()];
      return {
        order: updatedOrder,
        summary: {
          total: userIds.length,
          left: outcomes.filter((item) => item.state === "left").length,
          alreadyLeft: outcomes.filter((item) => item.state === "already_left").length,
          failed: outcomes.filter((item) => item.state === "failed").length
        }
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    communityOrderLeaveAllActive.delete(orderId);
  }
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

function answerCommunityApplicationField(field) {
  const answered = { ...field };
  const fieldType = String(field?.field_type ?? "").toUpperCase();
  if (fieldType === "TERMS") answered.response = true;
  if (fieldType === "TEXT_INPUT" || fieldType === "PARAGRAPH") {
    answered.response = "I would like to join this server.";
  }
  if (fieldType === "MULTIPLE_CHOICE") answered.response = 0;
  return answered;
}

async function submitCommunityJoinRequest(config, inviteValue, member) {
  const inviteCode = extractDiscordInviteCode(inviteValue);
  if (!inviteCode) {
    const error = new Error("Experimental Join requires a valid Discord invite link.");
    error.discordJoinRequest = true;
    throw error;
  }
  const inviteInfo = await resolveDiscordInvite(inviteCode);
  if (inviteInfo.guildId !== String(config.guildId)) {
    const error = new Error("The Experimental Join invite no longer points to this order's server.");
    error.discordJoinRequest = true;
    throw error;
  }
  if (inviteInfo.bypassesJoinApplication === true) {
    const error = new Error("Experimental Join cannot use an invite with Bypass Join Application enabled.");
    error.discordJoinRequest = true;
    throw error;
  }
  if (!member?.encrypted_account_token) {
    const error = new Error("This stock account has no saved user token. Add the account again before using Experimental Join.");
    error.accountTokenInvalid = true;
    throw error;
  }

  const accountToken = decryptCredential(member.encrypted_account_token);
  const authorization = { Authorization: accountToken };
  const onlinerConfig = await getDiscordOnlinerConfig();
  const onlinerAccount = onlinerConfig.accounts.find((account) =>
    String(account.discordUserId ?? "") === String(member.discord_user_id)
  ) ?? onlinerConfig.accounts.find((account) => account.botToken === accountToken);
  const proxyUrl = normalizeDiscordOnlinerProxyUrl(onlinerAccount?.proxyUrl);
  if (!proxyUrl) {
    const error = new Error("Experimental Join requires this account to be connected to Onliner with an assigned proxy.");
    error.discordJoinRequest = true;
    throw error;
  }
  const currentMember = await requestDiscord(
    `guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(member.discord_user_id)}`,
    { cache: "no-store", headers: { Authorization: `Bot ${config.botToken}` } }
  );
  if (currentMember.response.ok) return { alreadyMember: true, response: currentMember.response, payload: currentMember.payload };
  if (currentMember.response.status !== 404) {
    const error = new Error(getDiscordRequestFailureDetails("Discord member check", currentMember));
    error.discordJoinRequest = true;
    throw error;
  }

  let inviteAcceptance = await requestDiscordThroughProxy(
    `invites/${encodeURIComponent(inviteCode)}`,
    proxyUrl,
    {
      method: "POST",
      cache: "no-store",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
  if (inviteAcceptance.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(inviteAcceptance.payload?.retry_after) || 1, 1), 10);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    inviteAcceptance = await requestDiscordThroughProxy(
      `invites/${encodeURIComponent(inviteCode)}`,
      proxyUrl,
      {
        method: "POST",
        cache: "no-store",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({})
      }
    );
  }
  if (!inviteAcceptance.response.ok) {
    const error = new Error(getDiscordRequestFailureDetails("Discord invite acceptance", inviteAcceptance));
    error.accountTokenInvalid = inviteAcceptance.response.status === 401;
    error.discordJoinRequest = true;
    throw error;
  }

  const params = new URLSearchParams({ with_guild: "false", invite_code: inviteCode });
  let verification = await requestDiscordThroughProxy(
    `guilds/${encodeURIComponent(config.guildId)}/member-verification?${params.toString()}`,
    proxyUrl,
    { cache: "no-store", headers: authorization }
  );
  if (verification.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(verification.payload?.retry_after) || 1, 1), 10);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    verification = await requestDiscordThroughProxy(
      `guilds/${encodeURIComponent(config.guildId)}/member-verification?${params.toString()}`,
      proxyUrl,
      { cache: "no-store", headers: authorization }
    );
  }
  if (!verification.response.ok) {
    const error = new Error(getDiscordRequestFailureDetails("Discord Apply-to-Join form read", verification));
    error.accountTokenInvalid = verification.response.status === 401;
    error.discordJoinRequest = true;
    throw error;
  }

  const formFields = Array.isArray(verification.payload?.form_fields)
    ? verification.payload.form_fields.map(answerCommunityApplicationField)
    : [];
  if (!formFields.some((field) => communityApplicationFieldTypes.has(String(field?.field_type ?? "").toUpperCase()))) {
    const error = new Error("Discord did not return an Apply-to-Join application question for this server.");
    error.discordJoinRequest = true;
    throw error;
  }

  let application = await requestDiscordThroughProxy(
    `guilds/${encodeURIComponent(config.guildId)}/requests/@me`,
    proxyUrl,
    {
      method: "PUT",
      cache: "no-store",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ version: verification.payload?.version ?? null, form_fields: formFields })
    }
  );
  if (application.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(application.payload?.retry_after) || 1, 1), 10);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    application = await requestDiscordThroughProxy(
      `guilds/${encodeURIComponent(config.guildId)}/requests/@me`,
      proxyUrl,
      {
        method: "PUT",
        cache: "no-store",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ version: verification.payload?.version ?? null, form_fields: formFields })
      }
    );
  }
  if (!application.response.ok) {
    const error = new Error(getDiscordRequestFailureDetails("Discord Apply-to-Join submission", application));
    error.accountTokenInvalid = application.response.status === 401;
    error.discordJoinRequest = true;
    throw error;
  }
  return { ...application, alreadyMember: false };
}

async function joinCommunityDirectly(config, inviteValue, member) {
  const inviteCode = extractDiscordInviteCode(inviteValue);
  if (!inviteCode) {
    const error = new Error("Directly requires a valid Discord invite link.");
    error.discordDirectJoin = true;
    throw error;
  }
  if (!member?.encrypted_account_token) {
    const error = new Error("This stock account has no saved user token. Add the account again before using Directly.");
    error.accountTokenInvalid = true;
    throw error;
  }

  const accountToken = decryptCredential(member.encrypted_account_token);
  const onlinerConfig = await getDiscordOnlinerConfig();
  const onlinerAccount = onlinerConfig.accounts.find((account) =>
    String(account.discordUserId ?? "") === String(member.discord_user_id)
  ) ?? onlinerConfig.accounts.find((account) => account.botToken === accountToken);
  const proxyUrl = normalizeDiscordOnlinerProxyUrl(onlinerAccount?.proxyUrl);
  if (!proxyUrl) {
    const error = new Error("Directly requires this account to have an assigned Onliner proxy.");
    error.discordDirectJoin = true;
    throw error;
  }

  const result = await runDcordBoostToken(accountToken, inviteValue, {
    boost: false,
    proxy: normalizeDcordProxyForDcord(proxyUrl)
  });
  const message = String(result?.boostMessage ?? "").trim();
  if (result?.success === true && result?.joinStatus === "joined") {
    return { alreadyMember: false, pendingScreening: false, dcordTaskId: result.dcordTaskId };
  }
  if (/already.{0,20}(member|guild|server)|(?:member|guild|server).{0,20}already/i.test(message)) {
    return { alreadyMember: true, pendingScreening: false, dcordTaskId: result?.dcordTaskId };
  }

  const error = new Error(message || "Dcord could not join this account to the server.");
  error.statusCode = Number.isFinite(result?.httpStatus) ? result.httpStatus : undefined;
  error.accountTokenInvalid = /invalid token|unauthorized|authentication|unknown user/i.test(message)
    || Number(result?.httpStatus) === 401;
  error.dcordJoin = true;
  error.dcordTaskId = result?.dcordTaskId;
  throw error;
}

function getDiscordRequestFailureDetails(label, result) {
  const status = Number(result?.response?.status ?? 0);
  const code = Number(result?.payload?.code ?? 0);
  const captchaRequired = Boolean(result?.payload?.captcha_sitekey)
    || (Array.isArray(result?.payload?.captcha_key) && result.payload.captcha_key.length > 0);
  const rawMessage = String(result?.payload?.message ?? "").trim();
  const rawText = String(result?.rawText ?? "").replace(/\s+/g, " ").trim();
  const message = captchaRequired
    ? "Discord requires CAPTCHA verification for this account or network."
    : rawMessage || (rawText && rawText !== "{}" ? rawText.slice(0, 300) : "Discord rejected the request.");
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

  if (!request && !lastListResult?.response?.ok) {
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

  // Discord may temporarily return only { total } from the list endpoint.
  // The legacy user-ID keyed action remains available as a narrow fallback.
  const requestId = String(request?.id ?? discordUserId ?? "").trim();
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

const communityBypassesVerificationFlag = 1 << 2;

async function approveCommunityPendingMemberVerification(config, discordUserId, currentMember) {
  const currentFlags = Number(currentMember?.flags);
  const normalizedFlags = Number.isSafeInteger(currentFlags) && currentFlags >= 0 ? currentFlags : 0;
  const approvedFlags = normalizedFlags | communityBypassesVerificationFlag;
  let approval = await requestDiscord(
    `guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(discordUserId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${config.botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ flags: approvedFlags })
    }
  );
  if (approval.response.status === 429) {
    const retrySeconds = Math.min(Math.max(Number(approval.payload?.retry_after) || 1, 1), 5);
    await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
    approval = await requestDiscord(
      `guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(discordUserId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bot ${config.botToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ flags: approvedFlags })
      }
    );
  }
  if (!approval.response.ok) {
    const status = Number(approval.response.status);
    const message = String(approval.payload?.message ?? "").trim();
    const error = new Error(
      status === 403
        ? "The Members bot needs Manage Server or Manage Roles permission to approve Discord member verification."
        : message || `Discord could not approve member verification (${status}).`
    );
    error.discordJoinRequest = true;
    throw error;
  }

  const returnedFlags = Number(approval.payload?.flags);
  if (Number.isSafeInteger(returnedFlags) && (returnedFlags & communityBypassesVerificationFlag) === 0) {
    const error = new Error("Discord updated the member but did not apply the verification approval flag.");
    error.discordJoinRequest = true;
    throw error;
  }

  return { joined: true, autoApproved: true, pendingScreening: false, manualVerification: true };
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
    if (member.payload?.pending === true) {
      return approveCommunityPendingMemberVerification(config, discordUserId, member.payload);
    }
    return {
      joined: true,
      autoApproved: false,
      pendingScreening: false,
      manualVerification: false
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
  return { joined: true, autoApproved: true, pendingScreening: false, manualVerification: false };
}

function isCommunityMembershipScreeningResponse(result) {
  const body = result?.payload;
  const message = String(body?.message ?? "").toLowerCase();
  if (body && typeof body === "object" && !Array.isArray(body) && body.pending === true) return true;
  return String(body?.application_status ?? "").toUpperCase() === "SUBMITTED"
    || /pending|screening|verification|member verification|membership|apply.to.join/i.test(message);
}

function isDiscordMemberAuthorizationInactive(value) {
  const payload = value?.payload && typeof value.payload === "object" ? value.payload : value;
  const code = Number(payload?.code ?? value?.code);
  const message = String(payload?.message ?? value?.message ?? value?.details ?? value?.discordError ?? "");
  return code === 10013
    || code === 50178
    || /unknown user|user account must first be verified/i.test(message);
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

async function loadCommunityAccessToken(member, config) {
  const expiresAt = new Date(member?.access_token_expires_at).getTime();
  if (member?.encrypted_refresh_token && (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + communityOAuthRefreshEarlyMs)) {
    return (await refreshStoredCommunityOAuthCredential(config, member)).accessToken;
  }
  if (!member?.encrypted_access_token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    const error = new Error("OAuth access token expired and no refresh token is available. Re-authorize this account.");
    error.oauthAccessInvalid = true;
    throw error;
  }
  return decryptCredential(member.encrypted_access_token);
}

function isCommunityAccountTokenInvalid(value) {
  return value?.accountTokenInvalid === true
    || Number(value?.response?.status ?? value?.status) === 401
    || Number(value?.payload?.code ?? value?.code) === 40002;
}

const communityBalancedDelayPattern = [30, 180, 75, 300, 120, 45, 240, 90, 150, 60, 210, 100];

function normalizeCommunitySpeedProfile(value) {
  const profile = String(value ?? "custom").trim().toLowerCase();
  return ["safe", "balanced", "fast"].includes(profile) ? profile : "custom";
}

function normalizeCommunityJoinMethod(value, fallback = "create_invite") {
  const method = String(value ?? fallback).trim().toLowerCase();
  return ["experimental_join", "directly"].includes(method) ? method : "create_invite";
}

function communityJoinMethodUsesAccountToken(value) {
  return ["experimental_join", "directly"].includes(normalizeCommunityJoinMethod(value));
}

function getCommunityOrderJoinMethod(order) {
  return normalizeCommunityJoinMethod(order?.joinMethod ?? (order?.experimentalJoin === true ? "experimental_join" : "create_invite"));
}

function resetCommunityResultVerification(result, overrides = {}) {
  const next = { ...result };
  delete next.authorizationStatus;
  delete next.authorizationDetails;
  delete next.authorizationCheckedAt;
  delete next.membershipStatus;
  delete next.membershipDetails;
  delete next.presenceStatus;
  delete next.presenceDetails;
  delete next.presenceCheckedAt;
  delete next.onlinerLive;
  delete next.onlinerConnectionState;
  delete next.onlinerDetails;
  delete next.onlinerCheckedAt;
  return { ...next, ...overrides };
}

function getCommunityBotUnavailableStatus(result) {
  const status = Number(result?.response?.status ?? 0);
  const code = Number(result?.payload?.code ?? 0);
  return status === 404 || code === 10004 || code === 50001
    ? status || 403
    : null;
}

async function runCommunityOrder(order, members, config) {
  const joinMethod = getCommunityOrderJoinMethod(order);
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
        if (storedReplacementAttempt > incomingReplacementAttempt) return stored;
        const merged = { ...stored, ...incoming };
        const reactionPriority = { waiting_for_message: 0, waiting_for_join: 1, failed: 2, pending: 3, completed: 4 };
        if ((reactionPriority[String(stored?.reactionState)] ?? -1) > (reactionPriority[String(incoming?.reactionState)] ?? -1)) {
          merged.reactionState = stored.reactionState;
          merged.reactionDetails = stored.reactionDetails;
          if (stored.reactionCompletedAt) merged.reactionCompletedAt = stored.reactionCompletedAt;
        }
        return merged;
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
        reactionMessageLink: currentPayload.reactionMessageLink ?? payload.reactionMessageLink ?? null,
        reactionMessage: currentPayload.reactionMessage ?? payload.reactionMessage ?? null,
        reactionCapacity: currentPayload.reactionCapacity ?? payload.reactionCapacity ?? 0,
        reactionRequests: Array.isArray(currentPayload.reactionRequests) ? currentPayload.reactionRequests : (payload.reactionRequests ?? []),
        added: mergedAdded,
        status: deliveryPaused ? "PAUSED" : status,
        details: deliveryPaused ? "Delivery paused." : details,
        delay: Number.isFinite(latestDelay) && latestDelay >= 0 ? latestDelay : order.delay,
        speedProfile: latestSpeedProfile,
        activeDelay: terminalStatusRequested ? null : currentPayload.activeDelay ?? payload.activeDelay ?? null,
        nextMemberAt: terminalStatusRequested ? null : currentPayload.nextMemberAt ?? payload.nextMemberAt ?? null,
        communityResults: mergedResults,
        ...(Array.isArray(payload.categoryAllocations) ? {
          categoryAllocations: payload.categoryAllocations.map((allocation) => ({
            ...allocation,
            added: mergedResults.filter((item) =>
              getCommunityResultStockType(payload, item) === allocation.categoryId
              && String(item?.state ?? "").toLowerCase() === "joined"
            ).length
          }))
        } : {}),
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
    if (joinMethod === "directly") return null;
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
      botInvite: createCommunityBotInvite(config, config.guildId, getCommunityOrderJoinMethod(order)),
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
    const missingBotStatus = joinMethod === "directly" ? null : await detectMissingCommunityBot();
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
    results[resultIndex] = resetCommunityResultVerification(results[resultIndex], {
      discordUserId: member.discord_user_id,
      username: member.username,
      avatarUrl: member.avatar_url ?? null,
      state: "joining",
      details: "Discord membership request is running."
    });
    if (!await saveCommunityProgress({ ...order, added, status: "PROCESS", details: `${added}/${order.amount} members delivered.`, communityResults: results })) return;

    let state = "failed";
    let details = "Member could not be added.";
    let botPauseIssue = null;
    let memberAuthorizationInvalid = false;
    try {
      if (joinMethod === "directly") {
        const directJoin = await joinCommunityDirectly(config, order.serverInvite, member);
        if (directJoin.alreadyMember) {
          state = "already_member";
          details = "User was already in the server.";
        } else {
          state = "joined";
          details = directJoin.pendingScreening
            ? "Member joined directly and is pending Discord's server-rules screening."
            : "Member joined through the Dcord Join API with its assigned Onliner proxy.";
          added += 1;
        }
      } else if (joinMethod === "experimental_join") {
        const application = await submitCommunityJoinRequest(config, order.serverInvite, member);
        if (application.alreadyMember) {
          state = "already_member";
          details = "User was already in the server.";
        } else {
          const approval = await resolveCommunityPendingJoin(config, member.discord_user_id);
          state = "joined";
          details = approval.autoApproved
            ? "Member submitted Apply to Join and was approved by the Members bot."
            : "Member joined through Apply to Join and is approved.";
          added += 1;
        }
      } else {
        const joined = await addCommunityGuildMember(config, member.discord_user_id, await loadCommunityAccessToken(member, config));
        if (isCommunityMembershipScreeningResponse(joined)) {
          if (joined.response.status === 201 && joined.payload?.pending === true) {
            state = "joined";
            details = "Member joined the server and is pending Discord's server-rules screening.";
            added += 1;
          } else {
            state = "blocked";
            details = getDiscordRequestFailureDetails("Discord Add Guild Member", joined);
          }
        } else if (joined.response.status === 201) {
          state = "joined";
          details = "Member joined the server.";
          added += 1;
        } else if (joined.response.status === 204) {
          state = "already_member";
          details = "User was already in the server.";
        } else {
          memberAuthorizationInvalid = isDiscordMemberAuthorizationInactive(joined);
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
      }
    } catch (error) {
      details = error instanceof Error ? error.message : details;
      memberAuthorizationInvalid = communityJoinMethodUsesAccountToken(joinMethod)
        ? isCommunityAccountTokenInvalid(error)
        : isDiscordMemberAuthorizationInactive(error);
      if (joinMethod === "experimental_join" && error?.discordJoinRequest && /permission|cannot verify|server access/i.test(details)) {
        botPauseIssue = {
          waitingCode: "discord_permissions",
          details: "Experimental Join needs the Members bot to have Manage Server, Kick Members, and Create Invite permissions.",
          memberDetails: "Waiting for the Members bot permissions required by Experimental Join."
        };
      }
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
    const reactionMessage = results[resultIndex]?.reactionMessage;
    if (state === "joined" && results[resultIndex]?.reactionEmoji && reactionMessage?.channelId && reactionMessage?.messageId) {
      const reactionEmoji = String(results[resultIndex].reactionEmoji);
      results[resultIndex] = {
        ...results[resultIndex],
        reactionState: "pending",
        reactionDetails: "Waiting for the Onliner Gateway connection before reacting."
      };
      await pool.query(
        `INSERT INTO community_reaction_jobs (order_id, discord_user_id, channel_id, message_id, emoji)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [order.uniqid, member.discord_user_id, reactionMessage.channelId, reactionMessage.messageId, reactionEmoji]
      );
    } else if (state === "joined" && results[resultIndex]?.reactionEligible) {
      results[resultIndex] = {
        ...results[resultIndex],
        reactionState: "waiting_for_message",
        reactionDetails: "Add a Discord message link from the Orders page to enable this reaction."
      };
    }
    const memberFailed = state === "failed";
    const memberShouldBeInactive = memberFailed && memberAuthorizationInvalid;
    results[resultIndex] = resetCommunityResultVerification(results[resultIndex], {
      discordUserId: member.discord_user_id,
      username: member.username,
      avatarUrl: member.avatar_url ?? null,
      state,
      details,
      completedAt: new Date().toISOString(),
      ...(memberShouldBeInactive ? {
        authorizationStatus: "inactive",
        authorizationDetails: "Discord reported that this member account cannot authorize delivery, so it was disabled in Members Stock.",
        authorizationCheckedAt: new Date().toISOString()
      } : {})
    });
    await pool.query(
      `UPDATE community_oauth_joins
       SET reserved_order_id = NULL,
           status = CASE WHEN $3 THEN 'failed' ELSE status END,
           details = CASE WHEN $3 THEN $4 ELSE details END
       WHERE discord_user_id = $1 AND guild_id = $2`,
      [member.discord_user_id, config.guildId, memberShouldBeInactive, memberShouldBeInactive ? `Delivery failed: ${details}` : null]
    );
    if (!await saveCommunityProgress({ ...order, added, status: "PROCESS", details: `${added}/${order.amount} members delivered.`, communityResults: results })) return;

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

async function processCommunityReplacement(orderId, resultIndex, member, config, joinMethod = "create_invite", serverInvite = "") {
  const normalizedJoinMethod = normalizeCommunityJoinMethod(joinMethod);
  let state = "failed";
  let details = "Replacement member could not be added.";
  let botPauseIssue = null;
  let memberAuthorizationInvalid = false;
  try {
    if (normalizedJoinMethod === "directly") {
      const directJoin = await joinCommunityDirectly(config, serverInvite, member);
      if (directJoin.alreadyMember) {
        state = "already_member";
        details = "Replacement user was already in the server.";
      } else {
        state = "joined";
        details = directJoin.pendingScreening
          ? "Replacement member joined directly and is pending Discord's server-rules screening."
          : "Replacement member joined through the Dcord Join API with its assigned Onliner proxy.";
      }
    } else if (normalizedJoinMethod === "experimental_join") {
      const application = await submitCommunityJoinRequest(config, serverInvite, member);
      if (application.alreadyMember) {
        state = "already_member";
        details = "Replacement user was already in the server.";
      } else {
        const approval = await resolveCommunityPendingJoin(config, member.discord_user_id);
        state = "joined";
        details = approval.autoApproved
          ? "Replacement member submitted Apply to Join and was approved by the Members bot."
          : "Replacement member joined through Apply to Join and is approved.";
      }
    } else {
      const joined = await addCommunityGuildMember(config, member.discord_user_id, await loadCommunityAccessToken(member, config));
      if (isCommunityMembershipScreeningResponse(joined)) {
        if (joined.response.status === 201 && joined.payload?.pending === true) {
          state = "joined";
          details = "Replacement member joined and is pending Discord's server-rules screening.";
        } else {
          state = "blocked";
          details = getDiscordRequestFailureDetails("Discord Add Guild Member", joined);
        }
      } else if (joined.response.status === 201) {
        state = "joined";
        details = "Replacement member joined the server.";
      } else if (joined.response.status === 204) {
        state = "already_member";
        details = "Replacement user was already in the server.";
      } else {
        memberAuthorizationInvalid = isDiscordMemberAuthorizationInactive(joined);
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
    }
  } catch (error) {
    details = error instanceof Error ? error.message : details;
    memberAuthorizationInvalid = communityJoinMethodUsesAccountToken(normalizedJoinMethod)
      ? isCommunityAccountTokenInvalid(error)
      : isDiscordMemberAuthorizationInactive(error);
    if (normalizedJoinMethod === "experimental_join" && error?.discordJoinRequest && /permission|cannot verify|server access/i.test(details)) {
      botPauseIssue = {
        waitingCode: "discord_permissions",
        details: "Experimental Join needs the Members bot to have Manage Server, Kick Members, and Create Invite permissions.",
        memberDetails: "Waiting for the Members bot permissions required by Experimental Join."
      };
    }
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
        botInvite: createCommunityBotInvite(config, config.guildId, getCommunityOrderJoinMethod(order)),
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
    if (state === "joined" && current?.reactionEmoji && current?.reactionMessage) {
      await client.query(
        `INSERT INTO community_reaction_jobs (order_id, discord_user_id, channel_id, message_id, emoji)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [orderId, member.discord_user_id, current.reactionMessage.channelId, current.reactionMessage.messageId, String(current.reactionEmoji)]
      );
    }
    results[resultIndex] = resetCommunityResultVerification(current, {
      state,
      details,
      completedAt: new Date().toISOString(),
      ...(state === "joined" && current?.reactionEmoji && current?.reactionMessage ? {
        reactionState: "pending",
        reactionDetails: "Waiting for the Onliner Gateway connection before reacting."
      } : {}),
      ...(state === "failed" && memberAuthorizationInvalid ? {
        authorizationStatus: "inactive",
        authorizationDetails: "Discord reported that this replacement account cannot authorize delivery, so it was disabled in Members Stock.",
        authorizationCheckedAt: new Date().toISOString()
      } : {})
    });
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
      const createPayload = { type: "join", token: extractDcordApiToken(token), invite, boost: options.boost !== false };
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

async function initializeDiscordOnlinerDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      encrypted_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("DELETE FROM app_settings WHERE setting_key = 'tokenu_api_key'");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_onliner_runtime (
      account_id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_onliner_worker_state (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      worker_id TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      started_at TIMESTAMPTZ,
      heartbeat_at TIMESTAMPTZ,
      last_error TEXT,
      connection_paused BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await pool.query("ALTER TABLE discord_onliner_worker_state ADD COLUMN IF NOT EXISTS connection_paused BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query(`
    INSERT INTO discord_onliner_worker_state (singleton, status)
    VALUES (TRUE, 'offline')
    ON CONFLICT (singleton) DO NOTHING
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_onliner_commands (
      id BIGSERIAL PRIMARY KEY,
      command_type TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      error TEXT
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS discord_onliner_commands_pending_idx ON discord_onliner_commands (status, id)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_onliner_persisted_logs (
      id BIGSERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      level TEXT NOT NULL,
      account_id TEXT,
      message TEXT NOT NULL
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS discord_onliner_persisted_logs_timestamp_idx ON discord_onliner_persisted_logs (timestamp DESC)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_reaction_jobs (
      order_id TEXT NOT NULL,
      request_id TEXT NOT NULL DEFAULT 'legacy',
      discord_user_id TEXT NOT NULL,
      account_id TEXT,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      PRIMARY KEY (order_id, request_id, discord_user_id, emoji)
    )
  `);
  await pool.query("ALTER TABLE community_reaction_jobs ADD COLUMN IF NOT EXISTS request_id TEXT NOT NULL DEFAULT 'legacy'");
  await pool.query("ALTER TABLE community_reaction_jobs DROP CONSTRAINT IF EXISTS community_reaction_jobs_pkey");
  await pool.query("ALTER TABLE community_reaction_jobs ADD PRIMARY KEY (order_id, request_id, discord_user_id, emoji)");
  await pool.query("CREATE INDEX IF NOT EXISTS community_reaction_jobs_pending_idx ON community_reaction_jobs (status, next_attempt_at)");
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS humanizer_packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS humanizer_packages_name_idx ON humanizer_packages (LOWER(name))");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS humanizer_avatar_assets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      image_data BYTEA NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    DELETE FROM humanizer_avatar_assets AS asset
    WHERE asset.created_at < NOW() - INTERVAL '24 hours'
      AND NOT EXISTS (
        SELECT 1
        FROM humanizer_packages AS pkg,
             JSONB_ARRAY_ELEMENTS(COALESCE(pkg.payload->'avatars', '[]'::jsonb)) AS avatar
        WHERE avatar->>'id' = asset.id
      )
  `);
  await initializeDiscordOnlinerDatabase();
  await pool.query("DROP TABLE IF EXISTS community_oauth_states");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_stock_category_tombstones (
      id TEXT PRIMARY KEY,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_stock_categories (
      guild_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_periodic BOOLEAN NOT NULL DEFAULT FALSE,
      check_replacement_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      reaction_use_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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
  await pool.query("ALTER TABLE community_stock_categories ADD COLUMN IF NOT EXISTS check_replacement_enabled BOOLEAN NOT NULL DEFAULT TRUE");
  await pool.query("ALTER TABLE community_stock_categories ADD COLUMN IF NOT EXISTS reaction_use_enabled BOOLEAN NOT NULL DEFAULT FALSE");
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
      display_name TEXT,
      avatar_url TEXT,
      encrypted_account_token TEXT,
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
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS encrypted_account_token TEXT");
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS display_name TEXT");
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT");
  await pool.query("ALTER TABLE community_oauth_joins ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ");
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
  // Older installations can contain a user-created "Offline"/"Online"
  // category with a generated ID while their stock still uses the legacy ID.
  // Reuse that category instead of attempting to insert a second name and
  // failing the unique (guild_id, lower(name)) index during startup.
  await pool.query(`
    UPDATE community_oauth_joins AS stock
    SET stock_type = category.id
    FROM community_stock_categories AS category
    WHERE category.guild_id = stock.guild_id
      AND LOWER(category.name) = 'offline'
      AND stock.stock_type = 'offline'
      AND NOT EXISTS (
        SELECT 1 FROM community_stock_categories AS legacy
        WHERE legacy.guild_id = stock.guild_id AND legacy.id = 'offline'
      )
  `);
  await pool.query(`
    UPDATE community_oauth_joins AS stock
    SET stock_type = category.id
    FROM community_stock_categories AS category
    WHERE category.guild_id = stock.guild_id
      AND LOWER(category.name) = 'online'
      AND stock.stock_type = 'online'
      AND NOT EXISTS (
        SELECT 1 FROM community_stock_categories AS legacy
        WHERE legacy.guild_id = stock.guild_id AND legacy.id = 'online'
      )
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
      AND details !~* '(Unknown User|10013|50178|user account must first be verified)'
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
              AND COALESCE(item->>'details', '') !~* '(Unknown User|10013|50178|user account must first be verified)'
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
          AND COALESCE(item->>'details', '') !~* '(Unknown User|10013|50178|user account must first be verified)'
      )
  `);
  if (serviceRunsWeb) {
    await pool.query("UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE reserved_order_id IS NOT NULL");
    await pool.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
    await recoverBlockedDcordJobOrders();
    await recoverPendingDcordOrders();
    await recoverInterruptedCommunityOrders();
  }
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

app.get("/api/humanizer/catalog", requireSession, async (_req, res, next) => {
  try {
    const communityConfig = await getCommunityOAuthConfig();
    if (!communityConfig.configured) {
      return res.status(503).json({ message: "Configure Members Stock before using Humanizer." });
    }
    const [members, categories, onlinerConfig] = await Promise.all([
      pool.query(
        `SELECT discord_user_id, username, display_name, avatar_url, stock_type, status,
                reserved_order_id, encrypted_account_token IS NOT NULL AS has_token
         FROM community_oauth_joins
         WHERE guild_id = $1
         ORDER BY stock_type ASC, sort_position ASC, authorized_at ASC`,
        [communityConfig.guildId]
      ),
      pool.query(
        "SELECT id, name FROM community_stock_categories WHERE guild_id = $1 ORDER BY created_at ASC",
        [communityConfig.guildId]
      ),
      getDiscordOnlinerConfig()
    ]);
    const categoryNames = new Map(categories.rows.map((category) => [String(category.id), String(category.name)]));
    const onlinerByUserId = new Map(
      onlinerConfig.accounts
        .filter((account) => isDiscordGuildId(account.discordUserId))
        .map((account) => [String(account.discordUserId), account])
    );
    res.set("Cache-Control", "no-store").json({
      categories: categories.rows.map((category) => ({ id: category.id, name: category.name })),
      accounts: members.rows.map((member) => {
        const onliner = onlinerByUserId.get(String(member.discord_user_id));
        return {
          id: member.discord_user_id,
          username: member.username,
          displayName: member.display_name,
          avatarUrl: member.avatar_url,
          categoryId: member.stock_type,
          categoryName: categoryNames.get(String(member.stock_type)) ?? member.stock_type,
          status: member.status,
          reserved: Boolean(member.reserved_order_id),
          hasToken: member.has_token === true,
          hasProxy: Boolean(normalizeDiscordOnlinerProxyUrl(onliner?.proxyUrl)),
          onlinerState: onliner ? "linked" : "not_linked"
        };
      })
    });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/humanizer/avatars",
  requireSession,
  express.raw({ type: [...humanizerAvatarMimeTypes], limit: "1mb" }),
  async (req, res, next) => {
    try {
      const mimeType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!humanizerAvatarMimeTypes.has(mimeType)) {
        return res.status(415).json({ message: "Avatar must be PNG, JPG, WEBP or GIF." });
      }
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ message: "Avatar file is empty." });
      }
      const name = String(req.query?.name ?? "Avatar").trim().slice(0, 120) || "Avatar";
      const id = crypto.randomUUID();
      const result = await pool.query(
        `INSERT INTO humanizer_avatar_assets (id, name, mime_type, image_data, size_bytes, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         RETURNING id, name, size_bytes`,
        [id, name, mimeType, req.body, req.body.length]
      );
      res.status(201).set("Cache-Control", "no-store").json(getHumanizerAvatarSnapshot(result.rows[0]));
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/humanizer/avatars/:avatarId", requireSession, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT mime_type, image_data FROM humanizer_avatar_assets WHERE id = $1 LIMIT 1",
      [String(req.params.avatarId ?? "")]
    );
    const asset = result.rows[0];
    if (!asset) return res.status(404).end();
    res.set({
      "Content-Type": asset.mime_type,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }).send(asset.image_data);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/humanizer/avatars/:avatarId", requireSession, async (req, res, next) => {
  try {
    const avatarId = String(req.params.avatarId ?? "");
    const result = await pool.query(
      `DELETE FROM humanizer_avatar_assets AS asset
       WHERE asset.id = $1
         AND NOT EXISTS (
           SELECT 1
           FROM humanizer_packages AS pkg,
                JSONB_ARRAY_ELEMENTS(COALESCE(pkg.payload->'avatars', '[]'::jsonb)) AS avatar
           WHERE avatar->>'id' = asset.id
         )
       RETURNING asset.id`,
      [avatarId]
    );
    res.json({ deleted: Boolean(result.rowCount) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/humanizer/packages", requireSession, async (_req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, payload, created_at, updated_at FROM humanizer_packages ORDER BY updated_at DESC, name ASC"
    );
    res.set("Cache-Control", "no-store").json(result.rows.map(getHumanizerPackageSnapshot));
  } catch (error) {
    next(error);
  }
});

app.post("/api/humanizer/packages", requireSession, async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ message: "Enter a package name." });

    const usernames = cleanHumanizerLines(req.body?.usernames, 1000, 32);
    const displayNames = cleanHumanizerLines(req.body?.displayNames, 1000, 32);
    const bios = cleanHumanizerLines(req.body?.bios, 1000, 190);
    const pronouns = cleanHumanizerLines(req.body?.pronouns, 1000, 40);
    const submittedAvatarIds = [...new Set(
      (Array.isArray(req.body?.avatars) ? req.body.avatars : [])
        .map((avatar) => String(avatar?.id ?? "").trim())
        .filter(Boolean)
    )].slice(0, 1000);
    const avatarResult = submittedAvatarIds.length
      ? await pool.query(
        "SELECT id, name, size_bytes FROM humanizer_avatar_assets WHERE id = ANY($1::text[])",
        [submittedAvatarIds]
      )
      : { rows: [] };
    const avatarById = new Map(avatarResult.rows.map((avatar) => [String(avatar.id), getHumanizerAvatarSnapshot(avatar)]));
    const avatars = submittedAvatarIds.map((id) => avatarById.get(id)).filter(Boolean);
    if (avatars.length !== submittedAvatarIds.length) {
      return res.status(400).json({ message: "One or more package avatars are no longer available." });
    }
    const hypesquad = ["random", "bravery", "brilliance", "balance"].includes(req.body?.hypesquad)
      ? req.body.hypesquad
      : "none";
    const concurrency = Math.min(Math.max(Number.parseInt(req.body?.concurrency, 10) || 2, 1), 5);
    if (!usernames.length && !displayNames.length && !bios.length && !pronouns.length && !avatars.length && hypesquad === "none") {
      return res.status(400).json({ message: "Add at least one profile change before saving a package." });
    }

    const enabledFields = normalizeHumanizerEnabledFields(req.body?.enabledFields);
    const configuredEnabledFields = enabledFields.filter((field) => {
      if (field === "username") return usernames.length > 0;
      if (field === "displayName") return displayNames.length > 0;
      if (field === "bio") return bios.length > 0;
      if (field === "pronouns") return pronouns.length > 0;
      if (field === "avatar") return avatars.length > 0;
      return hypesquad !== "none";
    });
    if (!configuredEnabledFields.length) {
      return res.status(400).json({ message: "Select at least one configured profile field before saving a package." });
    }

    const payload = { enabledFields: configuredEnabledFields, usernames, displayNames, bios, pronouns, avatars, hypesquad, concurrency };
    const result = await pool.query(
      `INSERT INTO humanizer_packages (id, name, payload, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW(), NOW())
       ON CONFLICT (LOWER(name)) DO UPDATE
       SET name = EXCLUDED.name, payload = EXCLUDED.payload, updated_at = NOW()
       RETURNING id, name, payload, created_at, updated_at`,
      [crypto.randomUUID(), name, JSON.stringify(payload)]
    );
    res.status(201).set("Cache-Control", "no-store").json(getHumanizerPackageSnapshot(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/humanizer/packages/:packageId", requireSession, async (req, res, next) => {
  try {
    const result = await pool.query("DELETE FROM humanizer_packages WHERE id = $1", [String(req.params.packageId ?? "")]);
    if (!result.rowCount) return res.status(404).json({ message: "Humanizer package was not found." });
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/humanizer/jobs/latest", requireSession, (_req, res) => {
  const latest = [...humanizerJobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  res.set("Cache-Control", "no-store").json(latest ? getHumanizerJobSnapshot(latest) : null);
});

app.get("/api/humanizer/jobs/:jobId", requireSession, (req, res) => {
  const job = humanizerJobs.get(String(req.params.jobId ?? ""));
  if (!job) return res.status(404).json({ message: "Humanizer job was not found." });
  res.set("Cache-Control", "no-store").json(getHumanizerJobSnapshot(job));
});

app.post("/api/humanizer/jobs", requireSession, async (req, res, next) => {
  try {
    const requestedAccountIds = [...new Set(
      (Array.isArray(req.body?.accountIds) ? req.body.accountIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(isDiscordGuildId)
    )].slice(0, 500);
    if (!requestedAccountIds.length) {
      return res.status(400).json({ message: "Select at least one Members Stock account." });
    }

    const enabledFields = new Set(normalizeHumanizerEnabledFields(req.body?.enabledFields));
    const usernames = enabledFields.has("username") ? cleanHumanizerLines(req.body?.usernames, 1000, 32) : [];
    const displayNames = enabledFields.has("displayName") ? cleanHumanizerLines(req.body?.displayNames, 1000, 32) : [];
    const bios = enabledFields.has("bio") ? cleanHumanizerLines(req.body?.bios, 1000, 190) : [];
    const pronouns = enabledFields.has("pronouns") ? cleanHumanizerLines(req.body?.pronouns, 1000, 40) : [];
    const avatarIds = enabledFields.has("avatar") ? [...new Set(
      (Array.isArray(req.body?.avatarIds) ? req.body.avatarIds : [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )].slice(0, 1000) : [];
    if (avatarIds.length) {
      const avatarCount = await pool.query(
        "SELECT COUNT(*)::int AS count FROM humanizer_avatar_assets WHERE id = ANY($1::text[])",
        [avatarIds]
      );
      if (Number(avatarCount.rows[0]?.count) !== avatarIds.length) {
        return res.status(400).json({ message: "One or more avatars are no longer available." });
      }
    }
    const hypesquad = enabledFields.has("hypesquad") && ["random", "bravery", "brilliance", "balance"].includes(req.body?.hypesquad)
      ? req.body.hypesquad
      : null;
    const concurrency = Math.min(Math.max(Number.parseInt(req.body?.concurrency, 10) || 1, 1), 5);
    if (!usernames.length && !displayNames.length && !bios.length && !pronouns.length && !avatarIds.length && !hypesquad) {
      return res.status(400).json({ message: "Enable at least one profile change and add its content." });
    }

    const communityConfig = await getCommunityOAuthConfig();
    if (!communityConfig.configured) {
      return res.status(503).json({ message: "Configure Members Stock before using Humanizer." });
    }
    const [members, onlinerConfig] = await Promise.all([
      pool.query(
        `SELECT discord_user_id, username, display_name, avatar_url, stock_type, encrypted_account_token
         FROM community_oauth_joins
         WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])`,
        [communityConfig.guildId, requestedAccountIds]
      ),
      getDiscordOnlinerConfig()
    ]);
    const rowsById = new Map(members.rows.map((member) => [String(member.discord_user_id), member]));
    const onlinerByUserId = new Map(
      onlinerConfig.accounts
        .filter((account) => isDiscordGuildId(account.discordUserId))
        .map((account) => [String(account.discordUserId), account])
    );
    const accounts = [];
    const unavailable = [];
    for (const accountId of requestedAccountIds) {
      const member = rowsById.get(accountId);
      if (!member?.encrypted_account_token) {
        unavailable.push(`${member?.username ?? accountId}: user token missing`);
        continue;
      }
      let token;
      try {
        token = decryptCredential(member.encrypted_account_token);
      } catch {
        unavailable.push(`${member.username}: user token could not be decrypted`);
        continue;
      }
      const onliner = onlinerByUserId.get(accountId)
        ?? onlinerConfig.accounts.find((account) => account.botToken === token);
      const proxyUrl = normalizeDiscordOnlinerProxyUrl(onliner?.proxyUrl);
      if (!proxyUrl) {
        unavailable.push(`${member.username}: assigned Onliner proxy missing`);
        continue;
      }
      accounts.push({
        id: accountId,
        username: member.username,
        displayName: member.display_name,
        avatarUrl: member.avatar_url,
        categoryId: member.stock_type,
        guildId: communityConfig.guildId,
        onlinerAccountId: onliner?.id ?? null,
        token,
        proxyUrl
      });
    }
    if (!accounts.length) {
      return res.status(409).json({ message: unavailable[0] ?? "None of the selected accounts can use Humanizer." });
    }

    const job = {
      id: crypto.randomUUID(),
      status: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      total: accounts.length,
      completed: 0,
      succeeded: 0,
      failed: 0,
      results: accounts.map((account) => ({
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        avatarUrl: account.avatarUrl,
        categoryId: account.categoryId,
        state: "pending",
        changed: [],
        error: null,
        gatewayFallback: false,
        startedAt: null,
        completedAt: null
      })),
      unavailable
    };
    humanizerJobs.set(job.id, job);
    const staleJobs = [...humanizerJobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(20);
    for (const stale of staleJobs) humanizerJobs.delete(stale.id);
    void runHumanizerJob(job, accounts, { usernames, displayNames, bios, pronouns, avatarIds, hypesquad, concurrency }).catch((error) => {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      console.error("Humanizer job failed:", error instanceof Error ? error.message : error);
    });
    res.status(202).set("Cache-Control", "no-store").json(getHumanizerJobSnapshot(job));
  } catch (error) {
    next(error);
  }
});

app.get("/api/onliner", requireSession, async (_req, res, next) => {
  try {
    const config = await getDiscordOnlinerConfig();
    res.set("Cache-Control", "no-store").json(await getDiscordOnlinerSnapshotForApi(config));
  } catch (error) {
    next(error);
  }
});

app.get("/api/onliner/proxies", requireSession, async (_req, res, next) => {
  try {
    const config = await getDiscordOnlinerConfig();
    res.set("Cache-Control", "no-store").json(getDiscordOnlinerProxyPoolResponse(config));
  } catch (error) {
    next(error);
  }
});

app.put("/api/onliner/proxies", requireSession, async (req, res, next) => {
  try {
    const requested = Array.isArray(req.body?.proxies) ? req.body.proxies : [];
    if (requested.length > 10_000) return res.status(400).json({ message: "Onliner supports up to 10,000 saved proxies." });
    const proxies = [];
    for (let index = 0; index < requested.length; index += 1) {
      const proxy = normalizeDiscordOnlinerProxyUrl(requested[index]);
      if (!proxy) return res.status(400).json({ message: `Proxy line ${index + 1} is invalid.` });
      if (!proxies.includes(proxy)) proxies.push(proxy);
    }
    const current = await getDiscordOnlinerConfig();
    const assignedProxies = [];
    const assignmentConfig = { ...current, proxyPool: proxies, accounts: [] };
    const assignedAccounts = current.accounts.map((account) => {
      const proxyUrl = selectDiscordOnlinerProxy(assignmentConfig, assignedProxies);
      if (proxyUrl) assignedProxies.push(proxyUrl);
      return { ...account, proxyUrl };
    });
    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      proxyPool: proxies,
      accounts: assignedAccounts
    });
    for (const proxy of [...discordOnlinerProxyHealth.keys()]) {
      if (!candidate.proxyPool.includes(proxy)) discordOnlinerProxyHealth.delete(proxy);
    }
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) {
      await reconcileDiscordOnlinerWorkerConfig(discordOnlinerWorkerCurrentConfig ?? current, candidate);
      discordOnlinerWorkerCurrentConfig = candidate;
    }
    res.json(getDiscordOnlinerProxyPoolResponse(candidate));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/onliner/logs", requireSession, async (_req, res, next) => {
  try {
    discordOnlinerLogs.length = 0;
    await pool.query("TRUNCATE TABLE discord_onliner_persisted_logs RESTART IDENTITY");
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get("/api/onliner/logs", requireSession, async (req, res, next) => {
  try {
    const after = Math.max(0, Number.parseInt(String(req.query.after ?? "0"), 10) || 0);
    if (serviceRunsOnliner) {
      return res.set("Cache-Control", "no-store").json({ logs: discordOnlinerLogs.filter((entry) => entry.id > after).slice(-100) });
    }
    const result = await pool.query("SELECT id, timestamp, level, account_id, message FROM discord_onliner_persisted_logs WHERE id > $1 ORDER BY id ASC LIMIT 100", [after]);
    res.set("Cache-Control", "no-store").json({
      logs: result.rows.map((row) => ({ id: Number(row.id), timestamp: new Date(row.timestamp).toISOString(), level: row.level, accountId: row.account_id, message: row.message }))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/onliner/logs/stream", requireSession, async (req, res, next) => {
  let databaseLogCursor = 0;
  try {
    if (!serviceRunsOnliner) {
      const cursorResult = await pool.query("SELECT COALESCE(MAX(id), 0) AS id FROM discord_onliner_persisted_logs");
      databaseLogCursor = Number(cursorResult.rows[0]?.id) || 0;
    }
  } catch (error) {
    return next(error);
  }
  res.set({
    "Cache-Control": "no-cache, no-transform",
    "Content-Encoding": "identity",
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders();
  res.socket?.setNoDelay(true);
  res.write(": connected\n\n");
  res.flush?.();
  if (serviceRunsOnliner) discordOnlinerLogClients.add(res);
  const heartbeat = setInterval(async () => {
    try {
      if (!serviceRunsOnliner) {
        const result = await pool.query("SELECT id, timestamp, level, account_id, message FROM discord_onliner_persisted_logs WHERE id > $1 ORDER BY id ASC LIMIT 100", [databaseLogCursor]);
        for (const row of result.rows) {
          databaseLogCursor = Number(row.id);
          res.write(`data: ${JSON.stringify({ id: databaseLogCursor, timestamp: new Date(row.timestamp).toISOString(), level: row.level, accountId: row.account_id, message: row.message })}\n\n`);
        }
      }
      res.write(": heartbeat\n\n");
      res.flush?.();
    } catch {
      clearInterval(heartbeat);
      discordOnlinerLogClients.delete(res);
    }
  }, serviceRunsOnliner ? 15_000 : 1_000);
  heartbeat.unref?.();
  req.on("close", () => {
    clearInterval(heartbeat);
    discordOnlinerLogClients.delete(res);
  });
});

app.put("/api/onliner", requireSession, async (req, res, next) => {
  try {
    const current = await getDiscordOnlinerConfig();
    const candidate = await hydrateDiscordOnlinerSpotifyPlaylist(normalizeDiscordOnlinerConfig({
      ...current,
      ...req.body,
      accounts: current.accounts
    }));
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));
    const applyResult = serviceRunsOnliner
      ? applyDiscordOnlinerSettings(current, candidate)
      : {
          changed: current.enabled !== candidate.enabled
            || getDiscordOnlinerPresenceConfigFingerprint(current) !== getDiscordOnlinerPresenceConfigFingerprint(candidate)
            || getDiscordOnlinerRotationConfigFingerprint(current) !== getDiscordOnlinerRotationConfigFingerprint(candidate),
          presenceUpdated: false,
          connectionsRestarted: false
        };
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    res.json({ ...await getDiscordOnlinerSnapshotForApi(candidate), applyResult });
  } catch (error) {
    next(error);
  }
});

app.post("/api/onliner/accounts", requireSession, async (req, res, next) => {
  try {
    const current = await getDiscordOnlinerConfig();
    if (current.accounts.length >= discordOnlinerAccountLimit) return res.status(409).json({ message: `The Onliner supports up to ${discordOnlinerAccountLimit} bot profiles.` });
    const botToken = String(req.body?.botToken ?? "").trim();
    const richPresenceEnabled = req.body?.richPresenceEnabled !== false;
    if (!botToken || botToken.length > 2000) return res.status(400).json({ message: "A valid Discord bot token is required." });
    if (current.accounts.some((account) => account.botToken === botToken)) return res.status(409).json({ message: "This bot token is already saved." });
    const proxyUrl = selectDiscordOnlinerProxy(current);
    if (!proxyUrl) return res.status(409).json({ message: "Add at least one proxy to the Onliner proxy pool first." });
    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      accounts: [...current.accounts, { id: crypto.randomUUID(), botToken, proxyUrl, richPresenceEnabled }]
    });
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));
    if (serviceRunsOnliner) startDiscordOnlinerAccounts(candidate, [candidate.accounts.at(-1)]);
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    res.status(201).json(await getDiscordOnlinerSnapshotForApi(candidate));
  } catch (error) {
    next(error);
  }
});

app.get("/api/onliner/accounts/:accountId/credentials", requireSession, async (req, res, next) => {
  try {
    const config = await getDiscordOnlinerConfig();
    const accountId = String(req.params.accountId ?? "");
    const account = config.accounts.find((item) => item.id === accountId);
    if (!account) return res.status(404).json({ message: "Bot profile not found." });
    res.set("Cache-Control", "no-store").json({
      accountId: account.id,
      botToken: account.botToken,
      proxyUrl: account.proxyUrl,
      richPresenceEnabled: account.richPresenceEnabled !== false
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/onliner/accounts/:accountId", requireSession, async (req, res, next) => {
  try {
    const current = await getDiscordOnlinerConfig();
    const accountId = String(req.params.accountId ?? "");
    const accountIndex = current.accounts.findIndex((account) => account.id === accountId);
    if (accountIndex < 0) return res.status(404).json({ message: "Bot profile not found." });

    const botToken = String(req.body?.botToken ?? "").trim();
    const richPresenceEnabled = req.body?.richPresenceEnabled !== false;
    if (!botToken || botToken.length > 2000) return res.status(400).json({ message: "A valid Discord bot token is required." });
    if (current.accounts.some((account) => account.id !== accountId && account.botToken === botToken)) {
      return res.status(409).json({ message: "This bot token is already saved in another profile." });
    }
    const proxyUrl = current.accounts[accountIndex].proxyUrl || selectDiscordOnlinerProxy(current);
    if (!proxyUrl) return res.status(409).json({ message: "Add at least one proxy to the Onliner proxy pool first." });

    const updatedAccount = { ...current.accounts[accountIndex], id: accountId, botToken, proxyUrl, richPresenceEnabled };
    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      accounts: current.accounts.map((account) => account.id === accountId ? updatedAccount : account)
    });
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));

    const credentialsChanged = current.accounts[accountIndex].botToken !== botToken
      || current.accounts[accountIndex].proxyUrl !== proxyUrl;
    const richPresenceChanged = current.accounts[accountIndex].richPresenceEnabled !== richPresenceEnabled;
    if (serviceRunsOnliner && credentialsChanged) {
      const runtime = discordOnlinerRuntimes.get(accountId);
      if (runtime) stopDiscordOnlinerRuntime(runtime, { resetIdentity: true });
      const savedAccount = candidate.accounts.find((account) => account.id === accountId);
      if (savedAccount) startDiscordOnlinerAccounts(candidate, [savedAccount]);
      appendDiscordOnlinerLog("info", "Bot profile updated; restarting only this Gateway connection.", accountId);
    } else if (serviceRunsOnliner && richPresenceChanged) {
      const savedAccount = candidate.accounts.find((account) => account.id === accountId);
      if (savedAccount) {
        applyDiscordOnlinerAccountPresenceLive(
          candidate,
          savedAccount,
          `Rich Presence ${richPresenceEnabled ? "enabled" : "disabled"} on the active Gateway connection.`
        );
      }
    }
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    res.json(await getDiscordOnlinerSnapshotForApi(candidate));
  } catch (error) {
    next(error);
  }
});

app.post("/api/onliner/accounts/bulk", requireSession, async (req, res, next) => {
  try {
    const current = await getDiscordOnlinerConfig();
    const requestedAccounts = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
    if (!requestedAccounts.length) return res.status(400).json({ message: "Add at least one bot profile." });
    if (requestedAccounts.length > discordOnlinerAccountLimit || current.accounts.length + requestedAccounts.length > discordOnlinerAccountLimit) {
      return res.status(409).json({ message: `You can add at most ${Math.max(0, discordOnlinerAccountLimit - current.accounts.length)} more bot profiles.` });
    }

    const knownTokens = new Set(current.accounts.map((account) => account.botToken));
    const additions = [];
    for (let index = 0; index < requestedAccounts.length; index += 1) {
      const input = requestedAccounts[index];
      const lineNumber = Number.parseInt(input?.lineNumber, 10) || index + 1;
      const botToken = normalizeDiscordOnlinerBulkBotToken(input?.botToken);
      const richPresenceEnabled = input?.richPresenceEnabled !== false;
      if (!botToken || botToken.length > 2000) return res.status(400).json({ message: `Line ${lineNumber}: enter a valid Discord bot token.` });
      if (knownTokens.has(botToken)) return res.status(409).json({ message: `Line ${lineNumber}: this bot token is duplicated or already saved.` });
      const proxyUrl = selectDiscordOnlinerProxy(current, additions.map((account) => account.proxyUrl));
      if (!proxyUrl) return res.status(409).json({ message: "Add at least one proxy to the Onliner proxy pool first." });
      knownTokens.add(botToken);
      additions.push({ id: crypto.randomUUID(), botToken, proxyUrl, richPresenceEnabled });
    }

    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      accounts: [...current.accounts, ...additions]
    });
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));
    if (serviceRunsOnliner) {
      appendDiscordOnlinerLog("info", `${additions.length} bot profiles added in bulk.`);
      startDiscordOnlinerAccounts(candidate, additions, { stagger: true });
    }
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    res.status(201).json(await getDiscordOnlinerSnapshotForApi(candidate));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/onliner/accounts/:accountId", requireSession, async (req, res, next) => {
  try {
    const current = await getDiscordOnlinerConfig();
    const accountId = String(req.params.accountId ?? "");
    if (!current.accounts.some((account) => account.id === accountId)) return res.status(404).json({ message: "Bot profile not found." });
    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      accounts: current.accounts.filter((account) => account.id !== accountId)
    });
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));
    if (serviceRunsOnliner) {
      const runtime = discordOnlinerRuntimes.get(accountId);
      if (runtime) {
        stopDiscordOnlinerRuntime(runtime, { resetIdentity: true });
        discordOnlinerRuntimes.delete(accountId);
      }
      appendDiscordOnlinerLog("info", "Bot profile removed.", accountId);
    }
    await pool.query("DELETE FROM discord_onliner_runtime WHERE account_id = $1", [accountId]);
    discordOnlinerPendingRuntimeWrites.delete(accountId);
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    res.json(await getDiscordOnlinerSnapshotForApi(candidate));
  } catch (error) {
    next(error);
  }
});

app.post("/api/onliner/accounts/:accountId/rotate-proxy", requireSession, async (req, res, next) => {
  try {
    const current = await getDiscordOnlinerConfig();
    const accountId = String(req.params.accountId ?? "");
    const account = current.accounts.find((item) => item.id === accountId);
    if (!account) return res.status(404).json({ message: "Onliner profile not found." });
    if (account.proxyUrl) recordDiscordOnlinerProxyHealth(account.proxyUrl, false);
    const proxyUrl = selectDiscordOnlinerProxy(current, [], account.proxyUrl ? [account.proxyUrl] : []);
    if (!proxyUrl) return res.status(409).json({ message: "No other available proxy exists in the Onliner pool." });
    const updatedAccount = { ...account, proxyUrl };
    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      accounts: current.accounts.map((item) => item.id === accountId ? updatedAccount : item)
    });
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));
    if (serviceRunsOnliner) {
      const runtime = discordOnlinerRuntimes.get(accountId);
      if (runtime) stopDiscordOnlinerRuntime(runtime, { resetIdentity: true });
      const savedAccount = candidate.accounts.find((item) => item.id === accountId);
      if (savedAccount) startDiscordOnlinerAccounts(candidate, [savedAccount]);
    }
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    appendDiscordOnlinerLog("info", "Proxy changed from the central pool; restarting this Gateway connection.", accountId);
    res.json(await getDiscordOnlinerSnapshotForApi(candidate));
  } catch (error) {
    next(error);
  }
});

app.post("/api/onliner/accounts/:accountId/reconnect", requireSession, async (req, res, next) => {
  try {
    const config = await getDiscordOnlinerConfig();
    const accountId = String(req.params.accountId ?? "");
    const account = config.accounts.find((item) => item.id === accountId);
    if (!account) return res.status(404).json({ message: "Bot profile not found." });
    if (!config.enabled) return res.status(409).json({ message: "Enable the Onliner before reconnecting a bot." });
    const workerState = await pool.query("SELECT connection_paused FROM discord_onliner_worker_state WHERE singleton = TRUE LIMIT 1");
    if (workerState.rows[0]?.connection_paused === true) return res.status(409).json({ message: "Gateway connections are paused. Continue them before reconnecting a bot." });
    if (serviceRunsOnliner) {
      reconnectDiscordOnlinerAccount(config, account);
    } else {
      await pool.query(
        "INSERT INTO discord_onliner_commands (command_type, payload) VALUES ('reconnect_account', $1::jsonb)",
        [JSON.stringify({ accountId })]
      );
    }
    res.json(await getDiscordOnlinerSnapshotForApi(config));
  } catch (error) {
    next(error);
  }
});

app.post(["/api/onliner/reconnect", "/api/onliner/start"], requireSession, async (_req, res, next) => {
  try {
    const config = await getDiscordOnlinerConfig();
    if (!config.accounts.length) return res.status(409).json({ message: "Save at least one Discord bot token first." });
    if (!config.enabled) return res.status(409).json({ message: "Enable the Onliner before reconnecting." });
    await pool.query("UPDATE discord_onliner_worker_state SET connection_paused = FALSE WHERE singleton = TRUE");
    if (serviceRunsOnliner) {
      discordOnlinerConnectionsPaused = false;
      startDiscordOnliner(config);
    } else {
      await pool.query("INSERT INTO discord_onliner_commands (command_type) VALUES ('start_all')");
    }
    res.json(await getDiscordOnlinerSnapshotForApi(config));
  } catch (error) {
    next(error);
  }
});

app.post("/api/onliner/stop", requireSession, async (_req, res, next) => {
  try {
    const config = await getDiscordOnlinerConfig();
    if (!config.accounts.length) return res.status(409).json({ message: "Save at least one Discord bot token first." });
    await pool.query("UPDATE discord_onliner_worker_state SET connection_paused = TRUE WHERE singleton = TRUE");
    if (serviceRunsOnliner) pauseDiscordOnlinerConnections();
    else await pool.query("INSERT INTO discord_onliner_commands (command_type) VALUES ('pause_connections')");
    res.json(await getDiscordOnlinerSnapshotForApi(config));
  } catch (error) {
    next(error);
  }
});

app.post("/api/onliner/continue", requireSession, async (_req, res, next) => {
  try {
    const config = await getDiscordOnlinerConfig();
    if (!config.accounts.length) return res.status(409).json({ message: "Save at least one Discord bot token first." });
    if (!config.enabled) return res.status(409).json({ message: "Enable the Onliner before continuing connections." });
    await pool.query("UPDATE discord_onliner_worker_state SET connection_paused = FALSE WHERE singleton = TRUE");
    if (serviceRunsOnliner) continueDiscordOnlinerConnections(config);
    else await pool.query("INSERT INTO discord_onliner_commands (command_type) VALUES ('continue_connections')");
    res.json(await getDiscordOnlinerSnapshotForApi(config));
  } catch (error) {
    next(error);
  }
});

app.post("/api/onliner/disconnect", requireSession, async (_req, res, next) => {
  try {
    const config = await getDiscordOnlinerConfig();
    if (!config.accounts.length) return res.status(409).json({ message: "Save at least one Discord bot token first." });
    await pool.query("UPDATE discord_onliner_worker_state SET connection_paused = TRUE WHERE singleton = TRUE");
    if (serviceRunsOnliner) {
      discordOnlinerConnectionsPaused = true;
      stopDiscordOnliner();
      appendDiscordOnlinerLog("info", "All Gateway connections stopped from the panel.");
    } else {
      await pool.query("INSERT INTO discord_onliner_commands (command_type) VALUES ('stop_all')");
    }
    res.json(await getDiscordOnlinerSnapshotForApi(config));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/onliner", requireSession, async (_req, res, next) => {
  try {
    if (serviceRunsOnliner) {
      stopDiscordOnliner({ resetIdentity: true });
      discordOnlinerRuntimes.clear();
    }
    await pool.query("DELETE FROM app_settings WHERE setting_key = $1", [discordOnlinerSettingKey]);
    await pool.query("DELETE FROM discord_onliner_runtime");
    discordOnlinerPendingRuntimeWrites.clear();
    if (serviceRunsOnliner) appendDiscordOnlinerLog("info", "Onliner settings were removed.");
    const config = normalizeDiscordOnlinerConfig({ enabled: false, activityText: "Pulcip Members" });
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = config;
    res.json(await getDiscordOnlinerSnapshotForApi(config));
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/config", requireSession, async (_req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    const [storedResult, bot, guildCount] = await Promise.all([
      pool.query("SELECT 1 FROM app_settings WHERE setting_key = 'community_oauth_config' LIMIT 1"),
      config.configured ? loadCommunityBotSafe(config) : Promise.resolve(null),
      config.configured ? loadCommunityBotGuildCountSafe(config) : Promise.resolve({ count: null, exact: false })
    ]);
    res.set("Cache-Control", "no-store").json({
      configured: config.configured,
      stored: Boolean(storedResult.rowCount),
      clientId: config.clientId,
      guildId: config.guildId,
      hasClientSecret: Boolean(config.clientSecret),
      hasBotToken: Boolean(config.botToken),
      activeGuildCount: guildCount.count,
      activeGuildCountExact: guildCount.exact,
      botVerified: bot?.verified === true,
      serverLimit: bot?.verified === true ? null : 100
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    communityGuildCache = null;
    communityBotCache = null;
    communityBotGuildCountCache = null;
    stopCommunityPresenceGateway();
    const [bot, guildCount] = await Promise.all([
      loadCommunityBotSafe(candidate),
      loadCommunityBotGuildCountSafe(candidate)
    ]);
    res.json({
      configured: true,
      stored: true,
      clientId: candidate.clientId,
      guildId: candidate.guildId,
      hasClientSecret: true,
      hasBotToken: true,
      guildName: String(guildResult.payload?.name ?? "Discord server"),
      activeGuildCount: guildCount.count,
      activeGuildCountExact: guildCount.exact,
      botVerified: bot?.verified === true,
      serverLimit: bot?.verified === true ? null : 100
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
    communityBotGuildCountCache = null;
    stopCommunityPresenceGateway();
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/bot/leave-all-guilds", requireSession, async (req, res, next) => {
  try {
    if (String(req.body?.confirmation ?? "") !== "LEAVE ALL") {
      return res.status(400).json({ message: "Type LEAVE ALL to confirm removing the bot from every server." });
    }
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "Configure the Members bot before managing its servers." });
    }

    communityBotGuildCountCache = null;
    const { guilds, exact } = await loadCommunityBotGuilds(config);
    if (!exact) {
      return res.status(409).json({ message: "The complete server list could not be loaded safely. No servers were changed." });
    }

    const result = await leaveCommunityBotGuilds(config, guilds);
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) {
    communityBotGuildCountCache = null;
    next(error);
  }
});

app.get("/api/community/bot/guilds", requireSession, async (_req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before managing its servers." });
    communityBotGuildCountCache = null;
    const [{ guilds, exact }, activeOrderResult] = await Promise.all([
      loadCommunityBotGuilds(config),
      pool.query(
        `SELECT payload->>'serverId' AS guild_id,
                UPPER(COALESCE(payload->>'status', 'PROCESS')) AS order_status,
                COUNT(*)::int AS active_orders
         FROM tracked_orders
         WHERE payload->>'provider' = 'community'
           AND UPPER(COALESCE(payload->>'status', '')) = 'PROCESS'
         GROUP BY payload->>'serverId', UPPER(COALESCE(payload->>'status', 'PROCESS'))`
      )
    ]);
    const activeOrdersByGuild = new Map();
    for (const row of activeOrderResult.rows) {
      const guildId = String(row.guild_id ?? "");
      const status = String(row.order_status ?? "PROCESS");
      const count = Number(row.active_orders ?? 0);
      const current = activeOrdersByGuild.get(guildId) ?? { count: 0, statuses: [] };
      current.count += count;
      current.statuses.push({ status, count });
      activeOrdersByGuild.set(guildId, current);
    }
    res.set("Cache-Control", "no-store").json({
      exact,
      guilds: guilds.map((guild) => {
        const id = String(guild?.id ?? "");
        const icon = String(guild?.icon ?? "");
        return {
          id,
          name: String(guild?.name ?? "Discord server").slice(0, 100),
          iconUrl: icon ? `https://cdn.discordapp.com/icons/${encodeURIComponent(id)}/${encodeURIComponent(icon)}.png?size=64` : null,
          configured: id === config.guildId,
          activeOrderCount: activeOrdersByGuild.get(id)?.count ?? 0,
          activeOrderStatuses: activeOrdersByGuild.get(id)?.statuses ?? []
        };
      }).sort((left, right) => left.name.localeCompare(right.name))
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/bot/leave-progress", requireSession, (_req, res) => {
  res.set("Cache-Control", "no-store").json(communityGuildLeaveProgress);
});

app.post("/api/community/bot/leave-guilds", requireSession, async (req, res, next) => {
  try {
    if (String(req.body?.confirmation ?? "") !== "LEAVE SELECTED") {
      return res.status(400).json({ message: "Confirm the selected server removal before continuing." });
    }
    const requestedIds = Array.from(new Set(
      (Array.isArray(req.body?.guildIds) ? req.body.guildIds : []).map((value) => String(value ?? "").trim()).filter(isDiscordGuildId)
    ));
    if (!requestedIds.length || requestedIds.length > 200) {
      return res.status(400).json({ message: "Select between 1 and 200 servers." });
    }
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before managing its servers." });
    communityBotGuildCountCache = null;
    const { guilds, exact } = await loadCommunityBotGuilds(config);
    if (!exact) return res.status(409).json({ message: "The complete server list could not be loaded safely. No servers were changed." });
    const requestedSet = new Set(requestedIds);
    const selectedGuilds = guilds.filter((guild) => requestedSet.has(String(guild?.id ?? "")));
    if (selectedGuilds.length !== requestedIds.length) {
      return res.status(409).json({ message: "One or more selected servers are no longer connected. Refresh the list and try again." });
    }
    const result = await leaveCommunityBotGuilds(config, selectedGuilds);
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) {
    communityBotGuildCountCache = null;
    next(error);
  }
});

app.post("/api/community/categories", requireSession, async (req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before creating a category." });
    const name = String(req.body?.name ?? "").trim();
    const isPeriodic = req.body?.isPeriodic === true;
    const checkReplacementEnabled = req.body?.checkReplacementEnabled !== false;
    const reactionUseEnabled = req.body?.reactionUseEnabled === true;
    const iconName = parseCommunityCategoryIconName(req.body?.iconName);
    const colorKey = parseCommunityCategoryColorKey(req.body?.colorKey);
    if (!name || name.length > 60) {
      return res.status(400).json({ message: "Enter a category name with up to 60 characters." });
    }
    if (!iconName) return res.status(400).json({ message: "Choose a valid category icon." });
    if (!colorKey) return res.status(400).json({ message: "Choose a valid category color." });
    const id = createCommunityCategoryId();
    const inserted = await pool.query(
      `INSERT INTO community_stock_categories (guild_id, id, name, is_periodic, check_replacement_enabled, reaction_use_enabled, icon_name, color_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, is_periodic, check_replacement_enabled, reaction_use_enabled, icon_name, color_key, created_at, updated_at`,
      [config.guildId, id, name, isPeriodic, checkReplacementEnabled, reactionUseEnabled, iconName, colorKey]
    );
    invalidateCommunityCategoryDisplayCache();
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
    const checkReplacementEnabled = req.body?.checkReplacementEnabled !== false;
    const reactionUseEnabled = req.body?.reactionUseEnabled === true;
    const iconName = parseCommunityCategoryIconName(req.body?.iconName);
    const colorKey = parseCommunityCategoryColorKey(req.body?.colorKey);
    if (!name || name.length > 60) {
      return res.status(400).json({ message: "Enter a category name with up to 60 characters." });
    }
    if (!iconName) return res.status(400).json({ message: "Choose a valid category icon." });
    if (!colorKey) return res.status(400).json({ message: "Choose a valid category color." });
    const updated = await pool.query(
      `WITH updated AS (
         UPDATE community_stock_categories
         SET name = $3, is_periodic = $4, check_replacement_enabled = $5, reaction_use_enabled = $6, icon_name = $7, color_key = $8, updated_at = NOW()
         WHERE id = $2
           AND NOT EXISTS (
             SELECT 1
             FROM community_stock_category_tombstones AS tombstone
             WHERE tombstone.id = community_stock_categories.id
           )
         RETURNING guild_id, id, name, is_periodic, check_replacement_enabled, reaction_use_enabled, icon_name, color_key, created_at, updated_at
       )
       SELECT id, name, is_periodic, check_replacement_enabled, reaction_use_enabled, icon_name, color_key, created_at, updated_at
       FROM updated
       WHERE guild_id = $1`,
      [config.guildId, categoryId, name, isPeriodic, checkReplacementEnabled, reactionUseEnabled, iconName, colorKey]
    );
    if (!updated.rowCount) return res.status(404).json({ message: "Category not found." });
    invalidateCommunityCategoryDisplayCache();
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
    const category = await client.query(
      "SELECT id FROM community_stock_categories WHERE guild_id = $1 AND id = $2 FOR UPDATE",
      [config.guildId, categoryId]
    );
    if (!category.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Category not found." });
    }
    const stock = await client.query(
      "SELECT COUNT(*)::int AS count FROM community_oauth_joins WHERE guild_id = $1 AND stock_type = $2",
      [config.guildId, categoryId]
    );
    if (Number(stock.rows[0]?.count ?? 0) > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Remove or move this category's stock before deleting it." });
    }
    await client.query(
      `INSERT INTO community_stock_category_tombstones (id, deleted_at)
       VALUES ($1, NOW())
       ON CONFLICT (id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
      [categoryId]
    );
    await client.query("DELETE FROM community_stock_categories WHERE id = $1", [categoryId]);
    await client.query("COMMIT");
    invalidateCommunityCategoryDisplayCache();
    res.status(204).end();
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.post("/api/community/categories/:categoryId/accounts", requireSession, async (req, res, next) => {
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before adding an account." });

    const requestedCategoryId = String(req.params.categoryId ?? "").trim().toLowerCase();
    const categoryId = parseCommunityCategoryId(requestedCategoryId);
    const accountToken = String(req.body?.accountToken ?? "").trim();
    const connectToOnliner = req.body?.connectToOnliner === true;
    const onlinerRichPresenceEnabled = req.body?.richPresenceEnabled !== false;
    if (!categoryId || categoryId !== requestedCategoryId) return res.status(400).json({ message: "Choose a valid Members Stock category." });
    if (accountToken.length < 20 || accountToken.length > 4096) return res.status(400).json({ message: "Enter a valid Discord account token." });

    let onlinerCurrent = null;
    let onlinerCandidate = null;
    let onlinerAccount = null;
    let normalizedOnlinerProxyUrl = "";
    let onlinerAlreadyConnected = false;
    if (connectToOnliner) {
      onlinerCurrent = await getDiscordOnlinerConfig();
      onlinerAlreadyConnected = onlinerCurrent.accounts.some((account) => account.botToken === accountToken);
      if (!onlinerAlreadyConnected) {
        if (onlinerCurrent.accounts.length >= discordOnlinerAccountLimit) {
          return res.status(409).json({ message: `The Onliner supports up to ${discordOnlinerAccountLimit} account profiles.` });
        }
        normalizedOnlinerProxyUrl = selectDiscordOnlinerProxy(onlinerCurrent);
        if (!normalizedOnlinerProxyUrl) return res.status(409).json({ message: "Add at least one proxy to the Onliner proxy pool first." });
      }
    }

    const category = await pool.query(
      "SELECT id, name FROM community_stock_categories WHERE guild_id = $1 AND id = $2 LIMIT 1",
      [config.guildId, categoryId]
    );
    if (!category.rowCount) return res.status(404).json({ message: "Members Stock category not found." });

    const accountIdentity = await requestDiscord("users/@me", { headers: { Authorization: accountToken } });
    if (!accountIdentity.response.ok || !isDiscordGuildId(String(accountIdentity.payload?.id ?? ""))) {
      return res.status(accountIdentity.response.status === 429 ? 429 : 401).json({
        message: accountIdentity.response.status === 429
          ? "Discord is rate limiting account checks. Try again shortly."
          : "Discord rejected this account token. Check that it is current and valid."
      });
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/api/community/oauth/callback`;
    const authorizeQuery = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "identify guilds.join"
    });
    const authorizeResponse = await fetch(`${discordApiBase}/oauth2/authorize?${authorizeQuery.toString()}`, {
      method: "POST",
      headers: { Authorization: accountToken, "Content-Type": "application/json" },
      body: JSON.stringify({ authorize: true, permissions: "0" }),
      signal: AbortSignal.timeout(15_000)
    });
    const authorizePayload = await authorizeResponse.json().catch(() => ({}));
    if (!authorizeResponse.ok) {
      const discordMessage = String(authorizePayload?.message ?? authorizePayload?.error_description ?? "Discord rejected the application authorization.").trim();
      const error = new Error(authorizeResponse.status === 401
        ? "Discord rejected this account token."
        : authorizeResponse.status === 429
          ? "Discord is rate limiting OAuth authorizations. Try again shortly."
          : `Discord OAuth authorization failed (HTTP ${authorizeResponse.status}): ${discordMessage}`);
      error.statusCode = authorizeResponse.status === 429 ? 429 : authorizeResponse.status >= 500 ? 502 : 409;
      throw error;
    }

    const authorizationLocation = String(authorizePayload?.location ?? "").trim();
    let authorizationCode = "";
    try {
      authorizationCode = new URL(authorizationLocation, redirectUri).searchParams.get("code") ?? "";
    } catch {
      authorizationCode = "";
    }
    if (!authorizationCode) {
      const error = new Error("Discord did not return an OAuth authorization code. The account may require additional verification or consent.");
      error.statusCode = 409;
      throw error;
    }

    const oauth = await exchangeCommunityOAuthAuthorizationCode(config, authorizationCode, redirectUri);
    const oauthIdentity = await requestDiscord("oauth2/@me", { headers: { Authorization: `Bearer ${oauth.accessToken}` } });
    const discordUserId = String(accountIdentity.payload.id);
    const verifiedUserId = String(oauthIdentity.payload?.user?.id ?? "");
    const scopes = Array.isArray(oauthIdentity.payload?.scopes) ? oauthIdentity.payload.scopes.map(String) : [];
    if (!oauthIdentity.response.ok || verifiedUserId !== discordUserId || !scopes.includes("guilds.join")) {
      const error = new Error("The new OAuth authorization could not be verified with the required guilds.join permission.");
      error.statusCode = 502;
      throw error;
    }
    if (connectToOnliner && onlinerCurrent) {
      const existingOnlinerAccount = onlinerCurrent.accounts.find((account) => account.botToken === accountToken);
      if (existingOnlinerAccount) {
        onlinerAccount = { ...existingOnlinerAccount, discordUserId, richPresenceEnabled: onlinerRichPresenceEnabled };
        if (existingOnlinerAccount.discordUserId !== discordUserId || existingOnlinerAccount.richPresenceEnabled !== onlinerRichPresenceEnabled) {
          onlinerCandidate = normalizeDiscordOnlinerConfig({
            ...onlinerCurrent,
            accounts: onlinerCurrent.accounts.map((account) => account.id === existingOnlinerAccount.id ? onlinerAccount : account)
          });
        }
      } else {
        onlinerAccount = { id: crypto.randomUUID(), botToken: accountToken, proxyUrl: normalizedOnlinerProxyUrl, richPresenceEnabled: onlinerRichPresenceEnabled, discordUserId };
        onlinerCandidate = normalizeDiscordOnlinerConfig({
          ...onlinerCurrent,
          accounts: [...onlinerCurrent.accounts, onlinerAccount]
        });
      }
    }

    const username = String(accountIdentity.payload?.username ?? `Discord user ${discordUserId}`).trim().slice(0, 100);
    const displayName = String(accountIdentity.payload?.global_name ?? "").trim().slice(0, 100) || null;
    const avatarHash = String(accountIdentity.payload?.avatar ?? "").trim();
    const avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordUserId)}/${encodeURIComponent(avatarHash)}.png?size=128`
      : null;
    const positionResult = await pool.query(
      "SELECT COALESCE(MAX(sort_position), 0)::bigint AS maximum FROM community_oauth_joins WHERE guild_id = $1 AND stock_type = $2",
      [config.guildId, categoryId]
    );
    const sortPosition = Number(positionResult.rows[0]?.maximum ?? 0) + 1024;
    const details = `OAuth authorization is managed automatically and is valid until ${oauth.expiresAt.toISOString()}.`;
    const saved = await pool.query(
      `INSERT INTO community_oauth_joins
         (discord_user_id, guild_id, username, display_name, avatar_url, encrypted_account_token, encrypted_refresh_token, encrypted_access_token, access_token_expires_at, status, stock_type, details, authorized_at, joined_at, reserved_order_id, sort_position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'authorized', $10, $11, NOW(), NULL, NULL, $12)
       ON CONFLICT (discord_user_id, guild_id) DO UPDATE SET
         username = EXCLUDED.username,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         encrypted_account_token = EXCLUDED.encrypted_account_token,
         encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         encrypted_access_token = EXCLUDED.encrypted_access_token,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         status = 'authorized',
         stock_type = EXCLUDED.stock_type,
         details = EXCLUDED.details,
         authorized_at = NOW(),
         joined_at = NULL,
         reserved_order_id = NULL,
         sort_position = CASE WHEN community_oauth_joins.stock_type <> EXCLUDED.stock_type THEN EXCLUDED.sort_position ELSE community_oauth_joins.sort_position END
       RETURNING discord_user_id, username, display_name, avatar_url, status, stock_type, details, authorized_at, joined_at, reserved_order_id, sort_position`,
      [discordUserId, config.guildId, username, displayName, avatarUrl, encryptCredential(accountToken), encryptCredential(oauth.refreshToken), encryptCredential(oauth.accessToken), oauth.expiresAt, categoryId, details, sortPosition]
    );
    const row = saved.rows[0];
    if (onlinerCandidate && onlinerAccount) {
      await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(onlinerCandidate));
      if (serviceRunsOnliner) startDiscordOnlinerAccounts(onlinerCandidate, [onlinerAccount]);
      if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = onlinerCandidate;
      appendDiscordOnlinerLog("success", `Members Stock account ${username} was added to Onliner.`, onlinerAccount.id);
    }
    res.status(201).set("Cache-Control", "no-store").json({
      categoryId,
      categoryName: category.rows[0].name,
      onlinerConnected: connectToOnliner,
      onlinerAlreadyConnected,
      member: {
        id: row.discord_user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        status: row.status,
        stockType: row.stock_type,
        details: row.details,
        reservedOrderId: row.reserved_order_id,
        sortPosition: Number(row.sort_position),
        authorizedAt: row.authorized_at,
        joinedAt: row.joined_at,
        onlinerConnected: connectToOnliner,
        onlinerAccountId: onlinerAccount?.id ?? null,
        hasStoredAccountToken: true
      }
    });
  } catch (error) {
    next(error);
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

    const result = { total: records.length, imported: 0, failed: 0, skipped: 0, errors: [], errorCounts: {} };
    const recordFailure = (record, message) => {
      result.failed += 1;
      result.errorCounts[message] = (result.errorCounts[message] ?? 0) + 1;
      if (result.errors.length < 25) result.errors.push({ record, message });
    };
    const seenSourceUserIds = new Set();
    const seenDiscordUserIds = new Set();
    const positionResult = await pool.query(
      "SELECT COALESCE(MAX(sort_position), 0)::bigint AS maximum FROM community_oauth_joins WHERE guild_id = $1 AND stock_type = $2",
      [config.guildId, stockType]
    );
    let nextSortPosition = Number(positionResult.rows[0]?.maximum ?? 0) + 1024;

    await forEachWithConcurrency(records, 4, async (record, index) => {
      const sourceUserId = String(record?.user_id ?? record?.userId ?? "").trim();
      let accessToken = String(record?.access_token ?? record?.accessToken ?? "").trim();
      let refreshToken = String(record?.refresh_token ?? record?.refreshToken ?? "").trim();
      let accessTokenExpiresAt = parseCommunityAccessTokenExpiry(record);
      const recordLabel = isDiscordGuildId(sourceUserId) ? sourceUserId : `row ${index + 1}`;

      if (!isDiscordGuildId(sourceUserId) || accessToken.length < 20 || accessToken.length > 4096 || refreshToken.length > 4096 || !accessTokenExpiresAt) {
        recordFailure(recordLabel, "A valid user_id, access_token, authed_timestamp and expires_in are required.");
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
        const refreshImportedCredential = async () => {
          if (refreshToken.length < 20) throw new Error("The OAuth access token is expired or invalid and this record has no usable refresh_token.");
          const refreshed = await exchangeCommunityOAuthRefreshToken(config, refreshToken);
          accessToken = refreshed.accessToken;
          refreshToken = refreshed.refreshToken;
          accessTokenExpiresAt = refreshed.expiresAt;
        };
        if (accessTokenExpiresAt.getTime() <= Date.now()) await refreshImportedCredential();
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
        if ([401, 403].includes(oauthIdentity.response.status) && refreshToken.length >= 20) {
          await refreshImportedCredential();
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
        const details = refreshToken.length >= 20
          ? `OAuth authorization is managed automatically and is valid until ${accessTokenExpiresAt.toISOString()}.`
          : `Imported without a refresh token; access is valid until ${accessTokenExpiresAt.toISOString()}.`;
        const discordUserId = sourceUserId;
        const duplicateDiscordUser = seenDiscordUserIds.has(discordUserId);
        seenDiscordUserIds.add(discordUserId);

        const username = String(oauthUser?.username ?? `Discord user ${discordUserId}`).trim().slice(0, 100);
        const displayName = String(oauthUser?.global_name ?? "").trim().slice(0, 100) || null;
        const avatarHash = String(oauthUser?.avatar ?? "").trim();
        const avatarUrl = avatarHash
          ? `https://cdn.discordapp.com/avatars/${encodeURIComponent(discordUserId)}/${encodeURIComponent(avatarHash)}.png?size=128`
          : null;
        const encryptedAccessToken = encryptCredential(accessToken);
        const encryptedRefreshToken = refreshToken.length >= 20 ? encryptCredential(refreshToken) : null;
        await pool.query(
          `INSERT INTO community_oauth_joins
             (discord_user_id, guild_id, username, display_name, avatar_url, encrypted_refresh_token, encrypted_access_token, access_token_expires_at, status, stock_type, details, authorized_at, joined_at, reserved_order_id, sort_position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'authorized', $9, $10, NOW(), NULL, NULL, $11)
           ON CONFLICT (discord_user_id, guild_id) DO UPDATE SET
             username = EXCLUDED.username,
             display_name = EXCLUDED.display_name,
             avatar_url = EXCLUDED.avatar_url,
             encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, community_oauth_joins.encrypted_refresh_token),
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
          [discordUserId, config.guildId, username, displayName, avatarUrl, encryptedRefreshToken, encryptedAccessToken, accessTokenExpiresAt, stockType, details, sortPosition]
        );
        await pool.query(
          `UPDATE community_oauth_joins
           SET username = $2,
               display_name = $3,
               encrypted_access_token = $4,
               encrypted_refresh_token = COALESCE($5, encrypted_refresh_token),
               access_token_expires_at = $6,
               authorized_at = NOW(),
               status = CASE
                 WHEN status = 'failed' AND details ILIKE 'OAuth access token%' THEN 'authorized'
                 ELSE status
               END,
               details = CASE
                 WHEN status = 'failed' AND details ILIKE 'OAuth access token%' THEN $7
                 ELSE details
               END
           WHERE discord_user_id = $1 AND guild_id <> $8`,
          [discordUserId, username, displayName, encryptedAccessToken, encryptedRefreshToken, accessTokenExpiresAt, details, config.guildId]
        );
        if (duplicateDiscordUser) result.skipped += 1;
        else result.imported += 1;
      } catch (error) {
        recordFailure(recordLabel, error instanceof Error ? error.message : "OAuth record could not be imported.");
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
      `SELECT discord_user_id, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, authorized_at
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
        ...(row.encrypted_refresh_token ? { refresh_token: decryptCredential(row.encrypted_refresh_token) } : {}),
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
        syncProgress: null,
        categories: {},
        stockCategories: [],
        recent: []
      });
    }

    await normalizeCommunityStockRecords(config);
    const requestedCategoryId = parseCommunityCategoryId(_req.query?.categoryId);
    const stockCategories = await loadCommunityStockCategories(config);
    const activeCategoryId = stockCategories.some((category) => category.id === requestedCategoryId)
      ? requestedCategoryId
      : stockCategories[0]?.id ?? null;
    const [bot, guild, summary, recentResult] = await Promise.all([
      loadCommunityBotSafe(config),
      loadCommunityGuildSafe(config),
      loadCommunityJoinSummary(config),
      pool.query(
        `SELECT discord_user_id, username, display_name, avatar_url, status, stock_type, details, authorized_at, joined_at, reserved_order_id, sort_position,
                encrypted_account_token IS NOT NULL AS has_stored_account_token
         FROM community_oauth_joins
         WHERE guild_id = $1
           AND ($2::text IS NULL OR stock_type = $2)
         ORDER BY stock_type ASC,
                  CASE WHEN status = 'failed' THEN 1 ELSE 0 END ASC,
                  sort_position ASC,
                  authorized_at ASC`,
        [config.guildId, activeCategoryId]
      )
    ]);
    const onlinerConfig = await getDiscordOnlinerConfig();
    const onlinerAccountByUserId = new Map(
      onlinerConfig.accounts
        .filter((account) => isDiscordGuildId(account.discordUserId))
        .map((account) => [account.discordUserId, account.id])
    );
    const onlinerRuntimeByAccountId = new Map();
    if (onlinerConfig.accounts.length) {
      const [runtimeLinks, workerResult] = await Promise.all([
        pool.query(
          `SELECT account_id, payload, payload->'bot'->>'id' AS discord_user_id
           FROM discord_onliner_runtime
           WHERE account_id = ANY($1::text[])`,
          [onlinerConfig.accounts.map((account) => account.id)]
        ),
        serviceRunsOnliner
          ? Promise.resolve({ rows: [] })
          : pool.query("SELECT status, heartbeat_at FROM discord_onliner_worker_state WHERE singleton = TRUE LIMIT 1")
      ]);
      const workerRow = workerResult.rows[0] ?? {};
      const heartbeatAt = workerRow.heartbeat_at ? new Date(workerRow.heartbeat_at).getTime() : 0;
      const workerOnline = serviceRunsOnliner || (workerRow.status === "online" && Date.now() - heartbeatAt < discordOnlinerWorkerHeartbeatMs * 3);
      for (const runtime of runtimeLinks.rows) {
        const discordUserId = String(runtime.discord_user_id ?? "");
        if (isDiscordGuildId(discordUserId) && !onlinerAccountByUserId.has(discordUserId)) {
          onlinerAccountByUserId.set(discordUserId, String(runtime.account_id));
        }
        if (!serviceRunsOnliner) {
          onlinerRuntimeByAccountId.set(String(runtime.account_id), {
            connectionState: workerOnline ? normalizeDiscordOnlinerConnectionState(runtime.payload?.connectionState) : "disconnected",
            lastError: workerOnline ? String(runtime.payload?.lastError ?? "").trim() || null : "Onliner worker is offline."
          });
        }
      }
      if (serviceRunsOnliner) {
        for (const account of onlinerConfig.accounts) {
          const runtime = discordOnlinerRuntimes.get(account.id);
          onlinerRuntimeByAccountId.set(account.id, {
            connectionState: normalizeDiscordOnlinerConnectionState(runtime?.state),
            lastError: String(runtime?.lastError ?? "").trim() || null
          });
        }
      } else {
        for (const account of onlinerConfig.accounts) {
          if (!onlinerRuntimeByAccountId.has(account.id)) {
            onlinerRuntimeByAccountId.set(account.id, {
              connectionState: "disconnected",
              lastError: workerOnline ? null : "Onliner worker is offline."
            });
          }
        }
      }
    }
    const onlinerAccountConfigById = new Map(onlinerConfig.accounts.map((account) => [account.id, account]));
    const onlinerStatusByUserId = new Map([...onlinerAccountByUserId.entries()].map(([discordUserId, accountId]) => {
      const runtime = onlinerRuntimeByAccountId.get(accountId) ?? { connectionState: "disconnected", lastError: null };
      const account = onlinerAccountConfigById.get(accountId);
      return [discordUserId, { accountId, richPresenceEnabled: account?.richPresenceEnabled !== false, ...runtime }];
    }));
    const syncProgress = getCommunityAuthorizationSyncSnapshot(config.guildId, activeCategoryId);
    res.set("Cache-Control", "no-store").json({
      configured: true,
      bot,
      guild,
      ...summary,
      syncing: syncProgress?.syncing === true,
      syncProgress,
      stockCategories,
      activeCategoryId,
      recent: recentResult.rows.map((row) => {
        const onliner = onlinerStatusByUserId.get(String(row.discord_user_id));
        return {
        id: row.discord_user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        status: row.status,
        stockType: normalizeCommunityStockType(row.stock_type),
        details: row.details,
        reservedOrderId: row.reserved_order_id,
        sortPosition: Number(row.sort_position),
        authorizedAt: row.authorized_at,
        joinedAt: row.joined_at,
        onlinerConnected: Boolean(onliner),
        onlinerAccountId: onliner?.accountId ?? null,
        onlinerConnectionState: onliner?.connectionState ?? null,
        onlinerLastError: onliner?.lastError ?? null,
        onlinerRichPresenceEnabled: onliner ? onliner.richPresenceEnabled : null,
        hasStoredAccountToken: row.has_stored_account_token === true
      };
      })
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
    const stockType = normalizeCommunityStockType(_req.query?.categoryId);
    const category = await pool.query(
      "SELECT id FROM community_stock_categories WHERE guild_id = $1 AND id = $2 LIMIT 1",
      [config.guildId, stockType]
    );
    if (!category.rowCount || String(_req.query?.categoryId ?? "").trim().toLowerCase() !== stockType) {
      return res.status(400).json({ message: "Choose a valid Members Stock category before refreshing." });
    }
    const result = startCommunityAuthorizationSync(config, stockType);
    res.status(202).set("Cache-Control", "no-store").json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/members/:discordUserId/access-token", requireSession, async (req, res, next) => {
  try {
    const discordUserId = String(req.params.discordUserId ?? "").trim();
    if (!isDiscordGuildId(discordUserId)) {
      return res.status(400).json({ message: "A valid connected user is required." });
    }
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "Configure Members Stock before viewing access tokens." });
    }
    const result = await pool.query(
      `SELECT encrypted_access_token, access_token_expires_at
       FROM community_oauth_joins
       WHERE discord_user_id = $1 AND guild_id = $2
       LIMIT 1`,
      [discordUserId, config.guildId]
    );
    const record = result.rows[0];
    if (!record?.encrypted_access_token) {
      return res.status(404).json({ message: "This member does not have a stored access token." });
    }
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache"
    }).json({
      accessToken: decryptCredential(record.encrypted_access_token),
      expiresAt: record.access_token_expires_at
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/members/:discordUserId/account-token", requireSession, async (req, res, next) => {
  try {
    const discordUserId = String(req.params.discordUserId ?? "").trim();
    if (!isDiscordGuildId(discordUserId)) {
      return res.status(400).json({ message: "A valid connected user is required." });
    }
    const config = await getCommunityOAuthConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "Configure Members Stock before viewing user tokens." });
    }
    const result = await pool.query(
      `SELECT encrypted_account_token
       FROM community_oauth_joins
       WHERE discord_user_id = $1 AND guild_id = $2
       LIMIT 1`,
      [discordUserId, config.guildId]
    );
    const record = result.rows[0];
    if (!record?.encrypted_account_token) {
      return res.status(404).json({ message: "This member does not have a stored user token." });
    }
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache"
    }).json({ accountToken: decryptCredential(record.encrypted_account_token) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/members/:discordUserId/onliner", requireSession, async (req, res, next) => {
  try {
    const discordUserId = String(req.params.discordUserId ?? "").trim();
    const richPresenceEnabled = req.body?.richPresenceEnabled !== false;
    if (!isDiscordGuildId(discordUserId)) return res.status(400).json({ message: "A valid Members Stock user is required." });

    const communityConfig = await getCommunityOAuthConfig();
    if (!communityConfig.configured) return res.status(503).json({ message: "Configure the Members bot before managing Onliner connections." });
    const member = await pool.query(
      "SELECT username, encrypted_account_token FROM community_oauth_joins WHERE guild_id = $1 AND discord_user_id = $2 LIMIT 1",
      [communityConfig.guildId, discordUserId]
    );
    if (!member.rowCount) return res.status(404).json({ message: "This user is no longer in Members Stock." });
    if (!member.rows[0].encrypted_account_token) {
      return res.status(409).json({ message: "This older stock record has no saved account token. Add the account again once to enable token-free Onliner connections." });
    }
    const accountToken = decryptCredential(member.rows[0].encrypted_account_token);

    const identity = await requestDiscord("users/@me", { headers: { Authorization: accountToken } });
    if (!identity.response.ok || String(identity.payload?.id ?? "") !== discordUserId) {
      return res.status(identity.response.status === 429 ? 429 : 401).json({
        message: identity.response.status === 429
          ? "Discord is rate limiting account checks. Try again shortly."
          : "This account token is invalid or belongs to a different Members Stock user."
      });
    }

    const current = await getDiscordOnlinerConfig();
    const explicitlyLinked = current.accounts.find((account) => account.discordUserId === discordUserId);
    if (explicitlyLinked) return res.status(409).json({ message: "This member is already connected to Onliner." });
    const tokenMatch = current.accounts.find((account) => account.botToken === accountToken);
    if (!tokenMatch && current.accounts.length >= discordOnlinerAccountLimit) {
      return res.status(409).json({ message: `The Onliner supports up to ${discordOnlinerAccountLimit} account profiles.` });
    }
    const proxyUrl = tokenMatch?.proxyUrl || selectDiscordOnlinerProxy(current);
    if (!proxyUrl) return res.status(409).json({ message: "Add at least one proxy to the Onliner proxy pool first." });

    const accountId = tokenMatch?.id ?? crypto.randomUUID();
    const linkedAccount = {
      ...(tokenMatch ?? {}),
      id: accountId,
      botToken: accountToken,
      proxyUrl,
      richPresenceEnabled,
      discordUserId
    };
    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      accounts: tokenMatch
        ? current.accounts.map((account) => account.id === tokenMatch.id ? linkedAccount : account)
        : [...current.accounts, linkedAccount]
    });
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));
    if (serviceRunsOnliner) {
      const existingRuntime = discordOnlinerRuntimes.get(accountId);
      if (existingRuntime) stopDiscordOnlinerRuntime(existingRuntime, { resetIdentity: true });
      const savedAccount = candidate.accounts.find((account) => account.id === accountId);
      if (savedAccount) startDiscordOnlinerAccounts(candidate, [savedAccount]);
    }
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    appendDiscordOnlinerLog("success", `Members Stock account ${member.rows[0].username} was connected to Onliner.`, accountId);
    res.status(tokenMatch ? 200 : 201).json({ connected: true, accountId, alreadyExisted: Boolean(tokenMatch) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/community/members/:discordUserId/onliner/rich-presence", requireSession, async (req, res, next) => {
  try {
    const discordUserId = String(req.params.discordUserId ?? "").trim();
    if (!isDiscordGuildId(discordUserId)) return res.status(400).json({ message: "A valid Members Stock user is required." });
    const richPresenceEnabled = req.body?.richPresenceEnabled === true;
    const current = await getDiscordOnlinerConfig();
    const linkedAccount = current.accounts.find((account) => account.discordUserId === discordUserId);
    if (!linkedAccount) return res.status(404).json({ message: "This member is not connected to Onliner." });

    if (linkedAccount.richPresenceEnabled === richPresenceEnabled) {
      return res.json({ updated: false, enabled: richPresenceEnabled, appliedLive: false });
    }

    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      accounts: current.accounts.map((account) => account.id === linkedAccount.id
        ? { ...account, richPresenceEnabled }
        : account)
    });
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));

    let appliedLive = false;
    if (serviceRunsOnliner) {
      const savedAccount = candidate.accounts.find((account) => account.id === linkedAccount.id);
      if (savedAccount) {
        appliedLive = applyDiscordOnlinerAccountPresenceLive(
          candidate,
          savedAccount,
          `Members Stock changed Rich Presence ${richPresenceEnabled ? "on" : "off"} without reconnecting.`
        );
      }
    }
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    res.json({ updated: true, enabled: richPresenceEnabled, appliedLive });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/community/members/:discordUserId/onliner", requireSession, async (req, res, next) => {
  try {
    const discordUserId = String(req.params.discordUserId ?? "").trim();
    if (!isDiscordGuildId(discordUserId)) return res.status(400).json({ message: "A valid Members Stock user is required." });
    const current = await getDiscordOnlinerConfig();
    const linkedIds = new Set(current.accounts.filter((account) => account.discordUserId === discordUserId).map((account) => account.id));
    if (current.accounts.length) {
      const runtimeLinks = await pool.query(
        `SELECT account_id FROM discord_onliner_runtime
         WHERE account_id = ANY($1::text[]) AND payload->'bot'->>'id' = $2`,
        [current.accounts.map((account) => account.id), discordUserId]
      );
      runtimeLinks.rows.forEach((row) => linkedIds.add(String(row.account_id)));
    }
    if (!linkedIds.size) return res.status(404).json({ message: "This member is not connected to Onliner." });

    const recoverableAccountToken = current.accounts.find((account) => linkedIds.has(account.id) && account.botToken)?.botToken;
    if (recoverableAccountToken) {
      await pool.query(
        `UPDATE community_oauth_joins
         SET encrypted_account_token = COALESCE(encrypted_account_token, $2)
         WHERE discord_user_id = $1`,
        [discordUserId, encryptCredential(recoverableAccountToken)]
      );
    }

    const candidate = normalizeDiscordOnlinerConfig({
      ...current,
      accounts: current.accounts.filter((account) => !linkedIds.has(account.id))
    });
    await saveEncryptedSetting(discordOnlinerSettingKey, JSON.stringify(candidate));
    for (const accountId of linkedIds) {
      const runtime = discordOnlinerRuntimes.get(accountId);
      if (runtime) stopDiscordOnlinerRuntime(runtime, { resetIdentity: true });
      discordOnlinerRuntimes.delete(accountId);
      discordOnlinerPendingRuntimeWrites.delete(accountId);
    }
    await pool.query("DELETE FROM discord_onliner_runtime WHERE account_id = ANY($1::text[])", [[...linkedIds]]);
    if (serviceRunsOnliner && discordOnlinerWorkerLockClient) discordOnlinerWorkerCurrentConfig = candidate;
    appendDiscordOnlinerLog("info", `Members Stock account ${discordUserId} was removed from Onliner.`);
    res.json({ removed: true, removedProfiles: linkedIds.size });
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
      `SELECT username
       FROM community_oauth_joins
       WHERE discord_user_id = $1 AND guild_id = $2
       FOR UPDATE`,
      [discordUserId, config.guildId]
    );
    if (!member.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "This user is no longer in Members Stock." });
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
       WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])
       RETURNING discord_user_id`,
      [config.guildId, ids]
    );
    res.json({ removed: removed.rowCount, skippedReserved: 0 });
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/members/transfer", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const config = await getCommunityOAuthConfig();
    if (!config.configured) return res.status(503).json({ message: "Configure the Members bot before managing Members Stock." });
    const sourceCategoryId = parseCommunityCategoryId(req.body?.sourceCategoryId);
    const targetCategoryId = parseCommunityCategoryId(req.body?.targetCategoryId);
    const ids = Array.from(new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map((value) => String(value ?? "").trim())
      .filter(isDiscordGuildId)));
    if (!sourceCategoryId || !targetCategoryId || sourceCategoryId === targetCategoryId || !ids.length || ids.length > 5_000) {
      return res.status(400).json({ message: "Choose members and a different destination category." });
    }

    await client.query("BEGIN");
    const categories = await client.query(
      "SELECT id FROM community_stock_categories WHERE guild_id = $1 AND id = ANY($2::text[]) FOR UPDATE",
      [config.guildId, [sourceCategoryId, targetCategoryId]]
    );
    if (categories.rowCount !== 2) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "The source or destination category no longer exists." });
    }

    const selected = await client.query(
      `SELECT discord_user_id, reserved_order_id
       FROM community_oauth_joins
       WHERE guild_id = $1 AND stock_type = $2 AND discord_user_id = ANY($3::text[])
       FOR UPDATE`,
      [config.guildId, sourceCategoryId, ids]
    );
    const movableIds = selected.rows
      .filter((row) => !row.reserved_order_id)
      .map((row) => String(row.discord_user_id));
    const skippedReserved = selected.rowCount - movableIds.length;
    if (!movableIds.length) {
      await client.query("COMMIT");
      return res.json({ moved: 0, skippedReserved });
    }

    const lastPosition = await client.query(
      `SELECT sort_position
       FROM community_oauth_joins
       WHERE guild_id = $1 AND stock_type = $2
       ORDER BY sort_position DESC
       LIMIT 1
       FOR UPDATE`,
      [config.guildId, targetCategoryId]
    );
    const basePosition = Number(lastPosition.rows[0]?.sort_position ?? 0);
    const moved = await client.query(
      `UPDATE community_oauth_joins AS stock
       SET stock_type = $3, sort_position = $4 + ordered.position * 1024
       FROM unnest($5::text[]) WITH ORDINALITY AS ordered(discord_user_id, position)
       WHERE stock.guild_id = $1
         AND stock.stock_type = $2
         AND stock.reserved_order_id IS NULL
         AND stock.discord_user_id = ordered.discord_user_id
       RETURNING stock.discord_user_id`,
      [config.guildId, sourceCategoryId, targetCategoryId, basePosition, movableIds]
    );
    await client.query("COMMIT");
    res.json({ moved: moved.rowCount, skippedReserved });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
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

function createCommunityBotInvite(config, guildId, joinMethod = "create_invite") {
  const normalizedJoinMethod = normalizeCommunityJoinMethod(joinMethod);
  const query = new URLSearchParams({
    client_id: config.clientId,
    scope: "bot",
    permissions: normalizedJoinMethod === "experimental_join" ? "35" : "1",
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

async function resolveConfiguredCommunityInvite(inviteValue, { allowWaitingForBot = false, joinMethod = "create_invite" } = {}) {
  const normalizedJoinMethod = normalizeCommunityJoinMethod(joinMethod);
  let config = await getCommunityOAuthConfig();
  if (!config.configured) {
    const error = new Error("Configure the Members integration before creating an order.");
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
  if (normalizedJoinMethod === "directly") {
    const directConfig = normalizeCommunityOAuthConfig({ ...config, guildId: serverInfo.guildId });
    if (serverInfo.guildId !== config.guildId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await copyCommunityStockForGuild(client, config.guildId, directConfig.guildId);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }
    return { config: directConfig, invite, serverInfo, waitingForBot: false };
  }
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
        botInvite: createCommunityBotInvite(config, serverInfo.guildId, normalizedJoinMethod)
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
      communityBotGuildCountCache = null;
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
          botInvite: createCommunityBotInvite(config, serverInfo.guildId, normalizedJoinMethod)
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
      botInvite: createCommunityBotInvite(config, serverInfo.guildId, normalizedJoinMethod)
    };
  }
  return { config, invite, serverInfo };
}

app.get("/api/community/availability", requireSession, async (req, res, next) => {
  try {
    if (normalizeCommunityJoinMethod(req.query?.joinMethod) === "directly") await loadDcordApiKey();
    const { config, serverInfo } = await resolveConfiguredCommunityInvite(req.query?.invite, {
      allowWaitingForBot: true,
      joinMethod: req.query?.joinMethod
    });
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
    const previouslyDeliveredUserIds = await loadCommunityUnavailableUserIds(pool, serverInfo.guildId);
    const result = await pool.query(
      `SELECT COUNT(*)::int AS available
       FROM community_oauth_joins
       WHERE guild_id = $1 AND stock_type = $2 AND status = 'authorized'
         AND reserved_order_id IS NULL
         AND (($4::boolean = TRUE AND encrypted_account_token IS NOT NULL)
           OR ($4::boolean = FALSE AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()))
         AND NOT (discord_user_id = ANY($3::text[]))`,
      [config.guildId, stockType, previouslyDeliveredUserIds, communityJoinMethodUsesAccountToken(req.query?.joinMethod)]
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
    const joinMethod = normalizeCommunityJoinMethod(req.body?.joinMethod, "create_invite");
    if (joinMethod === "directly") await loadDcordApiKey();
    const service = String(req.body?.service ?? "");
    if (!isCommunityServiceType(service) || !Number.isInteger(amount) || amount <= 0 || !Number.isInteger(delay) || delay < 1 || delay > 1200) {
      return res.status(400).json({ message: "A valid Members 2 mode, member amount and delay are required." });
    }
    const resolvedInvite = await resolveConfiguredCommunityInvite(req.body?.id, {
      allowWaitingForBot: true,
      joinMethod
    });
    const { config, serverInfo, invitesPaused } = resolvedInvite;
    let { waitingForBot, waitingDetails, waitingCode, botInvite } = resolvedInvite;
    let deliveryInvite = String(req.body?.id ?? "").trim();
    let serverInviteCreatedByBot = false;
    if (joinMethod === "experimental_join" && !waitingForBot && !invitesPaused) {
      try {
        await ensureCommunityApplyToJoin(config, serverInfo.guildId);
        deliveryInvite = await createCommunityExperimentalServerInvite(config, serverInfo.guildId);
        serverInviteCreatedByBot = true;
      } catch (error) {
        if (error?.statusCode !== 409) throw error;
        waitingForBot = true;
        waitingCode = "discord_permissions";
        waitingDetails = error instanceof Error ? error.message : "The Members bot needs Manage Server, Kick Members, and Create Invite permissions for Experimental Join.";
        botInvite = createCommunityBotInvite(config, serverInfo.guildId, joinMethod);
      }
    }
    const requestedCategoryId = req.body?.categoryId ?? getCommunityStockTypeFromService(service);
    const rawAllocations = Array.isArray(req.body?.categoryAllocations) ? req.body.categoryAllocations : [];
    const allocationMap = new Map();
    for (const allocation of rawAllocations) {
      const categoryId = parseCommunityCategoryId(allocation?.categoryId);
      const allocationAmount = Number.parseInt(allocation?.amount, 10);
      if (!categoryId || !Number.isInteger(allocationAmount) || allocationAmount <= 0) {
        return res.status(400).json({ message: "Choose valid Members 2 categories and amounts." });
      }
      allocationMap.set(categoryId, (allocationMap.get(categoryId) ?? 0) + allocationAmount);
    }
    if (!allocationMap.size) {
      const categoryId = parseCommunityCategoryId(requestedCategoryId);
      if (!categoryId) return res.status(400).json({ message: "Choose a valid Members 2 category." });
      allocationMap.set(categoryId, amount);
    }
    const requestedAllocations = Array.from(allocationMap, ([categoryId, allocationAmount]) => ({ categoryId, amount: allocationAmount }));
    const allocatedAmount = requestedAllocations.reduce((total, allocation) => total + allocation.amount, 0);
    if (requestedAllocations.length > 12 || allocatedAmount !== amount) {
      return res.status(400).json({ message: "Category amounts must equal the total member amount." });
    }
    const requestedCategoryIds = requestedAllocations.map((allocation) => allocation.categoryId);
    const categoryResult = await pool.query(
      `SELECT id, name, is_periodic, check_replacement_enabled, reaction_use_enabled
       FROM community_stock_categories
       WHERE guild_id = $1 AND id = ANY($2::text[])`,
      [config.guildId, requestedCategoryIds]
    );
    if (categoryResult.rowCount !== requestedAllocations.length) {
      return res.status(400).json({ message: "One or more Members 2 categories could not be found." });
    }
    const categoriesById = new Map(categoryResult.rows.map((category) => [category.id, category]));
    const reactionCategoryIds = new Set(categoryResult.rows
      .filter((category) => category.reaction_use_enabled === true)
      .map((category) => category.id));
    const availableReactionMembers = requestedAllocations.reduce((total, allocation) => (
      reactionCategoryIds.has(allocation.categoryId) ? total + allocation.amount : total
    ), 0);
    const reactionCapacity = availableReactionMembers > 0 ? Number.parseInt(req.body?.reactionLimit, 10) : 0;
    if (availableReactionMembers > 0 && (!Number.isInteger(reactionCapacity) || reactionCapacity < 1 || reactionCapacity > availableReactionMembers)) {
      return res.status(400).json({ message: `Choose a reaction limit between 1 and ${availableReactionMembers}.` });
    }
    const hasPeriodicCategory = categoryResult.rows.some((category) => category.is_periodic === true);
    const durationMonths = hasPeriodicCategory ? Number.parseInt(req.body?.durationMonths, 10) : null;
    if (hasPeriodicCategory && (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 6)) {
      return res.status(400).json({ message: "Choose an order duration between 1 and 6 months." });
    }
    const uniqid = createCommunityOrderId();
    client = await pool.connect();
    await client.query("BEGIN");
    const previouslyDeliveredUserIds = await loadCommunityUnavailableUserIds(client, serverInfo.guildId);
    const createdAt = new Date();
    const selectedGroups = [];
    const categoryAllocations = [];
    for (const allocation of requestedAllocations) {
      const category = categoriesById.get(allocation.categoryId);
      const selected = await client.query(
        `SELECT discord_user_id, username, avatar_url, encrypted_account_token, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, stock_type AS category_id
         FROM community_oauth_joins
         WHERE guild_id = $1 AND stock_type = $2 AND status = 'authorized'
           AND reserved_order_id IS NULL
           AND (($5::boolean = TRUE AND encrypted_account_token IS NOT NULL)
             OR ($5::boolean = FALSE AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()))
           AND NOT (discord_user_id = ANY($4::text[]))
         ORDER BY random()
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [config.guildId, allocation.categoryId, allocation.amount, previouslyDeliveredUserIds, communityJoinMethodUsesAccountToken(joinMethod)]
      );
      if (selected.rowCount < allocation.amount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ message: `Only ${selected.rowCount} ${category.name} members are currently available.` });
      }
      selectedGroups.push(selected.rows);
      categoryAllocations.push({
        categoryId: category.id,
        categoryName: category.name,
        amount: allocation.amount,
        added: 0,
        isPeriodic: category.is_periodic === true,
        checkReplacementEnabled: category.check_replacement_enabled !== false,
        reactionUseEnabled: category.reaction_use_enabled === true,
        durationMonths: category.is_periodic === true ? durationMonths : null,
        expiredAt: category.is_periodic === true ? addUtcMonths(createdAt, durationMonths).toISOString() : null
      });
    }
    const selectedMembers = interleaveCommunityMembers(selectedGroups);
    await client.query(
      `UPDATE community_oauth_joins
       SET reserved_order_id = $3
       WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])`,
      [config.guildId, selectedMembers.map((member) => member.discord_user_id), uniqid]
    );
    const primaryCategory = categoriesById.get(requestedAllocations[0].categoryId);
    const order = {
      uniqid,
      provider: "community",
      service,
      stockType: primaryCategory.id,
      categoryId: primaryCategory.id,
      categoryName: categoryAllocations.length > 1 ? `${categoryAllocations.length} categories` : primaryCategory.name,
      categoryAllocations,
      categoryIsPeriodic: categoryAllocations.some((allocation) => allocation.isPeriodic),
      categoryCheckReplacementEnabled: categoryAllocations.some((allocation) => allocation.checkReplacementEnabled !== false),
      reactionCapacity,
      reactionMessageLink: null,
      reactionMessage: null,
      reactionRequests: [],
      durationMonths,
      serverId: serverInfo.guildId,
      serverName: serverInfo.guildName,
      serverInvite: deliveryInvite,
      serverInviteCreatedByBot,
      serverMemberCount: serverInfo.approximateMemberCount,
      amount,
      added: 0,
      delay,
      speedProfile,
      joinMethod,
      isEldoradoSale: req.body?.isEldoradoSale !== false,
      createdAt: createdAt.toISOString(),
      expiredAt: categoryAllocations.every((allocation) => allocation.isPeriodic)
        ? addUtcMonths(createdAt, durationMonths).toISOString()
        : null,
      status: invitesPaused ? "INVITES PAUSED" : waitingForBot ? "WAITING" : "PROCESS",
      waitingCode: invitesPaused ? "discord_guild_invites_limited" : waitingForBot ? (waitingCode ?? "discord_missing") : null,
      details: waitingForBot || invitesPaused ? (waitingDetails ?? "Add the Members bot to this server to start delivery.") : `0/${amount} members delivered.`,
      experimentalJoin: joinMethod === "experimental_join",
      botApplicationId: config.clientId,
      botInvite,
      communityResults: (() => {
        let availableReactions = 0;
        return selectedMembers.map((row) => {
          const reactionAvailable = reactionCategoryIds.has(row.category_id) && availableReactions < reactionCapacity;
          if (reactionAvailable) availableReactions += 1;
          return {
            discordUserId: row.discord_user_id,
            username: row.username,
            avatarUrl: row.avatar_url ?? null,
            categoryId: row.category_id,
            categoryName: categoriesById.get(row.category_id)?.name ?? row.category_id,
            state: "queued",
            details: "Waiting for delivery.",
            ...(reactionAvailable ? { reactionAvailable: true } : {})
          };
        });
      })()
    };
    await client.query(
      `INSERT INTO tracked_orders (uniqid, payload, created_at, updated_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())`,
      [uniqid, JSON.stringify(order)]
    );
    await client.query("COMMIT");
    if (!waitingForBot && !invitesPaused) {
      void processCommunityOrder(order, selectedMembers, config).catch(async (error) => {
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
      categoryAllocations: order.categoryAllocations,
      categoryIsPeriodic: order.categoryIsPeriodic,
      reactionMessageLink: order.reactionMessageLink,
      reactionCapacity: order.reactionCapacity,
      durationMonths: order.durationMonths,
      joinMethod: order.joinMethod,
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
  const joinMethod = getCommunityOrderJoinMethod(order);
  if (joinMethod !== "directly" && latestConfig.configured && isDiscordGuildId(targetGuildId)) {
    const currentBotInvite = createCommunityBotInvite(latestConfig, targetGuildId, joinMethod);
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
  const shouldUseStoredGuildRecovery = joinMethod !== "directly" && targetConfig.configured && (
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
    resolved ??= await resolveConfiguredCommunityInvite(order.serverInvite, { joinMethod });
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

  let deliveryInvite = order.serverInvite;
  let serverInviteCreatedByBot = order.serverInviteCreatedByBot === true;
  if (joinMethod === "experimental_join") {
    try {
      await ensureCommunityApplyToJoin(resolved.config, resolved.serverInfo.guildId);
      if (!serverInviteCreatedByBot) {
        deliveryInvite = await createCommunityExperimentalServerInvite(resolved.config, resolved.serverInfo.guildId);
        serverInviteCreatedByBot = true;
      }
    } catch (error) {
      const waitingOrder = {
        ...order,
        status: "WAITING",
        waitingCode: "discord_permissions",
        botInvite: createCommunityBotInvite(resolved.config, resolved.serverInfo.guildId, joinMethod),
        details: error instanceof Error ? error.message : "The Members bot could not enable Apply to Join."
      };
      await saveTrackedOrderPayload(waitingOrder);
      return waitingOrder;
    }
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
    const pendingUserIds = existingResults
      .filter((item) => pendingStates.has(String(item?.state ?? "").toLowerCase()))
      .map((item) => String(item?.discordUserId ?? ""))
      .filter(isDiscordGuildId);

    let members = (await client.query(
      `SELECT discord_user_id, username, avatar_url, encrypted_account_token, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, stock_type AS category_id
       FROM community_oauth_joins
        WHERE guild_id = $1 AND discord_user_id = ANY($2::text[]) AND status = 'authorized'
         AND (($3::boolean = TRUE AND encrypted_account_token IS NOT NULL)
           OR ($3::boolean = FALSE AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()))
       ORDER BY array_position($2::text[], discord_user_id)
       FOR UPDATE`,
      [resolved.config.guildId, pendingUserIds, communityJoinMethodUsesAccountToken(joinMethod)]
    )).rows;

    const usedDiscordUserIds = Array.isArray(current.communityResults)
      ? current.communityResults
          .filter((item) => ["joined", "pending_join"].includes(String(item?.state ?? "").toLowerCase()))
          .map((item) => String(item?.discordUserId ?? ""))
          .filter(isDiscordGuildId)
      : [];
    const missing = Math.max(0, remainingAmount - members.length);
    if (missing > 0) {
      const previouslyDeliveredUserIds = await loadCommunityUnavailableUserIds(client, resolved.config.guildId);
      const excludedUserIds = new Set([...usedDiscordUserIds, ...pendingUserIds, ...previouslyDeliveredUserIds]);
      const availableByCategory = new Map();
      for (const member of members) {
        const categoryId = normalizeCommunityStockType(member.category_id);
        availableByCategory.set(categoryId, (availableByCategory.get(categoryId) ?? 0) + 1);
      }
      const requiredByCategory = new Map();
      for (const item of existingResults.filter((result) => pendingStates.has(String(result?.state ?? "").toLowerCase()))) {
        const categoryId = getCommunityResultStockType(current, item);
        requiredByCategory.set(categoryId, (requiredByCategory.get(categoryId) ?? 0) + 1);
      }
      if (!requiredByCategory.size) requiredByCategory.set(getCommunityOrderStockType(current), missing);
      for (const [categoryId, required] of requiredByCategory) {
        const categoryMissing = Math.max(0, required - (availableByCategory.get(categoryId) ?? 0));
        if (!categoryMissing) continue;
        const extra = await client.query(
          `SELECT discord_user_id, username, avatar_url, encrypted_account_token, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, stock_type AS category_id
           FROM community_oauth_joins
           WHERE guild_id = $1 AND stock_type = $2 AND status = 'authorized' AND reserved_order_id IS NULL
             AND (($5::boolean = TRUE AND encrypted_account_token IS NOT NULL)
               OR ($5::boolean = FALSE AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()))
             AND NOT (discord_user_id = ANY($4::text[]))
           ORDER BY random()
           LIMIT $3
           FOR UPDATE SKIP LOCKED`,
          [resolved.config.guildId, categoryId, categoryMissing, Array.from(excludedUserIds), communityJoinMethodUsesAccountToken(joinMethod)]
        );
        for (const member of extra.rows) excludedUserIds.add(String(member.discord_user_id));
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
        : { discordUserId: member.discord_user_id, username: member.username, avatarUrl: member.avatar_url ?? null, categoryId: member.category_id, state: "queued", details: "Waiting for delivery." };
    });
    const activeOrder = {
      ...current,
      status: "PROCESS",
      waitingCode: null,
      details: `${Number(current.added ?? 0)}/${current.amount} members delivered.`,
      serverId: resolved.serverInfo.guildId,
      serverName: resolved.serverInfo.guildName,
      serverInvite: deliveryInvite,
      serverInviteCreatedByBot,
      serverMemberCount: resolved.serverInfo.approximateMemberCount,
      communityResults: [...settledResults, ...pendingResults]
    };
    if (members.length) {
      await client.query(
        "UPDATE community_oauth_joins SET reserved_order_id = $3 WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])",
        [resolved.config.guildId, members.map((member) => member.discord_user_id), current.uniqid]
      );
    }
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
      if (getCommunityOrderJoinMethod(order) === "experimental_join") {
        const approval = await resolveCommunityPendingJoin(config, item.discordUserId);
        if (approval.joined) joinedUserIds.add(String(item.discordUserId));
        if (approval.pendingScreening) pendingUserIds.add(String(item.discordUserId));
        continue;
      }
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
    return resetCommunityResultVerification(item, {
      state: "joined",
      details: pendingUserIds.has(discordUserId)
        ? "Member joined the server and is pending Discord's server-rules screening."
        : "Member joined the server.",
      completedAt,
      ...(item?.reactionEmoji && item?.reactionMessage ? {
        reactionState: "pending",
        reactionDetails: "Waiting for the Onliner Gateway connection before reacting."
      } : {})
    });
  });
  for (const item of communityResults) {
      if (!joinedUserIds.has(String(item?.discordUserId ?? "")) || !item?.reactionEmoji || !item?.reactionMessage) continue;
      await pool.query(
        `INSERT INTO community_reaction_jobs (order_id, discord_user_id, channel_id, message_id, emoji)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [order.uniqid, item.discordUserId, item.reactionMessage.channelId, item.reactionMessage.messageId, String(item.reactionEmoji)]
      );
  }
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
  const generatedBotInvite = getCommunityOrderJoinMethod(order) !== "directly" && !order.botInvite && isDiscordGuildId(String(order.botApplicationId ?? "")) && isDiscordGuildId(String(order.serverId ?? ""))
    ? createCommunityBotInvite({ clientId: String(order.botApplicationId) }, String(order.serverId), getCommunityOrderJoinMethod(order))
    : order.botInvite;
  return {
    ...order,
    botInvite: generatedBotInvite,
    communityResults: order.communityResults.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const sanitized = { ...item };
      const state = String(item.state ?? "").toLowerCase();
      const removedByOperator = item.membershipStatus === "removed";
      sanitized.details = item.authorizationStatus === "inactive"
          ? "This member is still in the server, but its OAuth authorization is inactive."
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
      if (removedByOperator) {
        delete sanitized.membershipStatus;
        delete sanitized.membershipDetails;
        delete sanitized.membershipCheckedAt;
        delete sanitized.leftServerAt;
      }
      return sanitized;
    })
  };
}

const communityCategoryDisplayCache = { guildId: null, expiresAt: 0, categories: new Map() };

function invalidateCommunityCategoryDisplayCache() {
  communityCategoryDisplayCache.expiresAt = 0;
}

async function hydrateCommunityOrderCategories(order) {
  if (!order || order.provider !== "community") return order;
  const categoryIds = Array.from(new Set([
    String(order.categoryId ?? "").trim(),
    ...(Array.isArray(order.categoryAllocations) ? order.categoryAllocations.map((item) => String(item?.categoryId ?? "").trim()) : []),
    ...(Array.isArray(order.communityResults) ? order.communityResults.map((item) => String(item?.categoryId ?? "").trim()) : [])
  ].filter(Boolean)));
  if (!categoryIds.length) return order;

  const config = await getCommunityOAuthConfig();
  if (!config.guildId) return order;
  if (communityCategoryDisplayCache.guildId !== config.guildId || communityCategoryDisplayCache.expiresAt <= Date.now()) {
    const result = await pool.query(
      "SELECT id, name, color_key, check_replacement_enabled FROM community_stock_categories WHERE guild_id = $1",
      [config.guildId]
    );
    communityCategoryDisplayCache.guildId = config.guildId;
    communityCategoryDisplayCache.expiresAt = Date.now() + 3_000;
    communityCategoryDisplayCache.categories = new Map(result.rows.map((category) => [category.id, category]));
  }

  const currentCategories = communityCategoryDisplayCache.categories;
  const categoryAllocations = Array.isArray(order.categoryAllocations)
    ? order.categoryAllocations.map((allocation) => {
        const current = currentCategories.get(String(allocation?.categoryId ?? ""));
        return current ? {
          ...allocation,
          categoryName: current.name,
          colorKey: current.color_key,
          checkReplacementEnabled: current.check_replacement_enabled !== false
        } : allocation;
      })
    : order.categoryAllocations;
  const primaryCategory = currentCategories.get(String(order.categoryId ?? ""));
  return {
    ...order,
    categoryName: Array.isArray(categoryAllocations) && categoryAllocations.length > 1
      ? `${categoryAllocations.length} categories`
      : primaryCategory?.name ?? order.categoryName,
    categoryColorKey: primaryCategory?.color_key ?? order.categoryColorKey,
    categoryCheckReplacementEnabled: primaryCategory
      ? primaryCategory.check_replacement_enabled !== false
      : order.categoryCheckReplacementEnabled,
    categoryAllocations,
    communityResults: Array.isArray(order.communityResults)
      ? order.communityResults.map((item) => {
          const current = currentCategories.get(String(item?.categoryId ?? order.categoryId ?? ""));
          if (!current) return item;
          const next = { ...item, categoryName: current.name, colorKey: current.color_key };
          if (current.check_replacement_enabled === false) {
            delete next.onlinerLive;
            delete next.onlinerConnectionState;
            delete next.onlinerDetails;
            delete next.onlinerCheckedAt;
          }
          return next;
        })
      : order.communityResults
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
    payload = await hydrateCommunityOrderCategories(payload);
    res.set("Cache-Control", "no-store").json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders/:uniqid/check-members", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    let order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") return res.status(404).json({ message: "Members order could not be found." });
    order = await hydrateCommunityOrderCategories(order);
    const result = await runCommunityOrderMemberCheck(order);
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/community/orders/:uniqid/leave-all", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });
    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") return res.status(404).json({ message: "Members order could not be found." });
    if (String(order.status ?? "").toUpperCase() !== "COMPLETED") {
      return res.status(409).json({ message: "Leave all is available after the Members order is completed." });
    }
    const result = await leaveAllCommunityOrderMembers(order);
    res.set("Cache-Control", "no-store").json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/community/orders/:uniqid/check-members/progress", requireSession, (req, res) => {
  const uniqid = String(req.params.uniqid ?? "").trim();
  res.set("Cache-Control", "no-store").json(communityOrderMemberCheckProgress.get(uniqid) ?? {
    active: false,
    total: 0,
    checked: 0,
    stage: "idle"
  });
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
    await client.query("UPDATE community_reaction_jobs SET status = 'cancelled', completed_at = NOW(), last_error = 'Order cancelled.' WHERE order_id = $1 AND status = 'pending'", [uniqid]);
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
        botInvite: createCommunityBotInvite(targetConfig, targetGuildId, getCommunityOrderJoinMethod(order)),
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
    const requestedSpeedProfile = normalizeCommunitySpeedProfile(req.body?.speedProfile);
    const profileDelay = requestedSpeedProfile === "safe" ? 700 : requestedSpeedProfile === "balanced" ? 300 : requestedSpeedProfile === "fast" ? 60 : null;
    const delay = profileDelay ?? Number.parseInt(req.body?.delay, 10);
    if (!uniqid || uniqid.length > 160 || !Number.isInteger(delay) || delay < 0 || delay > 1200) {
      return res.status(400).json({ message: "A valid order ID and delay between 0 and 1200 seconds are required." });
    }
    const updated = await pool.query(
      `UPDATE tracked_orders
       SET payload = jsonb_set(jsonb_set(payload, '{delay}', to_jsonb($2::int)), '{speedProfile}', to_jsonb($3::text)), updated_at = NOW()
       WHERE uniqid = $1 AND payload->>'provider' = 'community' AND payload->>'status' IN ('WAITING', 'PROCESS', 'PAUSED')
       RETURNING payload`,
      [uniqid, delay, requestedSpeedProfile]
    );
    if (!updated.rowCount) return res.status(409).json({ message: "This Members order is no longer active." });
    res.json(updated.rows[0].payload);
  } catch (error) {
    next(error);
  }
});

async function updateCommunityReactionMessage(req, res, next) {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const reactionMessage = parseDiscordMessageLink(req.body?.messageLink);
    const requestedCount = Number.parseInt(req.body?.reactionCount, 10);
    const requestedEmojiCount = Number.parseInt(req.body?.emojiCount, 10);
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });
    if (!reactionMessage) return res.status(400).json({ message: "Enter a valid Discord message link." });

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }
    if (reactionMessage.guildId !== String(order.serverId ?? "")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "The reaction message must belong to this order's Discord server." });
    }
    const hasExplicitReactionCapacity = Number.isInteger(Number(order.reactionCapacity));
    const reactionCapacity = hasExplicitReactionCapacity
      ? Math.max(0, Number(order.reactionCapacity))
      : order.communityResults.filter((item) => item?.reactionAvailable === true).length;
    const existingRequests = Array.isArray(order.reactionRequests) ? order.reactionRequests : [];
    const assignedCount = existingRequests.reduce((total, request) => total + Math.max(0, Number(request?.assignedCount) || 0), 0);
    const remainingCount = Math.max(0, reactionCapacity - assignedCount);
    if (!reactionCapacity) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Reaction use is not enabled for this order." });
    }
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > remainingCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: remainingCount > 0
        ? `Choose a reaction amount between 1 and ${remainingCount}.`
        : "This order's reaction limit has been used." });
    }
    if (!Number.isInteger(requestedEmojiCount) || requestedEmojiCount < 1 || requestedEmojiCount > Math.min(20, requestedCount)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: `Choose an emoji count between 1 and ${Math.min(20, requestedCount)}.` });
    }

    const deliveredMembers = order.communityResults.filter((item) =>
      item?.discordUserId && ["joined", "already_member"].includes(String(item?.state ?? "").toLowerCase())
    );
    const maximumRequestSize = deliveredMembers.length * requestedEmojiCount;
    if (!deliveredMembers.length || requestedCount > maximumRequestSize) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: deliveredMembers.length
        ? `With ${requestedEmojiCount} emojis, this delivered member pool can add at most ${maximumRequestSize} reactions to one message.`
        : "No delivered members are available for reactions yet." });
    }

    const requestId = crypto.randomUUID();
    const usedPairs = new Set(existingRequests
      .filter((request) => request?.messageLink === reactionMessage.url)
      .flatMap((request) => Array.isArray(request?.assignments) ? request.assignments : [])
      .map((assignment) => `${assignment?.discordUserId}:${assignment?.reactionEmoji}`));
    const assignments = createNaturalCommunityReactionAssignments(deliveredMembers, requestedCount, usedPairs, requestedEmojiCount);
    if (assignments.length !== requestedCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This delivered member pool does not have enough unused member and emoji combinations for that message." });
    }
    for (const assignment of assignments) {
      await client.query(
        `INSERT INTO community_reaction_jobs (order_id, request_id, discord_user_id, channel_id, message_id, emoji)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [uniqid, requestId, assignment.discordUserId, reactionMessage.channelId, reactionMessage.messageId, assignment.reactionEmoji]
      );
    }
    const updatedOrder = {
      ...order,
      reactionCapacity,
      reactionMessageLink: reactionMessage.url,
      reactionMessage: { channelId: reactionMessage.channelId, messageId: reactionMessage.messageId },
      reactionRequests: [...existingRequests, {
        id: requestId,
        messageLink: reactionMessage.url,
        requestedCount,
        emojiCount: requestedEmojiCount,
        assignedCount: assignments.length,
        assignments,
        createdAt: new Date().toISOString()
      }],
      communityResults: order.communityResults
    };
    await client.query("UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [uniqid, JSON.stringify(updatedOrder)]);
    await client.query("COMMIT");
    const isPublicRequest = req.path.startsWith("/api/public/");
    res.set("Cache-Control", "no-store").json(isPublicRequest ? sanitizePublicCommunityOrder(updatedOrder) : updatedOrder);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

app.put("/api/community/orders/:uniqid/reaction-limit", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const reactionLimit = Number.parseInt(req.body?.reactionLimit, 10);
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }

    const assignedCount = order.communityResults.filter((item) => item?.reactionEligible === true).length;
    if (!Number.isSafeInteger(reactionLimit) || reactionLimit < Math.max(1, assignedCount)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: assignedCount > 0
          ? `Choose a reaction limit of at least ${assignedCount}.`
          : "Choose a reaction limit of at least 1."
      });
    }

    const availableIndices = new Set();
    order.communityResults.forEach((item, index) => {
      if (item?.reactionEligible === true) availableIndices.add(index);
    });
    order.communityResults.forEach((_item, index) => {
      if (availableIndices.size < reactionLimit) availableIndices.add(index);
    });
    const communityResults = order.communityResults.map((item, index) => {
      if (!item) return item;
      if (availableIndices.has(index)) return { ...item, reactionAvailable: true };
      const { reactionAvailable: _reactionAvailable, ...rest } = item;
      return rest;
    });
    const updatedOrder = { ...order, reactionCapacity: reactionLimit, communityResults };
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

app.put("/api/community/orders/:uniqid/reaction-message", requireSession, updateCommunityReactionMessage);
app.put("/api/public/orders/:uniqid/reaction-message", updateCommunityReactionMessage);

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
    const extendExpiration = (value) => {
      const currentExpiration = new Date(value);
      const extensionBase = Number.isFinite(currentExpiration.getTime()) && currentExpiration > now ? currentExpiration : now;
      return addUtcMonths(extensionBase, months).toISOString();
    };
    const nextCategoryAllocations = Array.isArray(order.categoryAllocations)
      ? order.categoryAllocations.map((allocation) => allocation?.isPeriodic === true
        ? {
            ...allocation,
            durationMonths: Math.max(0, Number(allocation.durationMonths) || 0) + months,
            expiredAt: extendExpiration(allocation.expiredAt)
          }
        : allocation)
      : null;
    const allCategoriesPeriodic = nextCategoryAllocations?.length > 0 && nextCategoryAllocations.every((allocation) => allocation?.isPeriodic === true);
    const nextExpiration = allCategoriesPeriodic
      ? nextCategoryAllocations.reduce((latest, allocation) => !latest || new Date(allocation.expiredAt) > new Date(latest) ? allocation.expiredAt : latest, null)
      : nextCategoryAllocations ? null : extendExpiration(order.expiredAt);
    const extendedAt = now.toISOString();
    const updatedOrder = {
      ...order,
      durationMonths: Math.max(0, Number(order.durationMonths) || 0) + months,
      expiredAt: nextExpiration,
      ...(nextCategoryAllocations ? { categoryAllocations: nextCategoryAllocations } : {}),
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

app.post("/api/community/orders/:uniqid/retry-failed", requireSession, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) return res.status(400).json({ message: "A valid order ID is required." });

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }
    if (!["PARTIAL", "COMPLETED", "ERROR"].includes(String(order.status ?? "").toUpperCase())) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Wait for the current delivery to finish before retrying failed members." });
    }

    const failedUserIds = order.communityResults
      .filter((item) => String(item?.state ?? "").toLowerCase() === "failed" && isDiscordGuildId(String(item?.discordUserId ?? "")))
      .map((item) => String(item.discordUserId));
    if (!failedUserIds.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This order has no failed members to retry." });
    }

    const memberResult = await client.query(
      `SELECT discord_user_id, username, avatar_url, encrypted_account_token, encrypted_access_token,
              encrypted_refresh_token, access_token_expires_at, stock_type AS category_id
       FROM community_oauth_joins
       WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])`,
      [order.serverId, failedUserIds]
    );
    const retryUserIds = new Set(memberResult.rows.map((member) => String(member.discord_user_id)));
    if (!retryUserIds.size) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "The failed members are no longer available in Members Stock." });
    }

    await client.query(
      "UPDATE community_oauth_joins SET reserved_order_id = $3 WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])",
      [order.serverId, [...retryUserIds], uniqid]
    );
    const communityResults = order.communityResults.map((item) => retryUserIds.has(String(item?.discordUserId ?? ""))
      ? resetCommunityResultVerification(item, {
          state: "queued",
          details: "Failed member queued for retry.",
          completedAt: undefined,
          retryAttempt: Math.max(0, Number(item?.retryAttempt) || 0) + 1
        })
      : item);
    const added = communityResults.filter((item) => String(item?.state ?? "").toLowerCase() === "joined").length;
    const retryOrder = {
      ...order,
      added,
      status: "PROCESS",
      waitingCode: null,
      details: `${retryUserIds.size} failed member${retryUserIds.size === 1 ? "" : "s"} queued for retry.`,
      activeDelay: null,
      nextMemberAt: null,
      communityResults
    };
    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [uniqid, JSON.stringify(retryOrder)]
    );
    await client.query("COMMIT");

    const config = normalizeCommunityOAuthConfig({ ...(await getCommunityOAuthConfig()), guildId: String(order.serverId ?? "") });
    void processCommunityOrder(retryOrder, memberResult.rows, config).catch(async (error) => {
      console.error("Members retry failed:", error instanceof Error ? error.message : error);
      await saveTrackedOrderPayload({ ...retryOrder, status: "ERROR", details: error instanceof Error ? error.message : "Members retry failed." }).catch(() => {});
    });
    res.set("Cache-Control", "no-store").json(retryOrder);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    next(error);
  } finally {
    client.release();
  }
});

app.post("/api/community/orders/:uniqid/replace-all", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    if (!uniqid || uniqid.length > 160) {
      return res.status(400).json({ message: "A valid order ID is required." });
    }
    const isAdminRequest = await hasActiveSession(req);
    const publicCooldownKey = `${req.ip}:${uniqid}:all`;
    const publicCooldownUntil = publicCommunityReplaceCooldowns.get(publicCooldownKey) ?? 0;
    if (!isAdminRequest && publicCooldownUntil > Date.now()) {
      const retrySeconds = Math.max(1, Math.ceil((publicCooldownUntil - Date.now()) / 1000));
      return res.status(429).json({ message: `Wait ${retrySeconds}s before trying this replacement again.` });
    }

    const baseConfig = await getCommunityOAuthConfig();
    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    let order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }
    order = await hydrateCommunityOrderCategories(order);
    if (!isAdminRequest && isCommunityOrderManagementExpired(order)) {
      await client.query("ROLLBACK");
      return res.status(410).json({ message: "This order's member support period has expired." });
    }

    const targetGuildId = String(order.serverId ?? "").trim();
    const config = normalizeCommunityOAuthConfig({ ...baseConfig, guildId: targetGuildId });
    const joinMethod = getCommunityOrderJoinMethod(order);
    if (!config.configured) {
      await client.query("ROLLBACK");
      return res.status(503).json({ message: "Configure the Members integration before replacing members." });
    }
    await copyCommunityStockForGuild(client, baseConfig.guildId, targetGuildId);
    if (joinMethod !== "directly") {
      const botAccess = await checkCommunityBotGuildAccess(config, targetGuildId);
      if (!botAccess.accessible) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "To replace these members, please add the bot to the order's Discord server.",
          botInvite: createCommunityBotInvite(config, targetGuildId, joinMethod)
        });
      }
    }
    if (joinMethod === "experimental_join") {
      try {
        await ensureCommunityApplyToJoin(config, targetGuildId);
        if (order.serverInviteCreatedByBot !== true) {
          order = {
            ...order,
            serverInvite: await createCommunityExperimentalServerInvite(config, targetGuildId),
            serverInviteCreatedByBot: true
          };
        }
      } catch (error) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: error instanceof Error ? error.message : "Experimental Join could not prepare Apply to Join.",
          botInvite: createCommunityBotInvite(config, targetGuildId, "experimental_join")
        });
      }
    }
    if (!["PARTIAL", "COMPLETED", "ERROR"].includes(String(order.status ?? "").toUpperCase())) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Wait for the current delivery to finish before replacing members." });
    }

    const results = order.communityResults.map((item) => ({ ...item }));
    const replaceableIndices = results.flatMap((item, index) => {
      const state = String(item?.state ?? "").toLowerCase();
      const removed = String(item?.membershipStatus ?? "").toLowerCase() === "removed";
      const notLiveWithPeriodicSupport = isCommunityOnlinerReplacementEligible(order, item);
      return !removed && (["failed", "blocked", "already_member"].includes(state) || notLiveWithPeriodicSupport)
        && !isCommunityResultManagementExpired(order, item) ? [index] : [];
    });
    if (!replaceableIndices.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "This order has no replaceable members." });
    }

    const previouslyDeliveredUserIds = await loadCommunityUnavailableUserIds(client, targetGuildId);
    const usedUserIds = Array.from(new Set([
      ...previouslyDeliveredUserIds,
      ...results.flatMap((item) => [
        String(item?.discordUserId ?? "").trim(),
        ...(Array.isArray(item?.replacementHistoryUserIds) ? item.replacementHistoryUserIds.map((value) => String(value ?? "").trim()) : [])
      ]).filter(isDiscordGuildId)
    ]));
    const usedUsernames = Array.from(new Set(results.flatMap((item) => [
      String(item?.username ?? "").trim(),
      String(item?.previousUsername ?? "").trim(),
      ...(Array.isArray(item?.replacementHistoryUsernames) ? item.replacementHistoryUsernames.map((value) => String(value ?? "").trim()) : [])
    ]).filter(Boolean)));
    const replacementPairs = [];
    const indicesByCategory = new Map();
    for (const resultIndex of replaceableIndices) {
      const categoryId = getCommunityResultStockType(order, results[resultIndex]);
      indicesByCategory.set(categoryId, [...(indicesByCategory.get(categoryId) ?? []), resultIndex]);
    }
    for (const [categoryId, categoryIndices] of indicesByCategory) {
      const replacements = await client.query(
        `SELECT discord_user_id, username, avatar_url, encrypted_account_token, encrypted_access_token, encrypted_refresh_token, access_token_expires_at, stock_type AS category_id
         FROM community_oauth_joins
         WHERE guild_id = $1
           AND stock_type = $4
           AND status = 'authorized'
           AND reserved_order_id IS NULL
           AND (($6::boolean = TRUE AND encrypted_account_token IS NOT NULL)
             OR ($6::boolean = FALSE AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()))
           AND NOT (discord_user_id = ANY($2::text[]))
           AND NOT (username = ANY($3::text[]))
         ORDER BY random()
         LIMIT $5
         FOR UPDATE SKIP LOCKED`,
        [targetGuildId, usedUserIds, usedUsernames, categoryId, categoryIndices.length, communityJoinMethodUsesAccountToken(getCommunityOrderJoinMethod(order))]
      );
      replacements.rows.forEach((member, index) => replacementPairs.push({ member, resultIndex: categoryIndices[index] }));
    }
    if (!replacementPairs.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "No connected replacement member is currently available." });
    }
    await client.query(
      "UPDATE community_oauth_joins SET reserved_order_id = $3 WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])",
      [targetGuildId, replacementPairs.map(({ member }) => member.discord_user_id), uniqid]
    );

    const queuedReplacementIndices = replacementPairs.map((pair) => pair.resultIndex);
    const failedUserIds = queuedReplacementIndices
      .map((index) => String(results[index]?.discordUserId ?? ""))
      .filter(isDiscordGuildId);
    if (failedUserIds.length) {
      await client.query(
        "UPDATE community_oauth_joins SET reserved_order_id = NULL WHERE guild_id = $1 AND discord_user_id = ANY($2::text[])",
        [targetGuildId, failedUserIds]
      );
    }

    replacementPairs.forEach(({ member, resultIndex }) => {
      const previous = results[resultIndex];
      const previousUserId = String(previous?.discordUserId ?? "").trim();
      results[resultIndex] = resetCommunityResultVerification(previous, {
        discordUserId: member.discord_user_id,
        username: member.username,
        avatarUrl: member.avatar_url ?? null,
        state: "queued",
        details: "Waiting for replacement delivery.",
        replacementAttempt: (Number(previous?.replacementAttempt) || 0) + 1,
        previousUsername: previous?.username,
        replacementHistoryUserIds: Array.from(new Set([
          ...(Array.isArray(previous?.replacementHistoryUserIds) ? previous.replacementHistoryUserIds : []),
          ...(isDiscordGuildId(previousUserId) ? [previousUserId] : [])
        ])),
        replacementHistoryUsernames: Array.from(new Set([
          ...(Array.isArray(previous?.replacementHistoryUsernames) ? previous.replacementHistoryUsernames : []),
          previous?.previousUsername,
          previous?.username
        ].map((value) => String(value ?? "").trim()).filter(Boolean)))
      });
    });

    const activeOrder = {
      ...order,
      status: "PROCESS",
      waitingCode: null,
      activeDelay: null,
      nextMemberAt: null,
      details: `${Number(order.added ?? 0)}/${order.amount} members delivered. ${replacementPairs.length}/${replaceableIndices.length} available replacements are in progress.`,
      replacementBatch: {
        requested: replaceableIndices.length,
        queued: replacementPairs.length,
        startedAt: new Date().toISOString()
      },
      communityResults: results
    };
    await client.query(
      "UPDATE tracked_orders SET payload = $2::jsonb, updated_at = NOW() WHERE uniqid = $1",
      [uniqid, JSON.stringify(activeOrder)]
    );
    await client.query("COMMIT");
    if (!isAdminRequest) publicCommunityReplaceCooldowns.set(publicCooldownKey, Date.now() + publicCommunityReplaceCooldownMs);

    void processCommunityOrder(activeOrder, replacementPairs.map((pair) => pair.member), config).catch(async (error) => {
      console.error("Members bulk replacement failed:", error instanceof Error ? error.message : error);
      await saveTrackedOrderPayload({
        ...activeOrder,
        status: "ERROR",
        details: error instanceof Error ? error.message : "Members bulk replacement failed."
      }).catch(() => {});
    });
    res.set("Cache-Control", "no-store").json(isAdminRequest ? activeOrder : sanitizePublicCommunityOrder(activeOrder));
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

    const baseConfig = await getCommunityOAuthConfig();

    await client.query("BEGIN");
    const tracked = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 FOR UPDATE", [uniqid]);
    let order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community" || !Array.isArray(order.communityResults)) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Members order could not be found." });
    }
    order = await hydrateCommunityOrderCategories(order);
    if (!isAdminRequest && isCommunityOrderManagementExpired(order)) {
      await client.query("ROLLBACK");
      return res.status(410).json({ message: "This order's member support period has expired." });
    }
    const targetGuildId = String(order.serverId ?? "").trim();
    const config = normalizeCommunityOAuthConfig({ ...baseConfig, guildId: targetGuildId });
    const joinMethod = getCommunityOrderJoinMethod(order);
    if (!config.configured) {
      await client.query("ROLLBACK");
      return res.status(503).json({ message: "Configure the Members integration before replacing a member." });
    }
    await copyCommunityStockForGuild(client, baseConfig.guildId, targetGuildId);
    if (joinMethod !== "directly") {
      const botAccess = await checkCommunityBotGuildAccess(config, targetGuildId);
      if (!botAccess.accessible) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "To replace this member, please add the bot to the order's Discord server.",
          botInvite: createCommunityBotInvite(config, targetGuildId, joinMethod)
        });
      }
    }
    if (joinMethod === "experimental_join") {
      try {
        await ensureCommunityApplyToJoin(config, targetGuildId);
        if (order.serverInviteCreatedByBot !== true) {
          order = {
            ...order,
            serverInvite: await createCommunityExperimentalServerInvite(config, targetGuildId),
            serverInviteCreatedByBot: true
          };
        }
      } catch (error) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: error instanceof Error ? error.message : "Experimental Join could not prepare Apply to Join.",
          botInvite: createCommunityBotInvite(config, targetGuildId, "experimental_join")
        });
      }
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
    if (!isAdminRequest && isCommunityResultManagementExpired(order, failedResult)) {
      await client.query("ROLLBACK");
      return res.status(410).json({ message: "This category's member support period has expired." });
    }
    const replaceableStates = new Set(["failed", "blocked", "already_member"]);
    const memberWasRemoved = String(failedResult?.membershipStatus ?? "").toLowerCase() === "removed";
    const notLiveWithPeriodicSupport = isCommunityOnlinerReplacementEligible(order, failedResult);
    if (!failedResult || typeof failedResult !== "object" || Array.isArray(failedResult) || memberWasRemoved || (!replaceableStates.has(String(failedResult.state ?? "").toLowerCase()) && !notLiveWithPeriodicSupport)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: memberWasRemoved
        ? "Members who have left the server cannot be replaced."
        : "Only failed, already-member, or recently checked non-Live Onliner members can be replaced." });
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

    const failedState = String(failedResult?.authorizationStatus ?? "").toLowerCase() === "inactive";
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
    const previouslyDeliveredUserIds = await loadCommunityUnavailableUserIds(client, config.guildId);
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
      `SELECT discord_user_id, username, avatar_url, encrypted_account_token, encrypted_access_token, encrypted_refresh_token, access_token_expires_at
       FROM community_oauth_joins
       WHERE guild_id = $1
         AND stock_type = $4
         AND status = 'authorized'
         AND reserved_order_id IS NULL
         AND (($5::boolean = TRUE AND encrypted_account_token IS NOT NULL)
           OR ($5::boolean = FALSE AND encrypted_access_token IS NOT NULL AND access_token_expires_at > NOW()))
         AND NOT (discord_user_id = ANY($2::text[]))
         AND NOT (username = ANY($3::text[]))
       ORDER BY random()
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [config.guildId, usedUserIds, usedUsernames, getCommunityResultStockType(order, failedResult), communityJoinMethodUsesAccountToken(getCommunityOrderJoinMethod(order))]
    );
    if (!replacement.rowCount) {
      await client.query("COMMIT");
      return res.status(409).json({ message: "No connected replacement member is currently available. The original member remains active unless Discord reported Unknown User." });
    }

    const member = replacement.rows[0];
    await client.query(
      "UPDATE community_oauth_joins SET reserved_order_id = $3 WHERE guild_id = $1 AND discord_user_id = $2",
      [config.guildId, member.discord_user_id, uniqid]
    );
    results[resultIndex] = resetCommunityResultVerification(failedResult, {
      discordUserId: member.discord_user_id,
      username: member.username,
      avatarUrl: member.avatar_url ?? null,
      state: "replacing",
      details: "Replacement member delivery is running.",
      replacementAttempt: (Number(failedResult.replacementAttempt) || 0) + 1,
      previousUsername: failedResult.username,
      replacementHistoryUserIds,
      replacementHistoryUsernames
    });
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

    void processCommunityReplacement(uniqid, resultIndex, member, config, getCommunityOrderJoinMethod(order), order.serverInvite).catch(async (error) => {
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
      livePayload = await hydrateCommunityOrderCategories(livePayload);
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

    const hydratedPayload = await hydrateCommunityOrderCategories(tracked.rows[0].payload);
    const snapshot = {
      ...sanitizePublicCommunityOrder(hydratedPayload),
      canManageCommunityMembers: !isCommunityOrderManagementExpired(hydratedPayload)
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
      trackedPayload = await hydrateCommunityOrderCategories(trackedPayload);
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

    return res.status(404).set("Cache-Control", "no-store").json({ message: "Order could not be found." });
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
    let order = tracked.rows[0]?.payload;
    if (!order || order.provider !== "community") return res.status(404).json({ message: "Members order could not be found." });
    order = await hydrateCommunityOrderCategories(order);
    if (isCommunityOrderManagementExpired(order)) {
      return res.status(410).json({ message: "This order's member support period has expired." });
    }
    publicCommunityCheckCooldowns.set(cooldownKey, Date.now() + publicCommunityCheckCooldownMs);
    const result = await runCommunityOrderMemberCheck(order);
    res.set("Cache-Control", "no-store").json({ order: sanitizePublicCommunityOrder(result.order), summary: result.summary });
  } catch (error) {
    next(error);
  }
});

app.get("/api/public/orders/:uniqid/check-members/progress", (req, res) => {
  const uniqid = String(req.params.uniqid ?? "").trim();
  res.set("Cache-Control", "no-store").json(communityOrderMemberCheckProgress.get(uniqid) ?? {
    active: false,
    total: 0,
    checked: 0,
    stage: "idle"
  });
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

    return res.status(404).json({ message: "Members order could not be found." });
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

app.get("/api/admin/config", requireSession, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT 1 FROM app_settings WHERE setting_key = 'dcord_api_key' LIMIT 1");
    res.json({
      dcordConfigured: result.rowCount > 0,
      boostStock: summarizeBoostTokenStock(await loadBoostTokenStock())
    });
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

app.post("/api/discord/user/leave-guild", requireSession, async (req, res, next) => {
  try {
    const accountToken = String(req.body?.accountToken ?? "").trim();
    const guildId = String(req.body?.guildId ?? "").trim();
    if (accountToken.length < 20 || accountToken.length > 4096 || /\s/.test(accountToken)) {
      return res.status(400).json({ message: "A valid Discord user token is required." });
    }
    if (!isDiscordGuildId(guildId)) {
      return res.status(400).json({ message: "A valid Discord guild ID is required." });
    }

    const identity = await requestDiscord("users/@me", {
      cache: "no-store",
      headers: { Authorization: accountToken }
    });
    if (!identity.response.ok) {
      return res.status(identity.response.status === 429 ? 429 : 401).json({
        message: identity.response.status === 429
          ? "Discord rate limited this account. Wait a moment and try again."
          : "Discord rejected the user token."
      });
    }

    const leave = await requestDiscord(`users/@me/guilds/${encodeURIComponent(guildId)}`, {
      method: "DELETE",
      cache: "no-store",
      headers: { Authorization: accountToken }
    });
    if (!leave.response.ok) {
      const discordMessage = typeof leave.payload?.message === "string" ? leave.payload.message.trim() : "";
      const message = leave.response.status === 404
        ? "This account is not in that server, or the guild ID is incorrect."
        : leave.response.status === 429
          ? "Discord rate limited this account. Wait a moment and try again."
          : discordMessage || "Discord did not allow this account to leave the server.";
      return res.status(leave.response.status >= 400 && leave.response.status < 500 ? leave.response.status : 502).json({ message });
    }

    const username = typeof identity.payload?.username === "string"
      ? `${identity.payload.username}${identity.payload.discriminator && identity.payload.discriminator !== "0" ? `#${identity.payload.discriminator}` : ""}`
      : null;
    return res.json({ left: true, guildId, username });
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
    const requestedConcurrency = normalizeDcordBoostConcurrency(req.body?.concurrency);
    const allowMembershipScreening = req.body?.allowMembershipScreening === true;
    const humanizerPackageId = String(req.body?.humanizerPackageId ?? "").trim();

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
    const recommendedConcurrency = Math.min(4, Math.max(1, Math.ceil(requiredTokens / 2)));
    const concurrency = Math.min(requestedConcurrency, recommendedConcurrency);
    if (stock[stockKey].length < requiredTokens) {
      return res.status(409).json({ message: `Only ${stock[stockKey].length * 2} ${duration} month boosts are in stock.` });
    }

    let humanizerPackage = null;
    if (humanizerPackageId) {
      const packageResult = await pool.query(
        "SELECT id, name, payload, created_at, updated_at FROM humanizer_packages WHERE id = $1 LIMIT 1",
        [humanizerPackageId]
      );
      humanizerPackage = packageResult.rows[0] ?? null;
      if (!humanizerPackage) return res.status(400).json({ message: "The selected Humanizer package could not be found." });
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
      isEldoradoSale: req.body?.isEldoradoSale !== false,
      humanizerPackageId: humanizerPackage?.id ?? null,
      humanizerPackageName: humanizerPackage?.name ?? null,
      humanizerStatus: humanizerPackage ? "queued" : null,
      tokenCount: requiredTokens,
      createdAt: new Date().toISOString(),
      status: humanizerPackage ? "HUMANIZING" : "PROCESS",
      details: humanizerPackage ? `Humanizing ${requiredTokens} assigned boost token${requiredTokens === 1 ? "" : "s"}.` : `0/${amount} boosts completed.`,
      dcordResults: selectedTokens.map(createQueuedDcordResult)
    };

    await saveDcordOrderTokens(uniqid, selectedTokens);
    if (useProxy) await saveDcordOrderProxies(uniqid, assignedProxies);
    await saveTrackedOrderPayload(order);
    void (async () => {
      let processingOrder = order;
      if (humanizerPackage) {
        try {
          const humanizerJob = await runDcordOrderHumanizer(uniqid, selectedTokens, assignedProxies, humanizerPackage);
          processingOrder = {
            ...order,
            status: "PROCESS",
            details: `Humanizer finished: ${humanizerJob.succeeded}/${humanizerJob.total} tokens updated. Starting boost delivery.`,
            humanizerStatus: humanizerJob.failed > 0 ? "partial" : "completed",
            humanizerJob
          };
        } catch (error) {
          processingOrder = {
            ...order,
            status: "PROCESS",
            details: "Humanizer could not finish. Continuing boost delivery with the assigned tokens.",
            humanizerStatus: "failed",
            humanizerError: error instanceof Error ? error.message : "Humanizer failed."
          };
        }
        await saveTrackedOrderPayload(processingOrder);
      }
      await processDcordBoostOrder(processingOrder, selectedTokens, invite);
    })().catch((error) => console.error(error));
    res.json({
      uniqid,
      stock: summarizeBoostTokenStock(nextStock)
    });
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

app.post("/api/dcord/boost-orders/:uniqid/humanize", requireSession, async (req, res, next) => {
  try {
    const uniqid = String(req.params.uniqid ?? "").trim();
    const packageId = String(req.body?.packageId ?? "").trim();
    if (!uniqid || uniqid.length > 160 || !packageId) {
      return res.status(400).json({ message: "A valid boost order and Humanizer package are required." });
    }

    const tracked = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
    const order = tracked.rows[0]?.payload;
    if (!order || typeof order !== "object" || Array.isArray(order) || (order.provider !== "dcord" && order.service !== "DCORD-BOOSTS")) {
      return res.status(404).json({ message: "Boost order could not be found." });
    }
    if (order.humanizerStatus === "running" || order.humanizerStatus === "queued") {
      return res.status(409).json({ message: "Humanizer is already running for this order." });
    }

    const packageResult = await pool.query(
      "SELECT id, name, payload, created_at, updated_at FROM humanizer_packages WHERE id = $1 LIMIT 1",
      [packageId]
    );
    const humanizerPackage = packageResult.rows[0];
    if (!humanizerPackage) return res.status(404).json({ message: "The selected Humanizer package could not be found." });

    const tokens = await loadDcordOrderTokens(uniqid);
    const proxies = await loadDcordOrderProxies(uniqid);
    if (!tokens.length) return res.status(409).json({ message: "This order has no assigned boost tokens." });
    if (proxies.length < tokens.length) {
      return res.status(409).json({ message: "One or more assigned order proxies are missing." });
    }
    const invalidAssignmentIndex = tokens.findIndex((token, index) =>
      !extractDcordApiToken(token) || !normalizeDiscordOnlinerProxyUrl(proxies[index])
    );
    if (invalidAssignmentIndex >= 0) {
      return res.status(409).json({ message: `Token ${invalidAssignmentIndex + 1} has an invalid token or assigned proxy.` });
    }

    const jobId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const runningOrder = {
      ...order,
      humanizerPackageId: humanizerPackage.id,
      humanizerPackageName: humanizerPackage.name,
      humanizerStatus: "running",
      humanizerJobId: jobId,
      humanizerStartedAt: startedAt,
      humanizerCompletedAt: null,
      humanizerError: null
    };
    await saveTrackedOrderPayload(runningOrder);

    const persistHumanizerProgress = async (snapshot) => {
      await pool.query(
        `UPDATE tracked_orders
         SET payload = jsonb_set(payload, '{humanizerJob}', $2::jsonb, true), updated_at = NOW()
         WHERE uniqid = $1
           AND COALESCE((payload->'humanizerJob'->>'completed')::int, -1) <= $3`,
        [uniqid, JSON.stringify(snapshot), snapshot.completed]
      );
    };
    void runDcordOrderHumanizer(uniqid, tokens, proxies, humanizerPackage, jobId, persistHumanizerProgress)
      .then(async (humanizerJob) => {
        const latest = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]);
        const latestOrder = latest.rows[0]?.payload ?? runningOrder;
        await saveTrackedOrderPayload({
          ...latestOrder,
          humanizerStatus: humanizerJob.failed > 0 ? "partial" : "completed",
          humanizerCompletedAt: new Date().toISOString(),
          humanizerJob
        });
      })
      .catch(async (error) => {
        const latest = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1 LIMIT 1", [uniqid]).catch(() => ({ rows: [] }));
        const latestOrder = latest.rows[0]?.payload ?? runningOrder;
        await saveTrackedOrderPayload({
          ...latestOrder,
          humanizerStatus: "failed",
          humanizerCompletedAt: new Date().toISOString(),
          humanizerError: error instanceof Error ? error.message : "Humanizer failed."
        }).catch(() => {});
      });

    res.status(202).set("Cache-Control", "no-store").json({
      order: await revealDcordOrderTokens(runningOrder),
      job: getHumanizerJobSnapshot(humanizerJobs.get(jobId))
    });
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

app.get("/api/orders", requireSession, async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT payload FROM tracked_orders WHERE payload->>'provider' IN ('community', 'dcord') ORDER BY created_at DESC");
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
      await client.query("DELETE FROM community_reaction_jobs WHERE order_id = $1", [uniqid]);
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
  if (!orders || orders.some((order) =>
    !order ||
    typeof order.uniqid !== "string" ||
    !order.uniqid.trim() ||
    !["community", "dcord"].includes(order.provider)
  )) {
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

if (serviceRunsWeb) await initializeDatabase();
else await initializeDiscordOnlinerDatabase();
if (serviceRunsOnliner) {
  await tryStartDiscordOnlinerWorker();
}
if (serviceRunsWeb) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Pulcip Members web service listening on port ${port} (role: ${serviceRole}).`);
  });
  const communityRecoveryTimer = setInterval(() => {
    void recoverInterruptedCommunityOrders().catch((error) => {
      console.error("Members recovery scan failed:", error instanceof Error ? error.message : error);
    });
  }, 10_000);
  communityRecoveryTimer.unref();

  const runCommunityReactionJobs = () => void processCommunityReactionJobs().catch((error) => {
    console.error("Members reaction scan failed:", error instanceof Error ? error.message : error);
  });
  const communityReactionTimer = setInterval(runCommunityReactionJobs, discordOnlinerWorkerPollMs);
  communityReactionTimer.unref();
  const communityReactionInitialTimer = setTimeout(runCommunityReactionJobs, 1_000);
  communityReactionInitialTimer.unref();

  const refreshCommunityOAuthTokens = async () => {
    try {
      const config = await getCommunityOAuthConfig();
      if (config.configured) await refreshCommunityOAuthTokensDue(config);
    } catch (error) {
      console.error("Members OAuth refresh scan failed:", error instanceof Error ? error.message : error);
    }
  };
  const communityOAuthRefreshTimer = setInterval(() => void refreshCommunityOAuthTokens(), communityOAuthRefreshIntervalMs);
  communityOAuthRefreshTimer.unref();
  const communityOAuthInitialRefreshTimer = setTimeout(() => void refreshCommunityOAuthTokens(), 10_000);
  communityOAuthInitialRefreshTimer.unref();
}

if (serviceRunsOnliner) {
  let shuttingDownOnlinerWorker = false;
  const shutdownOnlinerWorker = () => {
    if (shuttingDownOnlinerWorker) return;
    shuttingDownOnlinerWorker = true;
    void stopDiscordOnlinerWorker().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdownOnlinerWorker);
  process.once("SIGINT", shutdownOnlinerWorker);
}
