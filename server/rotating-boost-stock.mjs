import crypto from "node:crypto";

export const BOOST_PERIOD_MS = 30 * 86400_000;
export const BOOST_BUFFER_MS = 3 * 86400_000;
export const BOOST_SUBSCRIPTION_MS = 90 * 86400_000;
export const tokenIdentity = (token) => {
  const parts = String(token).trim().split(":");
  return parts.length >= 3 ? parts[2] : parts[0];
};
const fingerprint = (token) => crypto.createHash("sha256").update(tokenIdentity(token)).digest("hex");
const fail = (message) => { throw Object.assign(new Error(message), { statusCode: 409 }); };

function finishAssignment(row, now) {
  row.history = [...(row.history ?? []), {
    orderId: row.orderId, serverName: row.serverName, startedAt: row.startedAt,
    customerEndsAt: row.customerEndsAt, releasedAt: new Date(now).toISOString()
  }];
  Object.assign(row, {
    status: Date.parse(row.expiresAt) >= now + BOOST_PERIOD_MS + BOOST_BUFFER_MS ? "available" : "expired",
    orderId: null, orderIndex: null, serverName: null, serverId: null,
    reservedAt: null, startedAt: null, customerEndsAt: null
  });
}

export function refreshRotatingRows(rows, now = Date.now()) {
  return rows.map((row) => {
    if (["in_use", "review"].includes(row.status) && Date.parse(row.customerEndsAt) <= now) {
      const released = { ...row };
      finishAssignment(released, now);
      return released;
    }
    if (row.status === "available" && Date.parse(row.expiresAt) < now + BOOST_PERIOD_MS + BOOST_BUFFER_MS) {
      return { ...row, status: "expired" };
    }
    return row;
  });
}

export function syncRotatingOrder(rows, order, now = Date.now()) {
  for (const row of rows) {
    if (row.orderId !== order.uniqid || !["reserved", "in_use"].includes(row.status)) continue;
    const result = order.dcordResults?.[row.orderIndex];
    if (!result) continue;
    if (result.boosted || Number(result.boostCount) > 0) {
      if (!row.startedAt) {
        const deliveredAt = Date.parse(result.deliveredAt);
        const startedAt = Number.isFinite(deliveredAt) ? Math.min(deliveredAt, now) : now;
        row.startedAt = new Date(startedAt).toISOString();
        row.customerEndsAt = new Date(startedAt + BOOST_PERIOD_MS).toISOString();
      }
      row.status = "in_use";
      if (Date.parse(row.customerEndsAt) <= now) finishAssignment(row, now);
    } else if (!["queued", "joining", "processing", "verifying", "pending"].includes(String(result.status).toLowerCase()) && !result.taskPending && !result.transportUncertain && !result.providerBlocked) {
      row.status = "review";
    }
  }
}

// One encrypted inventory, protected by a PostgreSQL transaction lock across replicas.
export function createRotatingBoostStock({ pool, encrypt, decrypt }) {
  const key = "dcord_rotating_boost_stock";
  async function mutate(operation) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(73190452)");
      const result = await client.query("SELECT encrypted_value FROM app_settings WHERE setting_key = $1", [key]);
      const rows = refreshRotatingRows(result.rows[0] ? JSON.parse(decrypt(result.rows[0].encrypted_value)) : []);
      const value = await operation(rows, client);
      await client.query(
        `INSERT INTO app_settings (setting_key, encrypted_value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
        [key, encrypt(JSON.stringify(rows))]
      );
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  const publicRows = (rows) => rows.map(({ token, ...row }) => ({ ...row, redactedToken: `${tokenIdentity(token).slice(0, 6)}…${tokenIdentity(token).slice(-4)}` }));
  return {
    list: () => mutate(async (rows, client) => {
      const ids = [...new Set(rows.filter((row) => row.status === "reserved" || row.status === "in_use").map((row) => row.orderId))];
      if (ids.length) {
        const orders = await client.query("SELECT payload FROM tracked_orders WHERE uniqid = ANY($1::text[])", [ids]);
        orders.rows.forEach(({ payload }) => syncRotatingOrder(rows, payload));
        const found = new Set(orders.rows.map(({ payload }) => payload.uniqid));
        for (const row of rows) {
          if (row.status === "reserved" && !found.has(row.orderId) && Date.parse(row.reservedAt) < Date.now() - 10 * 60_000) row.status = "review";
        }
      }
      return publicRows(rows);
    }),
    saveLegacyStock: (stock) => mutate(async (rows, client) => {
      const ids = new Set([...stock.oneMonth, ...stock.threeMonth].map(fingerprint));
      if (rows.some((row) => ids.has(row.fingerprint))) fail("Rotating accounts must be managed in the Rotating stock section.");
      await client.query(
        `INSERT INTO app_settings (setting_key, encrypted_value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
        ["dcord_boost_token_stock", encrypt(JSON.stringify(stock))]
      );
      return stock;
    }),
    hasTokens: (tokens) => mutate((rows) => {
      const ids = new Set(tokens.map(fingerprint));
      return rows.some((row) => ids.has(row.fingerprint));
    }),
    moveFromThreeMonth: (count) => mutate(async (rows, client) => {
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000) fail("Choose between 1 and 1000 accounts to move.");
      const result = await client.query("SELECT encrypted_value FROM app_settings WHERE setting_key = $1 FOR UPDATE", ["dcord_boost_token_stock"]);
      const raw = result.rows[0] ? JSON.parse(decrypt(result.rows[0].encrypted_value)) : {};
      const stock = { oneMonth: raw.oneMonth ?? [], threeMonth: raw.threeMonth ?? [] };
      const existing = new Set(rows.map((row) => row.fingerprint));
      const oneMonth = new Set(stock.oneMonth.map(fingerprint));
      const unique = new Map(stock.threeMonth.map((token) => [fingerprint(token), token]));
      const selected = [...unique.entries()].filter(([id]) => !existing.has(id) && !oneMonth.has(id)).slice(0, count);
      if (selected.length !== count) fail(`Only ${selected.length} accounts can be moved from 3 month stock.`);
      const now = Date.now();
      const moved = new Set(selected.map(([id]) => id));
      for (const [id, token] of selected) {
        rows.push({ id: crypto.randomUUID(), fingerprint: id, token, expiresAt: new Date(now + BOOST_SUBSCRIPTION_MS).toISOString(), status: "available", history: [], createdAt: new Date(now).toISOString() });
      }
      stock.threeMonth = stock.threeMonth.filter((token) => !moved.has(fingerprint(token)));
      await client.query(
        `INSERT INTO app_settings (setting_key, encrypted_value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (setting_key) DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value, updated_at = NOW()`,
        ["dcord_boost_token_stock", encrypt(JSON.stringify(stock))]
      );
      return { accounts: publicRows(rows), stock: { oneMonth: stock.oneMonth.length, threeMonth: stock.threeMonth.length } };
    }),
    reserve: (count, order, offset = 0) => mutate((rows) => {
      if (!Number.isSafeInteger(count) || count < 1) fail("Choose a valid account count.");
      if (rows.some((row) => row.orderId === order.uniqid && row.orderIndex >= offset && row.orderIndex < offset + count && ["reserved", "in_use"].includes(row.status))) {
        fail("These order slots already have reserved accounts.");
      }
      const selected = rows.filter((row) => row.status === "available")
        .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt)).slice(0, count);
      if (selected.length !== count) fail(`Only ${selected.length * 2} rotating boosts are available for 30 days.`);
      selected.forEach((row, index) => Object.assign(row, {
        status: "reserved", orderId: order.uniqid, orderIndex: offset + index,
        serverName: order.serverName, serverId: order.serverId, reservedAt: new Date().toISOString(),
        startedAt: null, customerEndsAt: null
      }));
      return selected.map((row) => row.token);
    }),
    sync: (order) => mutate((rows) => syncRotatingOrder(rows, order)),
    abortUnsubmitted: (orderId, tokens) => mutate((rows) => {
      const ids = tokens ? new Set(tokens.map(fingerprint)) : null;
      for (const row of rows) {
        if (row.orderId === orderId && row.status === "reserved" && (!ids || ids.has(row.fingerprint))) {
          Object.assign(row, { status: "available", orderId: null, orderIndex: null, serverName: null, serverId: null, reservedAt: null });
        }
      }
    }),
    canSubmit: (orderId, token) => mutate((rows) => {
      const row = rows.find((item) => item.orderId === orderId && item.fingerprint === fingerprint(token));
      if (!row || row.status !== "reserved") return false;
      if (Date.parse(row.expiresAt) < Date.now() + BOOST_PERIOD_MS) {
        row.status = "review";
        return false;
      }
      return true;
    }),
    release: (orderId, tokens) => mutate((rows) => {
      const ids = new Set(tokens.map(fingerprint));
      let count = 0;
      for (const row of rows) {
        if (row.orderId === orderId && ids.has(row.fingerprint) && row.status === "reserved") {
          // A cancelled request is not a completed customer period.
          row.status = "review";
          count++;
        }
      }
      return count;
    })
  };
}
