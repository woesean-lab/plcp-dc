import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { serveFrontend } from "../server/serve-frontend.mjs";

test("frontend routes never serve or cache HTML for missing release assets", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plcp-static-test-"));
  await fs.mkdir(path.join(directory, "assets"));
  await fs.writeFile(path.join(directory, "index.html"), "<!doctype html><title>Current release</title>");
  await fs.writeFile(path.join(directory, "assets", "picker-current.js"), "export default 'picker';");
  const app = express();
  serveFrontend(app, directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const method of ["GET", "HEAD"]) {
    const missing = await fetch(`${origin}/assets/VirtualReactionEmojiPicker-old.js`, { method });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    assert.match(missing.headers.get("content-type"), /text\/plain/);
    assert.doesNotMatch(await missing.text(), /doctype|Current release/);
  }
  const chunk = await fetch(`${origin}/assets/picker-current.js`);
  assert.equal(chunk.status, 200);
  assert.match(chunk.headers.get("content-type"), /javascript/);
  assert.match(chunk.headers.get("cache-control"), /immutable/);
  assert.match(await chunk.text(), /export default/);
  for (const route of ["/", "/index.html", "/members_example?eldorado=1"]) {
    const document = await fetch(`${origin}${route}`);
    assert.equal(document.status, 200);
    assert.equal(document.headers.get("cache-control"), "no-store");
    assert.match(await document.text(), /Current release/);
  }
});
