import crypto from "node:crypto";

const fail = (message, statusCode = 400, uncertain = false) => Object.assign(new Error(message), { statusCode, uncertain, expose: true });
export const solarixSignature = (secret, timestamp, body = "") => crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export function normalizeSolarixCredentials(value) {
  const slug = typeof value?.slug === "string" ? value.slug.trim() : "";
  const secret = typeof value?.secret === "string" ? value.secret.trim() : "";
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(slug) || !secret || secret.length > 2000 || /[\r\n]/.test(secret)) throw fail("Enter a valid SolarixAIO slug and secret.");
  return { slug, secret };
}

export function normalizeSolarixDelivery(value) {
  const match = String(value?.invite ?? "").trim().match(/^(?:https?:\/\/)?(?:(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/))?([a-zA-Z0-9_-]{2,100})\/?(?:[?#].*)?$/);
  if (!match) throw fail("Enter a valid Discord invite.");
  if (!Number.isInteger(value?.amount) || value.amount < 2 || value.amount > 1000 || value.amount % 2) throw fail("Choose an even boost amount from 2 to 1000.");
  if (!["1m", "3m"].includes(value?.duration)) throw fail("Choose 1 month or 3 months.");
  return { invite: match[1], amount: value.amount, duration: value.duration };
}

// POST amount is boosts; the signed result counters are accounts (two boosts
// each). Keep that conversion at this boundary, with a marker for saved receipts.
export function normalizeSolarixResult(value, input) {
  if (typeof value?.orderId !== "string" || !value.orderId || value.orderId.length > 200 || !Number.isSafeInteger(value.boosted) || value.boosted < 0 || value.boosted > input.amount / 2 || !Number.isSafeInteger(value.failed) || value.failed < 0 || value.failed > Math.floor(Number.MAX_SAFE_INTEGER / 2) || !/^\d{17,22}$/.test(String(value.guildId ?? ""))) throw fail("SolarixAIO returned an incomplete result. Check its panel before placing another order.", 502, true);
  return { orderId: value.orderId, guildId: String(value.guildId), guildName: String(value.guildName ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 100), boosted: value.boosted * 2, failed: value.failed * 2, successfulAccounts: value.boosted, failedAccounts: value.failed, countUnit: "boosts" };
}

export function createSolarixClient({ credentials, fetch: transport = globalThis.fetch, now = Date.now }) {
  const { slug, secret } = normalizeSolarixCredentials(credentials);
  async function request(suffix, payload) {
    const submitting = payload !== undefined;
    const body = submitting ? JSON.stringify(payload) : "";
    const timestamp = String(Math.floor(now() / 1000));
    let response, raw;
    try {
      response = await transport(`https://api.solarixaio.com/tools/public/boost-bot/orders/${encodeURIComponent(slug)}${suffix}`, {
        method: submitting ? "POST" : "GET", redirect: "error",
        headers: { Accept: "application/json", "X-Timestamp": timestamp, "X-Signature": solarixSignature(secret, timestamp, body), ...(submitting ? { "Content-Type": "application/json" } : {}) },
        ...(submitting ? { body } : {}), signal: AbortSignal.timeout(submitting ? 180000 : 15000)
      });
      raw = await response.text();
    } catch { throw fail(submitting ? "SolarixAIO did not confirm the result. Check its panel before placing another order." : "SolarixAIO stock could not be reached.", 502, submitting); }
    if (!response.ok) {
      const messages = { 400: "SolarixAIO rejected the invite, amount or available stock.", 401: "SolarixAIO rejected the slug or secret.", 403: "The SolarixAIO Boost Bot license is inactive.", 404: "The SolarixAIO integration is disabled or the slug is incorrect.", 429: "SolarixAIO rate limited this request. Wait before trying again." };
      throw fail(messages[response.status] || "SolarixAIO did not confirm the result. Check its panel before placing another order.", response.status >= 500 ? 502 : response.status, submitting && ![400, 401, 403, 404, 429].includes(response.status));
    }
    const signedAt = response.headers.get("X-Timestamp") || "";
    const signature = response.headers.get("X-Signature") || "";
    const expected = solarixSignature(secret, signedAt, raw);
    if (!/^\d{10,12}$/.test(signedAt) || Math.abs(now() / 1000 - Number(signedAt)) > 300 || !/^[a-f0-9]{64}$/i.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) throw fail("SolarixAIO returned a response that could not be verified.", 502, submitting);
    try { return JSON.parse(raw); } catch { throw fail("SolarixAIO returned an unreadable response.", 502, submitting); }
  }
  async function stock() {
    const payload = await request("/stock");
    if (!Array.isArray(payload?.tiers)) throw fail("SolarixAIO returned invalid stock counts.", 502);
    const tiers = ["1m", "3m"].flatMap(duration => {
      const matches = payload.tiers.filter(item => item?.duration === duration);
      if (!matches.length) return [];
      const row = matches[0];
      if (matches.length > 1 || !Number.isSafeInteger(row.tokens) || row.tokens < 0 || !Number.isSafeInteger(row.boosts) || row.boosts !== row.tokens * 2) throw fail("SolarixAIO returned invalid stock counts.", 502);
      return { duration, label: duration === "1m" ? "1 Month" : "3 Months", tokens: row.tokens, boosts: row.boosts };
    });
    if (!tiers.length) throw fail("SolarixAIO returned no supported stock tiers.", 502);
    return { tiers, checkedAt: new Date(now()).toISOString() };
  }
  async function submit(delivery, requestId) {
    const input = normalizeSolarixDelivery(delivery);
    const value = await request("", { ...input, order_ref: requestId });
    if (value?.orderRef !== requestId) throw fail("SolarixAIO returned an incomplete result. Check its panel before placing another order.", 502, true);
    return normalizeSolarixResult(value, input);
  }
  return { stock, submit };
}

// Receipts are separate from tracked orders. An atomic claim prevents repeat
// submissions across HTTP retries and web processes; restarts never resubmit.
export function createSolarixService({ load, save, claim, remove, fetch: transport, now = Date.now }) {
  const configKey = "solarix_aio_config";
  const receiptKey = id => `solarix_aio_delivery_${id}`;
  const validId = id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const executions = new Map();
  let cachedStock = null;
  async function credentials() {
    const raw = await load(configKey);
    if (!raw) throw fail("Configure SolarixAIO in Settings → Connections.", 503);
    return normalizeSolarixCredentials(JSON.parse(raw));
  }
  const client = config => createSolarixClient({ credentials: config, fetch: transport, now });
  async function config() {
    const raw = await load(configKey);
    const value = raw ? normalizeSolarixCredentials(JSON.parse(raw)) : null;
    return { configured: Boolean(value), slug: value?.slug || "", secretSuffix: value?.secret.slice(-4) || "" };
  }
  async function saveConfig(value) {
    const next = normalizeSolarixCredentials(value);
    await client(next).stock();
    await save(configKey, JSON.stringify(next)); cachedStock = null;
    return config();
  }
  async function clearConfig() { await remove(configKey); cachedStock = null; }
  async function stock() {
    const config = await credentials();
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex");
    if (cachedStock?.fingerprint === fingerprint && now() - cachedStock.time < 15000) return cachedStock.value;
    const value = await client(config).stock();
    cachedStock = { fingerprint, value, time: now() };
    return value;
  }
  async function read(id) {
    if (!validId(id)) throw fail("Invalid SolarixAIO receipt.");
    const raw = await load(receiptKey(id));
    if (!raw) throw fail("This SolarixAIO request has not been found. Check its panel before placing another order.", 404);
    const value = JSON.parse(raw);
    if (value.status === "completed" && value.result && value.result.countUnit !== "boosts") {
      try { return { ...value, result: normalizeSolarixResult(value.result, value.input) }; }
      catch { return { ...value, status: "uncertain", result: undefined, message: "The saved SolarixAIO result counts could not be verified. Check its panel before placing another order." }; }
    }
    if (value.status === "running" && now() - Date.parse(value.startedAt) > 240000) return { ...value, status: "uncertain", message: "The SolarixAIO result was interrupted. Check its panel before placing another order." };
    return value;
  }
  async function start(value) {
    if (!validId(value?.requestId)) throw fail("A valid submission ID is required.");
    const input = normalizeSolarixDelivery(value);
    const key = receiptKey(value.requestId);
    const previous = await load(key);
    if (previous) {
      const saved = JSON.parse(previous);
      if (JSON.stringify(saved.input) !== JSON.stringify(input)) throw fail("This submission ID already belongs to another request.", 409);
      return read(value.requestId);
    }
    const config = await credentials();
    const receipt = { id: value.requestId, input, status: "running", startedAt: new Date(now()).toISOString(), message: "Waiting for SolarixAIO to return the delivery result." };
    if (!await claim(key, JSON.stringify(receipt))) return start(value);
    const work = (async () => {
      let result;
      try { result = { ...receipt, status: "completed", result: await client(config).submit(input, receipt.id), message: "SolarixAIO returned the delivery result." }; }
      catch (error) { result = { ...receipt, status: error?.uncertain ? "uncertain" : "failed", message: error?.expose ? error.message : "The SolarixAIO result could not be saved. Check its panel before placing another order." }; }
      result.finishedAt = new Date(now()).toISOString();
      cachedStock = null;
      await save(key, JSON.stringify(result));
    })();
    executions.set(receipt.id, work);
    void work.catch(() => {}).finally(() => executions.delete(receipt.id));
    return receipt;
  }
  return { config, saveConfig, clearConfig, stock, start, read, executions };
}

export function registerSolarixRoutes(app, { requireSession, service }) {
  const endpoint = "/api/solarix-aio";
  const route = fn => async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    try { await fn(req, res); } catch (error) { next(error); }
  };
  app.get(`${endpoint}/config`, requireSession, route(async (_req, res) => res.json(await service.config())));
  app.put(`${endpoint}/config`, requireSession, route(async (req, res) => res.json(await service.saveConfig(req.body))));
  app.delete(`${endpoint}/config`, requireSession, route(async (_req, res) => { await service.clearConfig(); res.status(204).end(); }));
  app.get(`${endpoint}/stock`, requireSession, route(async (_req, res) => res.json(await service.stock())));
  app.post(`${endpoint}/deliveries`, requireSession, route(async (req, res) => res.status(202).json(await service.start(req.body))));
  app.get(`${endpoint}/deliveries/:id`, requireSession, route(async (req, res) => res.json(await service.read(req.params.id))));
}
