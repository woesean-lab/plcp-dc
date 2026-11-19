import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = fs.readFileSync(new URL("../src/lib/community-onliner-connect.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
vm.runInNewContext(code, { exports, Error, Map, require(name) {
  assert.equal(name, "./community");
  return { connectCommunityMemberToOnliner: () => { throw new Error("Live API calls are not allowed in this test."); } };
} });
const { connectCommunityMembersToOnliner } = exports;
const member = (id, overrides = {}) => ({ id, username: `user_${id}`, displayName: null, onlinerConnected: false, hasStoredAccountToken: true, ...overrides });
const saved = (id) => ({ connected: true, accountId: `profile_${id}`, alreadyExisted: false });

test("connections are sequential, deduplicated, and use the chosen presence setting", async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const result = await connectCommunityMembersToOnliner([member("a"), member("a"), member("b")], false, {
    connect: async (id, presence) => {
      active += 1; maxActive = Math.max(maxActive, active); calls.push([id, presence]);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1; return saved(id);
    }
  });
  assert.equal(maxActive, 1, "configuration saves must not race each other");
  assert.deepEqual(calls, [["a", false], ["b", false]]);
  assert.deepEqual(Array.from(result.connected, (record) => record.id), ["a", "b"]);
  assert.equal(result.failed.length, 0);
});

test("existing profiles and missing tokens are handled separately; failures do not stop the batch", async () => {
  const members = [member("existing", { onlinerConnected: true, hasStoredAccountToken: false }), member("bad"), member("missing", { hasStoredAccountToken: false }), member("good")];
  const original = structuredClone(members);
  const calls = [];
  const progress = [];
  const result = await connectCommunityMembersToOnliner(members, true, {
    connect: async (id) => { calls.push(id); if (id === "bad") throw new Error("Account verification failed."); return saved(id); },
    onProgress: ({ completed, total }) => progress.push([completed, total])
  });
  assert.deepEqual(calls, ["bad", "good"]);
  assert.deepEqual(Array.from(result.skipped), ["existing"]);
  assert.deepEqual(Array.from(result.failed, (record) => record.id), ["bad", "missing"]);
  assert.equal(result.failed[0].message, "Account verification failed.");
  assert.match(result.failed[1].message, /No saved account token/);
  assert.deepEqual(Array.from(result.connected, (record) => record.id), ["good"]);
  assert.deepEqual(progress, [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]]);
  assert.deepEqual(members, original, "input selection is not mutated");
});

test("an unsuccessful response stays retryable without losing later successes", async () => {
  const result = await connectCommunityMembersToOnliner([member("first"), member("second")], true, {
    connect: async (id) => id === "first" ? { ...saved(id), connected: false } : saved(id)
  });
  assert.deepEqual(Array.from(result.failed, (record) => record.id), ["first"]);
  assert.deepEqual(Array.from(result.connected, (record) => record.id), ["second"]);
  const retry = await connectCommunityMembersToOnliner([member(result.failed[0].id)], true, { connect: async (id) => saved(id) });
  assert.equal(retry.failed.length, 0);
  assert.equal(retry.connected[0].id, "first");
});
