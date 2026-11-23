import test from "node:test";
import assert from "node:assert/strict";
import { ensureEldoradoIntegrationSettings, readEldoradoIntegrationSettings, registerEldoradoIntegrationSettings, integrationKeyHash, integrationKeyMatches, normalizeMonitorOrigin } from "./eldorado-integration-settings.mjs";
import { registerEldoradoIntegration } from "./eldorado-integration.mjs";

const origin = "https://monitor.example.test";
function database() {
  let row;
  const pool = { async query(sql, args = []) {
    if (sql.startsWith("CREATE TABLE")) return { rows: [] };
    if (sql.startsWith("INSERT INTO eldorado_integration_config")) {
      row ||= { key_hash: args[0], key_suffix: args[1], public_base: args[2], revision: 0 };
      return { rows: [] };
    }
    if (sql.startsWith("SELECT key_hash")) return { rows: row ? [{ ...row }] : [] };
    if (sql.startsWith("UPDATE eldorado_integration_config")) {
      if (!row || row.revision !== args[3]) return { rows: [] };
      row = { key_hash: args[0] ?? row.key_hash, key_suffix: args[1] ?? row.key_suffix, public_base: args[2], revision: row.revision + 1, updated_at: new Date().toISOString() };
      return { rows: [{ ...row }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return pool;
}
function application(pool) {
  const routes = new Map();
  const app = Object.fromEntries(["get", "put", "post"].map(method => [method, (path, ...handlers) => routes.set(`${method} ${path}`, handlers)]));
  let sessionChecks = 0;
  registerEldoradoIntegrationSettings(app, { pool, requireSession(req, res, next) {
    sessionChecks++;
    return req.session ? next() : res.status(401).json({ message: "Authentication required." });
  } });
  registerEldoradoIntegration(app, { pool, getCatalog: async () => ({ categories: [] }) });
  async function call(method, path = "/api/admin/eldorado-integration", body, options = {}) {
    const req = { body, session: options.session !== false, headers: { authorization: options.key ? `Bearer ${options.key}` : "" } };
    const res = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    const handlers = routes.get(`${method} ${path}`);
    async function dispatch(index) {
      let continuation;
      await handlers[index](req, res, error => {
        if (error) throw error;
        continuation = dispatch(index + 1);
        return continuation;
      });
      await continuation;
    }
    await dispatch(0);
    return res;
  }
  return { call, get sessionChecks() { return sessionChecks; } };
}
const keyPath = "/api/admin/eldorado-integration/key";
const catalogPath = "/api/integrations/eldorado/catalog";

test("all admin key endpoints require a session and are never cached", async () => {
  const pool = database(); await ensureEldoradoIntegrationSettings(pool, {});
  const app = application(pool);
  for (const [method, path] of [["get", undefined], ["put", undefined], ["post", keyPath]]) {
    const result = await app.call(method, path, { revision: 0, publicBase: origin }, { session: false });
    assert.equal(result.statusCode, 401);
    assert.equal(result.headers["Cache-Control"], "no-store");
  }
  assert.equal(app.sessionChecks, 3);
  assert.equal((await readEldoradoIntegrationSettings(pool)).revision, 0);
});

test("generated keys are revealed once, hashed in storage and usable across server instances", async () => {
  const pool = database(); await ensureEldoradoIntegrationSettings(pool, {});
  const first = application(pool), second = application(pool);
  const result = await first.call("post", keyPath, { revision: 0, publicBase: origin });
  assert.equal(result.statusCode, 200);
  assert.match(result.body.apiKey, /^plcp_[A-Za-z0-9_-]{43}$/);
  const saved = await readEldoradoIntegrationSettings(pool);
  assert.equal(saved.key_hash, integrationKeyHash(result.body.apiKey));
  assert.equal(JSON.stringify(saved).includes(result.body.apiKey), false);
  const metadata = await second.call("get");
  assert.equal(metadata.body.keySuffix, result.body.apiKey.slice(-4));
  assert.equal(metadata.body.apiKey, undefined);
  assert.equal(metadata.body.key_hash, undefined);
  assert.equal((await second.call("get", catalogPath, undefined, { key: result.body.apiKey })).statusCode, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
});

test("rotation requires confirmation, rejects old keys on every instance and survives restart", async () => {
  const pool = database(); const legacyKey = "legacy-" + "a".repeat(40);
  await ensureEldoradoIntegrationSettings(pool, { PLCP_MNG_INTEGRATION_KEY: legacyKey, PLCP_PUBLIC_URL: origin });
  const first = application(pool), second = application(pool);
  assert.equal((await first.call("post", keyPath, { revision: 0, publicBase: origin })).statusCode, 409);
  const rotated = await first.call("post", keyPath, { revision: 0, publicBase: origin, rotate: true });
  assert.equal(rotated.statusCode, 200);
  for (const app of [first, second]) {
    assert.equal((await app.call("get", catalogPath, undefined, { key: legacyKey })).statusCode, 401);
    assert.equal((await app.call("get", catalogPath, undefined, { key: rotated.body.apiKey })).statusCode, 200);
  }
  await ensureEldoradoIntegrationSettings(pool, { PLCP_MNG_INTEGRATION_KEY: legacyKey, PLCP_PUBLIC_URL: "https://old.example.test" });
  const restarted = application(pool);
  assert.equal((await restarted.call("get", catalogPath, undefined, { key: legacyKey })).statusCode, 401);
  assert.equal((await restarted.call("get")).body.publicBase, origin);
});

test("concurrent generation cannot overwrite a key silently and URL saves preserve the key", async () => {
  const pool = database(); await ensureEldoradoIntegrationSettings(pool, {});
  const a = application(pool), b = application(pool);
  const results = await Promise.all([a.call("post", keyPath, { revision: 0, publicBase: origin }), b.call("post", keyPath, { revision: 0, publicBase: origin })]);
  assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 409]);
  const generated = results.find(result => result.statusCode === 200).body.apiKey;
  const update = await a.call("put", undefined, { revision: 1, publicBase: "https://new.example.test/" });
  assert.equal(update.body.publicBase, "https://new.example.test");
  assert.equal(update.body.apiKey, undefined);
  assert.equal(integrationKeyMatches(generated, await readEldoradoIntegrationSettings(pool)), true);
  assert.equal((await b.call("put", undefined, { revision: 1, publicBase: origin })).statusCode, 409);
});

test("invalid public origins and missing revisions cannot create or mutate keys", async () => {
  const pool = database(); await ensureEldoradoIntegrationSettings(pool, {});
  const app = application(pool);
  for (const publicBase of ["", "http://example.test", "javascript:alert(1)", "https://user:secret@example.test", `${origin}/monitor`, `${origin}/?q=x`, `${origin}/#x`]) {
    assert.equal((await app.call("post", keyPath, { publicBase, revision: 0 })).statusCode, 400);
  }
  assert.equal((await app.call("post", keyPath, { publicBase: origin })).statusCode, 400);
  assert.equal((await readEldoradoIntegrationSettings(pool)).revision, 0);
  assert.equal(normalizeMonitorOrigin(` ${origin}/ `), origin);
  assert.equal(integrationKeyMatches("x".repeat(40), { key_hash: "bad-hash" }), false);
});

test("fresh installs need no environment secrets and ignore malformed legacy values", async () => {
  const pool = database();
  await ensureEldoradoIntegrationSettings(pool, { PLCP_MNG_INTEGRATION_KEY: "short", PLCP_PUBLIC_URL: "http://insecure.example.test" });
  const app = application(pool);
  const metadata = await app.call("get");
  assert.equal(metadata.body.configured, false);
  assert.equal(metadata.body.publicBase, "");
  assert.equal((await app.call("get", catalogPath, undefined, { key: "x".repeat(40) })).statusCode, 401);
  assert.equal((await app.call("post", keyPath, { publicBase: origin, revision: 0 })).statusCode, 200);
});
