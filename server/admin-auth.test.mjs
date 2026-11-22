import test from "node:test";
import assert from "node:assert/strict";
import { createAdminAuth, hashSessionToken } from "./admin-auth.mjs";
import fs from "node:fs";

// Transactional pool fixture. Password hashing/verification use real scrypt.
function memoryPool() {
  let credential = null;
  const sessions = new Map();
  let queue = Promise.resolve();
  let failRevoke = false;
  async function query(sql, params = []) {
    if (sql.startsWith("CREATE ")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("SELECT 1 FROM admin_credentials")) return { rowCount: Number(Boolean(credential)), rows: [] };
    if (sql.startsWith("INSERT INTO admin_credentials")) { credential ??= { username: params[0], password_hash: params[1], password_updated_at: null }; return { rowCount: 1 }; }
    if (sql.startsWith("SELECT * FROM admin_credentials")) return { rows: credential ? [{ ...credential }] : [] };
    if (sql.startsWith("INSERT INTO admin_sessions")) { sessions.set(params[0], { created_at: new Date(), expires_at: params[1] }); return { rowCount: 1 }; }
    if (sql.startsWith("SELECT 1 FROM admin_sessions")) return { rowCount: Number(sessions.has(params[0]) && sessions.get(params[0]).expires_at > new Date()) };
    if (sql.startsWith("SELECT c.username")) { const session = sessions.get(params[0]); return { rows: credential && session?.expires_at > new Date() ? [{ ...credential, ...session }] : [] }; }
    if (sql.startsWith("UPDATE admin_credentials")) { credential.password_hash = params[0]; credential.password_updated_at = params[1]; return { rowCount: 1 }; }
    if (sql.startsWith("DELETE FROM admin_sessions")) { if (failRevoke) throw Error("Simulated database failure"); for (const token of sessions.keys()) if (token !== params[0]) sessions.delete(token); return { rowCount: 1 }; }
    throw Error(`Unexpected SQL: ${sql}`);
  }
  return {
    query, sessions,
    credential: () => credential,
    failRevoke: () => { failRevoke = true; },
    async connect() {
      let unlock;
      const previous = queue;
      queue = new Promise(resolve => { unlock = resolve; });
      await previous;
      const snapshot = { credential: structuredClone(credential), sessions: structuredClone(sessions) };
      return {
        async query(sql, params) {
          if (sql === "ROLLBACK") { credential = snapshot.credential; sessions.clear(); for (const [key, value] of snapshot.sessions) sessions.set(key, value); return {}; }
          if (sql === "BEGIN" || sql === "COMMIT") return {};
          return query(sql, params);
        },
        release: unlock
      };
    }
  };
}
async function setup() {
  const pool = memoryPool();
  const options = { pool, username: "admin", password: "initial password", sessionDurationMs: 43_200_000 };
  const auth = createAdminAuth(options);
  await auth.initialize();
  const current = await auth.login({ username: "admin", password: "initial password" });
  return { pool, auth, options, current, tokenHash: hashSessionToken(current.token) };
}

test("bootstrap persists only a salted hash and does not overwrite an existing account", async () => {
  const { pool, options, auth } = await setup();
  assert.match(pool.credential().password_hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(pool.credential().password_hash.includes(options.password), false);
  await createAdminAuth({ ...options, username: "changed-env", password: "different env password" }).initialize();
  await assert.rejects(auth.login({ username: "changed-env", password: "different env password" }), { statusCode: 401 });
  assert.equal(pool.credential().username, "admin");
});

test("a password change survives restart, revokes other sessions, and keeps the current session", async () => {
  const { pool, auth, options, tokenHash } = await setup();
  const other = await auth.login({ username: "admin", password: "initial password" });
  const result = await auth.changePassword(tokenHash, { currentPassword: "initial password", newPassword: "new secure password" });
  assert.equal(result.changed, true);
  assert.equal(pool.sessions.has(tokenHash), true);
  assert.equal(pool.sessions.has(hashSessionToken(other.token)), false);
  const restarted = createAdminAuth(options); await restarted.initialize();
  await assert.rejects(restarted.login({ username: "admin", password: "initial password" }), { statusCode: 401 });
  await restarted.login({ username: "admin", password: "new secure password" });
  const profile = await restarted.profile(tokenHash);
  assert.equal(profile.username, "admin");
  assert.ok(profile.passwordUpdatedAt);
  assert.equal("password_hash" in profile, false);
  assert.equal("token" in profile, false);
});

test("wrong current password, invalid replacement, and expired sessions cannot change credentials", async () => {
  const { pool, auth, tokenHash } = await setup();
  const original = pool.credential().password_hash;
  await assert.rejects(auth.changePassword(tokenHash, { currentPassword: "wrong", newPassword: "valid new password" }), /Current password is incorrect/);
  for (const newPassword of ["short", " ".repeat(12), "x".repeat(129), null]) await assert.rejects(auth.changePassword(tokenHash, { currentPassword: "initial password", newPassword }), { statusCode: 400 });
  await assert.rejects(auth.changePassword(tokenHash, { currentPassword: "initial password", newPassword: "initial password" }), /different password/);
  assert.equal(pool.credential().password_hash, original);
  pool.sessions.get(tokenHash).expires_at = new Date(0);
  await assert.rejects(auth.changePassword(tokenHash, { currentPassword: "initial password", newPassword: "valid new password" }), { statusCode: 401 });
});

test("failed session revocation rolls back the password update", async () => {
  const { pool, auth, tokenHash } = await setup();
  const original = pool.credential().password_hash;
  pool.failRevoke();
  await assert.rejects(auth.changePassword(tokenHash, { currentPassword: "initial password", newPassword: "valid new password" }), /database failure/);
  assert.equal(pool.credential().password_hash, original);
});

test("concurrent password changes cannot both accept the old password", async () => {
  const { auth, tokenHash } = await setup();
  const results = await Promise.allSettled(["first new password", "second new password"].map(newPassword => auth.changePassword(tokenHash, { currentPassword: "initial password", newPassword })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
});

test("repeated wrong current passwords are throttled", async () => {
  const { auth, tokenHash } = await setup();
  for (let i = 0; i < 5; i++) await assert.rejects(auth.changePassword(tokenHash, { currentPassword: "wrong", newPassword: "valid new password" }), { statusCode: 400 });
  await assert.rejects(auth.changePassword(tokenHash, { currentPassword: "initial password", newPassword: "valid new password" }), { statusCode: 429 });
});

const pgRuntime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
test("PostgreSQL stores the changed hash and revokes sessions atomically", { skip: !fs.existsSync(pgRuntime) }, async () => {
  const { PGlite } = await import(pgRuntime.href);
  const db = new PGlite();
  const pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  const auth = createAdminAuth({ pool, username: "admin", password: "initial password", sessionDurationMs: 43_200_000 });
  try {
    await db.exec("CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    await auth.initialize();
    const first = await auth.login({ username: "admin", password: "initial password" });
    const other = await auth.login({ username: "admin", password: "initial password" });
    await auth.changePassword(hashSessionToken(first.token), { currentPassword: "initial password", newPassword: "changed secure password" });
    assert.equal((await db.query("SELECT * FROM admin_sessions")).rows.length, 1);
    await assert.rejects(auth.profile(hashSessionToken(other.token)), { statusCode: 401 });
    assert.equal((await auth.profile(hashSessionToken(first.token))).username, "admin");
    await assert.rejects(auth.login({ username: "admin", password: "initial password" }), { statusCode: 401 });
    await auth.login({ username: "admin", password: "changed secure password" });
  } finally { await db.close(); }
});
