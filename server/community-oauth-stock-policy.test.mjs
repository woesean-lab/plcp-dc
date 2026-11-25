import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const runtime = new URL("../output/category-transfer-test/node_modules/@electric-sql/pglite/dist/index.js", import.meta.url);
const guild = "123456789012345678", user = "234567890123456789", rawOnlyUser = "345678901234567890";

test("create, resume, top-up and both replacement SQL paths require the selected bot's OAuth for new orders", { skip: !fs.existsSync(runtime) }, async () => {
  const { PGlite } = await import(runtime.href); const db = new PGlite();
  const templates = [];
  function visit(node) {
    if (ts.isTemplateExpression(node) && node.head.text.trim().startsWith("SELECT discord_user_id") && node.getText(ast).includes("oauthOnly")) templates.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(templates.length, 5);
  try {
    await db.exec(`CREATE TABLE community_oauth_joins (guild_id TEXT,discord_user_id TEXT,username TEXT,avatar_url TEXT,
      encrypted_account_token TEXT,encrypted_access_token TEXT,encrypted_refresh_token TEXT,access_token_expires_at TIMESTAMPTZ,stock_type TEXT,status TEXT)`);
    for (const member of [user, rawOnlyUser]) await db.query("INSERT INTO community_oauth_joins VALUES ($1,$2,$2,NULL,'raw-token',NULL,NULL,NULL,'offline','authorized')", [guild, member]);
    for (const template of templates) {
      const sql = oauthOnly => vm.runInNewContext(template, { config: { oauthOnly }, resolved: { config: { oauthOnly } } });
      const strict = sql(true), legacy = sql(false);
      const args = grants => strict.includes("array_position") ? [guild, [user, rawOnlyUser], true, grants]
        : strict.includes("LIMIT $5") ? [guild, [], [], "offline", 10, true, grants]
        : strict.includes("LIMIT 1") ? [guild, [], [], "offline", true, grants]
        : [guild, "offline", 10, [], true, grants];
      assert.deepEqual((await db.query(strict, args([user]))).rows.map(row => row.discord_user_id), [user]);
      assert.equal((await db.query(strict, args([]))).rows.length, 0, "raw account tokens must never replace a missing OAuth grant");
      assert.ok((await db.query(legacy, args([]))).rows.length > 0, "existing orders retain their original stock selection");
    }
  } finally { await db.close(); }
});

test("configuration normalization retains the persisted OAuth-only policy after restart", () => {
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "normalizeCommunityOAuthConfig");
  const normalize = vm.runInNewContext(`(${declaration.getText(ast)})`, { isDiscordGuildId: value => /^\d{16,22}$/.test(value) });
  const input = { orderBotId: "order", clientId: user, guildId: guild, botToken: "bot", clientSecret: "secret", poolBotId: user, oauthOnly: true };
  assert.equal(normalize(input).oauthOnly, true);
  assert.equal(normalize({ ...input, oauthOnly: undefined }).oauthOnly, false);
  assert.equal(normalize(input).poolBotId, user);
});
