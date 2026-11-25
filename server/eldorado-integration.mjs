import crypto from "node:crypto";
import { ensureEldoradoIntegrationSettings, readEldoradoIntegrationSettings, integrationKeyMatches } from "./eldorado-integration-settings.mjs";

const prefix = "/api/integrations/eldorado";
export async function ensureEldoradoIntegrationStorage(pool) {
  await ensureEldoradoIntegrationSettings(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS eldorado_integration_orders (external_id TEXT PRIMARY KEY, uniqid TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, amount INTEGER NOT NULL, request_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'creating', error TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}

export function buildEldoradoDeliveryMessage(order, publicBase) {
  const url = new URL(`/monitor/${encodeURIComponent(order.uniqid)}`, publicBase);
  url.searchParams.set("eldorado", "1");
  if (order.provider === "dcord") return [`✅ Your ${order.amount} boosts (${order.duration} month${Number(order.duration) > 1 ? "s" : ""}) have been delivered.`, "", "📊 Order Monitor:", url.toString()].join("\n");
  const experimental = order.joinMethod === "experimental_join";
  const permission = experimental ? "Manage Server, Kick Members, and Create Invite." : "Create Invite.";
  const instructions = order.botInvite ? ["Please add the Members bot to your Discord server so we can begin delivery.", "", `🔑 Required bot permissions: ${permission}`, "", experimental ? "These permissions are mandatory for Experimental Join and must remain enabled until delivery is complete." : "The bot uses Create Invite for this order. You can remove the bot after delivery is complete.", "", "🤖 Add Bot:", order.botInvite, ""] : order.joinMethod === "directly" ? [] : ["✅ The Members bot has already been added to your Discord server.", "", `🔑 Required bot permissions: ${permission}`, "Please keep the bot in the server until delivery is complete.", ""];
  const reactions = Number(order.reactionDailyLimit) > 0 ? ["", "✨ MESSAGE REACTIONS", `Daily limit: ${Number(order.reactionDailyLimit).toLocaleString("en-US")} reactions.`, "Open Reactions on your order monitor and paste a Discord message link to send reactions.", "Available during your support period. Resets daily at 00:00.", "Reactions become available after member delivery."] : [];
  return [...instructions, "📊 Order Monitor:", url.toString(), "", "🛡️ CHECK MEMBERS & REPLACEMENT", "If you purchased Online Members, use Check Members during the guarantee period. Offline members can be replaced within the guarantee period.", ...reactions, "", `⚙️ Delivery Speed: ${order.speedProfile === "balanced" ? "Balanced (variable 30–300 second delay)" : `${order.delay} seconds (fully customizable)`}`, "You can change the join delay from the order monitor."].join("\n");
}

export function integrationRequestHash(body) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return crypto.createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex");
}
export function registerEldoradoIntegration(app, { pool, readSettings = () => readEldoradoIntegrationSettings(pool), validateInvite, createMembers, createBoosts, recoverBoost, getCatalog }) {
  const authenticate = async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const supplied = String(req.headers.authorization || "").replace(/^Bearer /, "");
    if (supplied.length < 32 || supplied.length > 512) return res.status(401).json({ message: "Integration authentication required." });
    try {
      const settings = await readSettings();
      if (!integrationKeyMatches(supplied, settings)) return res.status(401).json({ message: "Integration authentication required." });
      req.eldoradoIntegrationSettings = settings;
      next();
    } catch (error) { next(error); }
  };
  const serialize = async (record, publicBase) => {
    const stored = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1", [record.uniqid]);
    let order = stored.rows[0]?.payload;
    if (order?.provider === "dcord") order = await recoverBoost(order);
    const base = { externalId: record.external_id, kind: record.kind, amount: record.amount, uniqid: record.uniqid, added: Number(order?.added) || 0 };
    if (!order) return { ...base, status: "REVIEW", message: record.error || "Order creation is unconfirmed. Review this request before retrying; it will not be submitted twice.", deliveryMessage: "" };
    const matches = Number(order.amount) === record.amount && (record.kind === "boosts" ? order.provider === "dcord" : order.provider === "community");
    if (!matches) return { ...base, status: "REVIEW", message: "Stored order does not match the integration request.", deliveryMessage: "" };
    return { ...base, status: String(order.status || "PROCESS"), deliveryMessage: publicBase ? buildEldoradoDeliveryMessage(order, publicBase) : "", serverId: order.serverId };
  };
  app.get(`${prefix}/catalog`, authenticate, async (req, res, next) => { try { res.json({ ...(await getCatalog()), integration: "eldorado-v1", publicUrlConfigured: Boolean(req.eldoradoIntegrationSettings.public_base) }); } catch (error) { next(error); } });
  app.post(`${prefix}/validate`, authenticate, async (req, res, next) => {
    try { await validateInvite(req.body); res.json({ ok: true }); }
    catch (error) { if (error.code) return res.status(error.statusCode || 400).json({ code: error.code, message: error.message }); next(error); }
  });
  app.get(`${prefix}/orders/:externalId`, authenticate, async (req, res, next) => {
    try {
      const records = await pool.query("SELECT * FROM eldorado_integration_orders WHERE external_id = $1", [String(req.params.externalId)]);
      if (!records.rows.length) return res.status(404).json({ message: "Integration order not found." });
      res.json(await serialize(records.rows[0], req.eldoradoIntegrationSettings.public_base));
    } catch (error) { next(error); }
  });
  app.post(`${prefix}/orders`, authenticate, async (req, res, next) => {
    try {
      const { externalId, kind, invite, amount, settings = {} } = req.body || {};
      if (!/^[a-z0-9-]{8,100}$/i.test(String(externalId)) || !["members", "boosts"].includes(kind) || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000) return res.status(400).json({ message: "A valid external order, service and amount are required." });
      const publicBase = req.eldoradoIntegrationSettings.public_base;
      if (!publicBase) return res.status(503).json({ message: "Save the HTTPS public monitor URL in Settings → plcp-mng integration." });
      const hash = integrationRequestHash({ kind, invite, amount, settings });
      const existing = await pool.query("SELECT * FROM eldorado_integration_orders WHERE external_id = $1", [externalId]);
      if (existing.rows.length) {
        if (existing.rows[0].request_hash !== hash) return res.status(409).json({ message: "This Eldorado order already has a different request. Review the existing order." });
        return res.json(await serialize(existing.rows[0], publicBase));
      }
      await validateInvite({ kind, invite });
      const uniqid = crypto.randomUUID();
      const inserted = await pool.query("INSERT INTO eldorado_integration_orders (external_id, uniqid, kind, amount, request_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (external_id) DO NOTHING RETURNING *", [externalId, uniqid, kind, amount, hash]);
      if (!inserted.rows.length) {
        const concurrent = await pool.query("SELECT * FROM eldorado_integration_orders WHERE external_id=$1", [externalId]);
        if (concurrent.rows[0].request_hash !== hash) return res.status(409).json({ message: "Concurrent request differs from the existing order." });
        return res.json(await serialize(concurrent.rows[0], publicBase));
      }
      // The durable claim is written before stock reservation. A crash cannot
      // submit another paid order; the deterministic uniqid reconciles saves.
      const body = kind === "members" ? {
        id: invite, amount, service: settings.service, categoryId: settings.categoryId,
        delay: settings.delay, speedProfile: settings.speedProfile, joinMethod: settings.joinMethod,
        durationMonths: settings.durationMonths, reactionLimit: settings.reactionLimit, isEldoradoSale: true,
        autoReplace: settings.autoReplace,
      } : {
        id: invite, amount, duration: settings.duration, boostProvider: settings.boostProvider,
        boostStockPool: settings.boostStockPool, concurrency: settings.concurrency,
        removeTwoFactor: settings.removeTwoFactor, allowMembershipScreening: false, isEldoradoSale: true,
        autoReplace: settings.autoReplace,
      };
      let status = 200, responseBody, thrown;
      const response = { status(code) { status = code; return this; }, json(value) { responseBody = value; return this; } };
      await (kind === "members" ? createMembers : createBoosts)({ body, integrationOrderId: uniqid }, response, error => { thrown = error; });
      if (thrown || status >= 400 || !responseBody?.uniqid) {
        await pool.query("UPDATE eldorado_integration_orders SET state='review', error=$2 WHERE external_id=$1", [externalId, "Order creation needs review. Check stock and the saved order before resubmitting."]);
      } else await pool.query("UPDATE eldorado_integration_orders SET state='created' WHERE external_id=$1", [externalId]);
      res.json(await serialize(inserted.rows[0], publicBase));
    } catch (error) { if (error.code && error.statusCode) return res.status(error.statusCode).json({ code: error.code, message: error.message }); next(error); }
  });
}
