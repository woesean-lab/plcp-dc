import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
export const hashSessionToken = token => crypto.createHash("sha256").update(token).digest("hex");
const failure = (statusCode, message) => Object.assign(new Error(message), { statusCode });

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  const [algorithm, salt, hex] = String(encoded).split("$");
  if (algorithm !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const actual = await scrypt(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hex, "hex"));
}

export function createAdminAuth({ pool, username, password, sessionDurationMs }) {
  const attempts = new Map();
  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  return {
    async initialize() {
      await pool.query(`CREATE TABLE IF NOT EXISTS admin_credentials (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        username TEXT NOT NULL, password_hash TEXT NOT NULL,
        password_updated_at TIMESTAMPTZ
      )`);
      const existing = await pool.query("SELECT 1 FROM admin_credentials WHERE singleton = TRUE");
      if (!existing.rowCount && username && password) {
        await pool.query("INSERT INTO admin_credentials (singleton, username, password_hash) VALUES (TRUE, $1, $2) ON CONFLICT (singleton) DO NOTHING", [username, await hashPassword(password)]);
      }
    },
    async login(input) {
      if (typeof input?.username !== "string" || typeof input?.password !== "string" || input.password.length > 1024) throw failure(401, "Invalid username or password.");
      return transaction(async client => {
        const { rows: [credential] } = await client.query("SELECT * FROM admin_credentials WHERE singleton = TRUE FOR UPDATE");
        if (!credential) throw failure(503, "Admin credentials are not configured.");
        // Verify even an incorrect username so the response does not reveal the account name.
        const valid = await verifyPassword(input.password, credential.password_hash);
        if (!valid || input.username.trim() !== credential.username) throw failure(401, "Invalid username or password.");
        const token = crypto.randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + sessionDurationMs);
        await client.query("INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)", [hashSessionToken(token), expiresAt]);
        return { token, expiresAt };
      });
    },
    async profile(tokenHash) {
      const { rows: [row] } = await pool.query(`SELECT c.username, c.password_updated_at, s.created_at, s.expires_at
        FROM admin_credentials c JOIN admin_sessions s ON s.token_hash = $1
        WHERE c.singleton = TRUE AND s.expires_at > NOW()`, [tokenHash]);
      if (!row) throw failure(401, "Session expired. Sign in again.");
      return { username: row.username, role: "Administrator", signedInAt: row.created_at, expiresAt: row.expires_at, passwordUpdatedAt: row.password_updated_at };
    },
    async changePassword(tokenHash, input) {
      if (typeof input?.currentPassword !== "string" || input.currentPassword.length > 1024) throw failure(400, "Enter your current password.");
      if (typeof input?.newPassword !== "string" || input.newPassword.length < 12 || input.newPassword.length > 128 || !input.newPassword.trim()) throw failure(400, "New password must be 12–128 characters.");
      return transaction(async client => {
        const { rows: [credential] } = await client.query("SELECT * FROM admin_credentials WHERE singleton = TRUE FOR UPDATE");
        const session = await client.query("SELECT 1 FROM admin_sessions WHERE token_hash = $1 AND expires_at > NOW()", [tokenHash]);
        if (!credential || !session.rowCount) throw failure(401, "Session expired. Sign in again.");
        const attempt = attempts.get(tokenHash);
        if (attempt?.until > Date.now() && attempt.count >= 5) throw failure(429, "Too many attempts. Try again in 15 minutes.");
        if (!await verifyPassword(input.currentPassword, credential.password_hash)) {
          for (const [key, value] of attempts) if (value.until <= Date.now()) attempts.delete(key);
          attempts.set(tokenHash, { count: (attempt?.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60_000 });
          throw failure(400, "Current password is incorrect.");
        }
        if (input.currentPassword === input.newPassword) throw failure(400, "Choose a different password.");
        const updatedAt = new Date();
        await client.query("UPDATE admin_credentials SET password_hash = $1, password_updated_at = $2 WHERE singleton = TRUE", [await hashPassword(input.newPassword), updatedAt]);
        await client.query("DELETE FROM admin_sessions WHERE token_hash <> $1", [tokenHash]);
        attempts.clear();
        return { changed: true, passwordUpdatedAt: updatedAt };
      });
    }
  };
}
