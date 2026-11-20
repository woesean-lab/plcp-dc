import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CUSTOMER_REACTION_SETTINGS_GUARD_SQL } from "./customer-order-reaction-settings-guard.mjs";
import { COMMUNITY_ORDER_CATEGORY_GUARD_SQL } from "./community-order-category-guard.mjs";
import { getCustomerReactionSummary, saveCustomerReactionSettings } from "./customer-order-reactions.mjs";

const pgRuntime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
const pgOptions = { skip: !fs.existsSync(pgRuntime) };
const now = Date.parse("2026-11-20T12:00:00Z");
const original = { uniqid: "order", provider: "community", status: "PROCESS", amount: 500, added: 0,
  createdAt: "2026-09-01", expiredAt: "2099-01-01", categoryReactionUseEnabled: true,
  reactionDailyLimit: 50, reactionCapacity: 50, reactionRequests: [], communityResults: [] };
async function database(run) {
  const { PGlite } = await import(pgRuntime.href);
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE tracked_orders (uniqid text PRIMARY KEY, payload jsonb NOT NULL, updated_at timestamptz DEFAULT NOW())");
    await db.exec(COMMUNITY_ORDER_CATEGORY_GUARD_SQL);
    await db.exec(CUSTOMER_REACTION_SETTINGS_GUARD_SQL);
    await db.query("INSERT INTO tracked_orders VALUES ($1, $2::jsonb)", [original.uniqid, JSON.stringify(original)]);
    const write = async (order) => (await db.query("UPDATE tracked_orders SET payload = $2::jsonb WHERE uniqid = $1 RETURNING payload", [order.uniqid, JSON.stringify(order)])).rows[0].payload;
    const read = async () => (await db.query("SELECT payload FROM tracked_orders WHERE uniqid = $1", [original.uniqid])).rows[0].payload;
    await run(db, write, read);
  } finally { await db.close(); }
}

test("Save limit persists the new daily limit after a stale direct delivery update and reopening", pgOptions, async () => {
  await database(async (db, write, read) => {
    const saved = await saveCustomerReactionSettings(db, original, 100, now);
    assert.equal(saved.reactionDailyLimit, 100);
    assert.equal(saved.reactionSettingsRevision, 1);
    await write({ ...original, added: 10 });
    const reopened = await read();
    assert.equal(reopened.added, 10, "delivery progress still saves");
    assert.equal(reopened.reactionDailyLimit, 100, "an old worker cannot restore 50");
    assert.deepEqual(reopened.reactionLimitUpdates, saved.reactionLimitUpdates);
    assert.equal(getCustomerReactionSummary(reopened, now).todayLimit, 100);
    const newer = await saveCustomerReactionSettings(db, reopened, 200, now + 1000);
    await write({ ...saved, added: 20 });
    assert.equal((await read()).reactionDailyLimit, 200);
    assert.equal((await read()).reactionSettingsRevision, newer.reactionSettingsRevision);
  });
});

test("stale writers cannot undo disabling or re-enabling, or overwrite the first-day anchor", pgOptions, async () => {
  await database(async (db, write, read) => {
    const active = await saveCustomerReactionSettings(db, original, 100, now);
    const disabled = await saveCustomerReactionSettings(db, active, 100, now + 1000, { enabled: false });
    await write(active);
    assert.equal((await read()).reactionDisabled, true);
    const reenabled = await saveCustomerReactionSettings(db, await read(), 100, now + 2000);
    await write(disabled);
    const reopened = await read();
    assert.equal(reopened.reactionDisabled, false);
    assert.equal(reopened.reactionEnabledAt, active.reactionEnabledAt);
    assert.equal(reopened.reactionFirstDayLimit, active.reactionFirstDayLimit);
    assert.equal(reopened.reactionSettingsRevision, reenabled.reactionSettingsRevision);
    assert.equal(getCustomerReactionSummary(reopened, now + 2000).enabled, true);
  });
});

test("missing or malformed incoming revisions cannot restore old settings", pgOptions, async () => {
  await database(async (db, write, read) => {
    await saveCustomerReactionSettings(db, original, 100, now);
    for (const revision of [undefined, null, "old"]) {
      await write({ ...original, reactionSettingsRevision: revision });
      assert.equal((await read()).reactionDailyLimit, 100);
    }
  });
});

test("the save helper rejects a database result that did not persist the requested settings", async () => {
  const client = { query: async () => ({ rows: [{ payload: original }] }) };
  await assert.rejects(saveCustomerReactionSettings(client, original, 100, now), { statusCode: 409 });
});

test("first-day increases and decreases persist across reopening and stale worker updates", pgOptions, async () => {
  await database(async (db, write, read) => {
    const firstDay = { ...original, amount: 50, reactionDailyLimit: 1000, reactionEnabledAt: new Date(now).toISOString(), reactionFirstDayLimit: 50 };
    await write(firstDay);
    const increased = await saveCustomerReactionSettings(db, firstDay, 1000, now);
    await write(firstDay);
    assert.equal(getCustomerReactionSummary(await read(), now).todayLimit, 1000);
    const decreased = await saveCustomerReactionSettings(db, await read(), 20, now + 1000);
    await write(increased);
    const reopened = await read();
    assert.equal(reopened.reactionDailyLimit, 20);
    assert.equal(getCustomerReactionSummary(reopened, now + 1000).todayLimit, 20);
    assert.equal(reopened.reactionSettingsRevision, decreased.reactionSettingsRevision);
  });
});
