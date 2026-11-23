import crypto from "node:crypto";

const active = check => ["submitting", "running"].includes(check?.status);
const conflict = message => { throw Object.assign(new Error(message), { statusCode: 409 }); };

// Claims and results are persisted under the inventory lock. Network work never holds it.
export function createRotatingTokenChecker({ stock, client, now = Date.now }) {
  async function update(claims, value) {
    const byId = new Map(claims.map((claim, index) => [claim.id, { claim, index }]));
    return stock.withAccounts(rows => {
      for (const row of rows) {
        const match = byId.get(row.id);
        if (match && row.tokenCheck?.requestId === match.claim.requestId) Object.assign(row.tokenCheck, typeof value === "function" ? value(match.index) : value);
      }
    });
  }
  async function startChecks(ids, single = false) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some(id => typeof id !== "string" || !id.trim() || id.length > 128)) {
      throw Object.assign(new Error("Select between 1 and 5000 accounts to check."), { statusCode: 400 });
    }
    const unique = [...new Set(ids)];
    const claims = await stock.withAccounts(rows => {
      const byId = new Map(rows.map(row => [row.id, row]));
      if (unique.some(id => !byId.has(id))) throw Object.assign(new Error("A selected Rotating account could not be found. Refresh the list."), { statusCode: 404 });
      const claims = [];
      for (const id of unique) {
        const row = byId.get(id); const previous = row.tokenCheck;
        if ((active(previous) || previous?.status === "unknown") && (previous.jobId || now() - Date.parse(previous.startedAt) < 10 * 60_000)) {
          if (single) conflict("This token check is already pending. Refresh its result before checking again.");
          continue;
        }
        const requestId = crypto.randomUUID();
        row.tokenCheck = { status: "submitting", requestId, startedAt: new Date(now()).toISOString() };
        claims.push({ id, requestId, token: row.token });
      }
      return claims;
    });
    if (!claims.length) return { queued: false, submitted: 0, skipped: unique.length };
    let jobId;
    try {
      jobId = claims.length === 1 ? await client.createTokenCheck(claims[0].token) : await client.createTokenChecks(claims.map(claim => claim.token));
      await update(claims, { jobId, status: "running" });
    } catch (error) {
      if (jobId) await update(claims, { jobId, status: "running" });
      else {
        await update(claims, { status: error?.uncertain ? "unknown" : "error", message: error?.uncertain
          ? "Check submission was not confirmed. Wait 10 minutes before checking again."
          : "Salta7 could not start the check. Check the API connection or daily token limit." });
        throw Object.assign(new Error(error?.uncertain ? "Check submission was not confirmed. Wait before checking again." : error.message), { statusCode: error?.statusCode ?? 502, expose: true });
      }
    }
    return { queued: true, submitted: claims.length, skipped: unique.length - claims.length };
  }
  return {
    start: id => startChecks([id], true),
    startMany: ids => startChecks(ids),
    async refresh() {
      const jobs = await stock.withAccounts(rows => {
        const jobs = new Map();
        for (const row of rows) {
          const check = row.tokenCheck;
          if (!active(check)) continue;
          if (!check.jobId) {
            if (now() - Date.parse(check.startedAt) > 60_000) Object.assign(check, { status: "unknown", message: "Check submission was interrupted. Wait 10 minutes before checking again." });
            continue;
          }
          if ((!jobs.has(check.jobId) && jobs.size >= 10) || (check.polledAt != null && now() - check.polledAt < 5000)) continue;
          check.polledAt = now();
          if (!jobs.has(check.jobId)) jobs.set(check.jobId, []);
          jobs.get(check.jobId).push({ id: row.id, token: row.token, ...check });
        }
        return [...jobs.entries()];
      });
      await Promise.allSettled(jobs.map(async ([jobId, claims]) => {
        try {
          const results = claims.length === 1 ? [await client.getTokenCheck(jobId, claims[0].token)] : await client.getTokenChecks(jobId, claims.map(claim => claim.token));
          if (!Array.isArray(results) || results.length !== claims.length) throw new Error("Unexpected check results");
          await update(claims, index => ({ ...results[index], message: results[index].message ?? null,
            ...(results[index].status !== "running" ? { checkedAt: new Date(now()).toISOString() } : {}) }));
        } catch {
          await update(claims, { message: "Check result is temporarily unavailable. Refresh to retry." });
        }
      }));
    }
  };
}
