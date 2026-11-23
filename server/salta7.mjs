function salta7ErrorDetail(payload, secrets) {
  const detail = payload?.detail;
  const text = typeof detail === "string" ? detail
    : Array.isArray(detail) ? detail.map(item => {
      // Validation inputs and ctx may contain credentials; keep location/message only.
      const location = Array.isArray(item?.loc) ? item.loc.filter(value => typeof value === "string" || typeof value === "number").join(".") : "";
      return typeof item?.msg === "string" ? `${location ? location + ": " : ""}${item.msg}` : "";
    }).filter(Boolean).join("; ") : "";
  let safe = text;
  const values = [...new Set(secrets.filter(value => typeof value === "string" && value))].flatMap(value => [value, encodeURIComponent(value)]).sort((a, b) => b.length - a.length);
  for (const value of values) safe = safe.split(value).join("[redacted]");
  return safe.replace(/\b(?:Bearer|Bot)\s+[^\s,;"<>]+/gi, "[redacted authorization]")
    .replace(/\b(?:https?|socks4a?|socks5h?):\/\/[^\s"<>]+/gi, "[redacted URL]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}\b/g, "[redacted token]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
}

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
      const messages = { 401: "Salta7 rejected the API key.", 403: "Salta7 balance or account access is insufficient.", 400: "Salta7 rejected this task.", 409: "Salta7 rejected a duplicate task or reached an account limit.", 429: "Salta7 is at capacity.", 503: "Salta7 is temporarily unavailable." };
      const tokens = Array.isArray(body?.tokens) ? body.tokens : [];
      const detail = salta7ErrorDetail(payload, [key, ...tokens, ...tokens.flatMap(token => String(token).split(":"))]);
      const summary = messages[response.status] || "Salta7 rejected the request.";
      throw Object.assign(new Error(`${summary} (HTTP ${response.status})${detail ? ` ${detail}` : ""}`), {
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
  async function createTokenCheck(token) {
    const result = await request("/task/create", { tool: "check", tokens: [token] });
    const jobId = typeof result.job_id === "string" ? result.job_id.trim() : "";
    if (!jobId) throw Object.assign(new Error("Salta7 did not confirm the check. Wait before checking again."), { uncertain: true });
    return jobId;
  }

  async function getTokenCheck(jobId, token) {
    const result = await request(`/task/items?job_id=${encodeURIComponent(jobId)}`);
    if (result.job_id !== jobId || !Array.isArray(result.items)) throw new Error("Salta7 check results could not be verified.");
    const identity = value => { const parts = String(value ?? "").trim().split(":"); return parts.length >= 3 ? parts[2] : parts[0]; };
    const item = result.items.find(value => identity(value.line) === identity(token));
    const status = String(item?.status ?? "").toLowerCase();
    if (!["valid", "locked", "invalid", "error"].includes(status)) {
      if (["completed", "partial", "failed", "cancelled"].includes(result.status)) return { status: "error", message: "Salta7 could not check this token." };
      return { status: "running" };
    }
    // Keep only check facts; provider lines, credentials and raw errors stay private.
    const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max ? value : null;
    return { status, nitro: typeof item.nitro === "boolean" ? item.nitro : null,
      premiumType: integer(item.premium_type, 3), nitroDays: integer(item.nitro_days, 100000),
      boostFree: integer(item.boost_free, 2),
      lockType: ["phone", "email", "reverify", "other"].includes(item.lock_type) ? item.lock_type : null,
      message: status === "error" ? "Salta7 could not check this token." : null };
  }
  return { check, run, createTokenCheck, getTokenCheck };
}
