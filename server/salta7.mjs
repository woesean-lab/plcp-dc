// Salta7 BYOT integration. Never send proxy fields or buy from provider stock.
export function createSalta7Client({ loadKey, fetch: transport = globalThis.fetch, baseUrl = "https://salta7.store", sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, pollMs = 5000, maxWaitMs = 620000 }) {
  async function request(path, body) {
    const key = await loadKey();
    let response;
    try {
      response = await transport(new URL(path, baseUrl), {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000), redirect: "error"
      });
    } catch {
      throw Object.assign(new Error("Salta7 could not be reached."), { uncertain: body !== undefined, statusCode: 502, expose: true });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      // Do not echo upstream detail: it can contain account credentials.
      const messages = { 401: "Salta7 rejected the API key.", 403: "Salta7 balance or account access is insufficient.", 400: "Salta7 rejected this task.", 409: "Salta7 rejected a duplicate task or reached an account limit.", 429: "Salta7 is at capacity.", 503: "Salta7 is temporarily unavailable." };
      throw Object.assign(new Error(messages[response.status] || `Salta7 returned HTTP ${response.status}.`), {
        statusCode: response.status, expose: true, providerBlocked: [401, 403, 429, 503].includes(response.status),
        uncertain: body !== undefined && response.status >= 500 && response.status !== 503
      });
    }
    if (!payload || typeof payload !== "object") throw Object.assign(new Error("Salta7 returned an invalid response."), { uncertain: body !== undefined });
    return payload;
  }

  async function check() {
    const value = await request("/balance");
    return { connected: true, status: "ok", message: "Salta7 API is reachable.", ...(Number.isFinite(Number(value.balance)) ? { balance: Number(value.balance) } : {}) };
  }

  async function run(token, invite, options = {}) {
    const masked = "[hidden]";
    let jobId = options.existingTaskId ? String(options.existingTaskId) : "";
    const pending = message => ({ token: masked, success: false, status: "verifying", joinStatus: "verifying", boostStatus: "verifying", slots: null, boost: false, boosted: false, boostMessage: message, transportUncertain: true, taskPending: Boolean(jobId), ...(jobId ? { dcordTaskId: jobId, dcordTaskStatus: "running" } : {}) });
    try {
      const tool = options.boost === false ? "join" : "boost";
      if (!jobId) {
        const started = now();
        const created = await request("/task/create", { tool, invite, tokens: [token] });
        jobId = String(created.job_id ?? "").trim();
        if (!jobId) return pending("Salta7 did not return a job ID. This token will not be submitted again automatically.");
        // Legacy boost worker fields are retained so saved tasks can resume.
        await options.onTaskCreated?.(jobId, { acceptedMs: now() - started });
      }
      const deadline = now() + maxWaitMs;
      while (now() < deadline) {
        try {
          const job = await request(`/task/status?job_id=${encodeURIComponent(jobId)}`);
          if (String(job.job_id ?? "") !== jobId) return pending("Salta7 returned a different job ID. Waiting for confirmation.");
          const state = String(job.status ?? "").toLowerCase();
          if (["completed", "partial", "failed", "cancelled"].includes(state)) {
            const response = await request(`/task/items?job_id=${encodeURIComponent(jobId)}`);
            if (String(response.job_id ?? "") !== jobId || !Array.isArray(response.items)) return pending("Salta7 results could not be verified.");
            const extract = line => String(line ?? "").trim().split(":").at(-1);
            const item = response.items.find(item => extract(item.line) === extract(token));
            // Recovery can change a token; a single-account job still has exactly one result.
            const result = item || (response.items.length === 1 && Number(job.total) === 1 ? response.items[0] : null);
            if (!result || ["pending", "running"].includes(String(result.status))) return pending("Salta7 has not returned this account's final result yet.");
            const count = tool === "boost" ? Math.min(2, Math.max(0, Number.isInteger(result.boosts) ? result.boosts : 0)) : 0;
            const status = String(result.status ?? "failed");
            const joined = ["joined", "already_in"].includes(status) || count > 0;
            const unused = status === "not_used";
            return { token: masked, success: joined, status: count >= 2 ? "joined + boosted" : count > 0 ? "partial" : joined ? "joined" : unused ? "not_used" : "error",
              joinStatus: joined ? "joined" : unused ? "not submitted" : "failed", boostStatus: tool === "join" ? "skipped" : count >= 2 ? "boosted" : count > 0 ? "partial" : "failed",
              slots: count, boostCount: count, boost: count > 0, boosted: count >= 2,
              boostMessage: `Salta7: ${/^[a-z_]{1,40}$/.test(status) ? status.replaceAll("_", " ") : "task finished"}${tool === "boost" ? ` · ${count}/2 boosts` : ""}.`,
              serverBlocked: ["invites_paused", "guild_limited", "invalid_invite", "invite_expired"].includes(status),
              dcordTaskId: jobId, dcordTaskStatus: state, taskPending: false, transportUncertain: false };
          }
        } catch { /* Recheck the accepted job; never recreate it on a polling error. */ }
        await sleep(pollMs);
      }
      return pending("Salta7 is still processing. The saved job will be checked again.");
    } catch (error) {
      if (jobId || error?.uncertain) return pending(jobId ? "Salta7 accepted the task. Its saved job will be checked again." : "Salta7 submission was not confirmed. This token will not be submitted again automatically.");
      return { token: masked, success: false, status: error?.providerBlocked ? "queued" : "error", joinStatus: error?.providerBlocked ? "not submitted" : "failed", boostStatus: "not submitted", slots: 0, boostCount: 0, boost: false, boosted: false, boostMessage: error.message, providerBlocked: error?.providerBlocked === true, transportUncertain: false, httpStatus: error?.statusCode };
    }
  }
  return { check, run };
}
