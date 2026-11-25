export const AUTO_REPLACE_DEFAULTS = Object.freeze({ members: 3, boosts: 3 });
export const AUTO_REPLACE_MAX_ROUNDS = 100;

// Whole-payload writers (checks, recovery, reactions) must not reset a budget
// claimed by another worker. Enforce monotonic rounds at the DB boundary.
export const AUTO_REPLACE_GUARD_SQL = `
CREATE OR REPLACE FUNCTION pulcip_order_auto_replace_guard_trigger()
RETURNS trigger LANGUAGE plpgsql AS $trigger$
DECLARE
  saved_rounds numeric := 0;
  incoming_rounds numeric := 0;
BEGIN
  IF OLD.payload ? 'autoReplace' THEN
    NEW.payload := jsonb_set(NEW.payload, '{autoReplace}', OLD.payload->'autoReplace');
  END IF;
  IF jsonb_typeof(OLD.payload->'autoReplaceRounds') = 'number' THEN
    saved_rounds := (OLD.payload->>'autoReplaceRounds')::numeric;
  END IF;
  IF jsonb_typeof(NEW.payload->'autoReplaceRounds') = 'number' THEN
    incoming_rounds := (NEW.payload->>'autoReplaceRounds')::numeric;
  END IF;
  IF saved_rounds > incoming_rounds THEN
    NEW.payload := NEW.payload || jsonb_build_object('autoReplaceRounds', saved_rounds);
    IF OLD.payload ? 'autoReplaceLastAttemptAt' THEN
      NEW.payload := jsonb_set(NEW.payload, '{autoReplaceLastAttemptAt}', OLD.payload->'autoReplaceLastAttemptAt');
    END IF;
  END IF;
  IF OLD.payload->>'autoReplaceStopped' = 'replacement_unavailable' THEN
    NEW.payload := jsonb_set(NEW.payload, '{autoReplaceStopped}', OLD.payload->'autoReplaceStopped');
  END IF;
  RETURN NEW;
END;
$trigger$;
DO $install$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'tracked_orders'::regclass AND tgname = 'pulcip_order_auto_replace_guard') THEN
    CREATE TRIGGER pulcip_order_auto_replace_guard BEFORE UPDATE OF payload ON tracked_orders
      FOR EACH ROW EXECUTE FUNCTION pulcip_order_auto_replace_guard_trigger();
  END IF;
END;
$install$;
`;

export function validateAutoReplaceSettings(value) {
  if (!value || !["members", "boosts"].every(key => Number.isInteger(value[key]) && value[key] >= 0 && value[key] <= AUTO_REPLACE_MAX_ROUNDS)) {
    throw Object.assign(new Error(`Auto-replace limits must be whole numbers from 0 to ${AUTO_REPLACE_MAX_ROUNDS}.`), { statusCode: 400 });
  }
  return { members: value.members, boosts: value.boosts };
}

export function registerAutoReplaceSettings(app, { requireSession, load, save }) {
  const read = async () => {
    const stored = await load("order_auto_replace");
    return stored ? validateAutoReplaceSettings(JSON.parse(stored)) : { ...AUTO_REPLACE_DEFAULTS };
  };
  app.get("/api/settings/auto-replace", requireSession, async (_req, res, next) => {
    try { res.set("Cache-Control", "no-store").json(await read()); } catch (error) { next(error); }
  });
  app.put("/api/settings/auto-replace", requireSession, async (req, res, next) => {
    try {
      const settings = validateAutoReplaceSettings(req.body);
      await save("order_auto_replace", JSON.stringify(settings));
      res.set("Cache-Control", "no-store").json(settings);
    } catch (error) { next(error); }
  });
  return read;
}

// The same lock serializes automatic rounds and manual Boost replacements
// across web processes. Session locks are released even when a request fails.
export async function withOrderReplacementLock(pool, orderId, work) {
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query("SELECT pg_try_advisory_lock(hashtext('order-auto-replace'), hashtext($1)) AS locked", [orderId]);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw Object.assign(new Error("Another replacement is already being prepared for this order."), { statusCode: 409 });
    return await work();
  } finally {
    // Destroy the pooled connection if unlock fails; never return a held lock.
    let releaseError;
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(hashtext('order-auto-replace'), hashtext($1))", [orderId]); }
      catch (error) { releaseError = error; }
    }
    client.release(releaseError);
  }
}

export function getAutoReplaceIndices(order, { memberEligible, boostCount, boostPending }) {
  if (order?.autoReplace !== true || (order.autoReplaceStopped && order.autoReplaceStopped !== "limit_reached") || !["PARTIAL", "ERROR"].includes(String(order.status).toUpperCase()) || order.deliveryPaused === true) return [];
  if (order.provider === "community") {
    const results = order.communityResults ?? [];
    if (results.some(item => ["queued", "joining", "replacing", "pending_join", "pending", "running", "processing"].includes(String(item?.state).toLowerCase()))) return [];
    return results.flatMap((item, index) => ["failed", "blocked", "already_member"].includes(String(item?.state).toLowerCase()) && memberEligible(order, item) ? [index] : []);
  }
  if (order.provider !== "dcord") return [];
  const results = order.dcordResults ?? [];
  if (results.some(boostPending)) return [];
  return results.flatMap((item, index) => item && item.boosted !== true && boostCount(item) === 0
    && !item.serverBlocked && !item.providerBlocked && !item.returnedToStock
    && (["error", "failed", "join_failed", "boost_failed", "locked", "invalid", "insufficient_duration"].includes(String(item.status).toLowerCase())
      || (String(item.status).toLowerCase() === "joined" && String(item.boostStatus).toLowerCase() === "failed")) ? [index] : []);
}

export function createAutoReplaceRunner({ pool, readSettings, memberEligible, boostCount, boostPending, boostBusy = () => false, replaceMembers, replaceBoosts, onError = console.error }) {
  let scanning = false;
  const eligibility = { memberEligible, boostCount, boostPending };
  return async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      const settings = await readSettings();
      const candidates = await pool.query(`SELECT uniqid FROM tracked_orders
        WHERE payload->>'autoReplace' = 'true'
          AND payload->>'status' IN ('PARTIAL', 'ERROR')
          AND COALESCE(payload->>'autoReplaceStopped', '') IN ('', 'limit_reached')
          AND payload->>'provider' IN ('community', 'dcord')`);
      for (const { uniqid } of candidates.rows) {
        try {
          await withOrderReplacementLock(pool, uniqid, async () => {
            // Re-read under the lock: another process or a manual action may
            // have queued work since the scan. Claim budget before reserving.
            const stored = await pool.query("SELECT payload FROM tracked_orders WHERE uniqid = $1", [uniqid]);
            const order = stored.rows[0]?.payload;
            if (order?.provider === "dcord" && boostBusy(order)) return;
            const indices = getAutoReplaceIndices(order, eligibility);
            if (!indices.length) {
              const pending = order?.provider === "community"
                ? order.communityResults?.some(item => ["queued", "joining", "replacing", "pending", "pending_join", "processing", "running"].includes(String(item?.state).toLowerCase()))
                : order?.dcordResults?.some(boostPending);
              if (order?.autoReplace === true && !order.autoReplaceStopped && !pending && ["PARTIAL", "ERROR"].includes(String(order.status).toUpperCase())) {
                await pool.query("UPDATE tracked_orders SET payload = payload || $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [uniqid, JSON.stringify({ autoReplaceStopped: "no_eligible_results" })]);
              }
              return;
            }
            const limit = settings[order.provider === "community" ? "members" : "boosts"];
            const rounds = Math.max(0, Number(order.autoReplaceRounds) || 0);
            if (!limit || rounds >= limit) {
              if (order.autoReplaceStopped !== "limit_reached") await pool.query("UPDATE tracked_orders SET payload = payload || $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [uniqid, JSON.stringify({ autoReplaceStopped: "limit_reached" })]);
              return;
            }
            const claimed = await pool.query(`UPDATE tracked_orders SET payload = payload || $2::jsonb, updated_at = NOW()
              WHERE uniqid = $1 AND payload->>'status' IN ('PARTIAL', 'ERROR')
                AND COALESCE(payload->>'autoReplaceRounds', '0') = $3
              RETURNING payload`, [uniqid, JSON.stringify({ autoReplaceRounds: rounds + 1, autoReplaceStopped: null, autoReplaceLastAttemptAt: new Date().toISOString() }), String(rounds)]);
            if (!claimed.rows.length) return;
            try {
              if (order.provider === "community") await replaceMembers(claimed.rows[0].payload);
              else await replaceBoosts(claimed.rows[0].payload, indices);
            } catch (error) {
              // No stock, inaccessible server, or unconfirmed preparation stops
              // automation. A timer/restart must never burn stock indefinitely.
              await pool.query("UPDATE tracked_orders SET payload = payload || $2::jsonb, updated_at = NOW() WHERE uniqid = $1", [uniqid, JSON.stringify({ autoReplaceStopped: "replacement_unavailable" })]);
              onError(`Auto-replace stopped for ${uniqid}:`, error);
            }
          });
        } catch (error) { if (error.statusCode !== 409) onError(`Auto-replace scan failed for ${uniqid}:`, error); }
      }
    } finally { scanning = false; }
  };
}

// Internal adapter only. It never makes an HTTP request or accepts a client
// supplied automation flag; normal route authentication remains in place.
export async function invokeReplacement(handler, orderId, body = {}, options = {}) {
  let status = 200, value, failure;
  const response = { status(code) { status = code; return this; }, set() { return this; }, json(data) { value = data; return this; } };
  await handler({ params: { uniqid: orderId }, body }, response, error => { failure = error; }, { ...options, automatic: true });
  if (failure) throw failure;
  if (status >= 400) throw Object.assign(new Error(value?.message || "Replacement could not be prepared."), { statusCode: status });
  return value;
}
