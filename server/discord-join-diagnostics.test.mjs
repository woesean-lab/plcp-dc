import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseGuildJoinFailure, discordFailureDetails, oauthJoinDiagnosis } from "./discord-join-diagnostics.mjs";

const identity = (payload = {}) => ({ response: { ok: true, status: 200 }, payload: {
  user: { id: "user" }, application: { id: "app" }, scopes: ["identify", "guilds.join"], ...payload
} });
const failure = { response: { status: 400 }, payload: { message: "400: Bad Request" } };

test("OAuth checks distinguish valid credentials, wrong user/application, missing scope and revoked tokens", () => {
  assert.match(oauthJoinDiagnosis(identity(), "user", "app"), /passed/);
  assert.match(oauthJoinDiagnosis(identity({ user: { id: "other" } }), "user", "app"), /user ID mismatch/);
  assert.match(oauthJoinDiagnosis(identity({ application: { id: "other" } }), "user", "app"), /application ID mismatch/);
  assert.match(oauthJoinDiagnosis(identity({ application: {} }), "user", "app"), /application ID missing/);
  assert.match(oauthJoinDiagnosis(identity({ scopes: ["identify"] }), "user", "app"), /scope missing/);
  assert.match(oauthJoinDiagnosis({ response: { status: 401 } }, "user", "app"), /token rejected/);
  assert.match(oauthJoinDiagnosis({ response: { status: 429 } }, "user", "app"), /inconclusive/);
});

test("failed join makes only a read-only identity request; original failure is retained", async () => {
  const calls = [];
  const result = await diagnoseGuildJoinFailure(failure, {
    request: async (...args) => { calls.push(args); return identity(); },
    userId: "user", applicationId: "app", accessToken: "secret-access", botToken: "secret-bot"
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "oauth2/@me");
  assert.equal(calls[0][1].method, undefined);
  assert.equal(result.response, failure.response);
  assert.equal(result.payload, failure.payload);
  assert.match(discordFailureDetails("Join", result), /OAuth check passed/);
});

test("success and rate limiting do not trigger diagnostics or extra joining", async () => {
  for (const status of [201, 204, 429, 500]) {
    const result = { response: { status } };
    assert.equal(await diagnoseGuildJoinFailure(result, { request: () => assert.fail("unexpected request") }), result);
  }
});

test("diagnostic network errors preserve the original error", async () => {
  const result = await diagnoseGuildJoinFailure(failure, { request: async () => { throw new Error("secret network details"); } });
  assert.equal(result.payload, failure.payload);
  assert.match(result.joinDiagnosis, /inconclusive/);
  assert.equal(result.joinDiagnosis.includes("secret"), false);
});

test("field codes and request reference are reported without credentials or field values", () => {
  const result = { ...failure, diagnosticSecrets: ["access-secret", "bot-secret"], response: {
    status: 400, headers: new Headers({ "cf-ray": "abc123-IST" })
  }, payload: { code: 50035, message: "Invalid access-secret bot-secret Bearer hidden-value", errors: {
    access_token: { _errors: [{ code: "INVALID_TOKEN", message: "access-secret", value: "private" }] }
  } } };
  const details = discordFailureDetails("Join", result);
  assert.match(details, /Discord code 50035/);
  assert.match(details, /access_token: INVALID_TOKEN/);
  assert.match(details, /abc123-IST/);
  for (const secret of ["access-secret", "bot-secret", "hidden-value", "private"]) assert.equal(details.includes(secret), false);
});

test("non-JSON responses and CAPTCHA remain explicit without exposing challenge data", () => {
  assert.match(discordFailureDetails("Join", { ...failure, nonJsonResponse: true }), /non-JSON/);
  const details = discordFailureDetails("Join", { ...failure, payload: { captcha_sitekey: "private-challenge" } });
  assert.match(details, /CAPTCHA/);
  assert.equal(details.includes("private-challenge"), false);
});
