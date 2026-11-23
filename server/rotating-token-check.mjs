import crypto from "node:crypto";

const active = check => ["submitting", "running"].includes(check?.status);
const conflict = message => { throw Object.assign(new Error(message), { statusCode: 409 }); };

// Claims and results are persisted under the inventory lock. Network work never holds it.
export function createRotatingTokenChecker({ stock, client, now = Date.now }) {
  async function update(id, requestId, value) {
    return stock.withAccounts(rows => {
      const row = rows.find(row => row.id === id);
      if (row?.tokenCheck?.requestId === requestId) Object.assign(row.tokenCheck, value);
    });
  }
  return {
    async start(id) {
      const claim = await stock.withAccount(id, row => {
        const previous = row.tokenCheck;
        if (active(previous) || previous?.status === "unknown") {
          if (previous.jobId || now() - Date.parse(previous.startedAt) < 10 * 60_000) conflict("This token check is already pending. Refresh its result before checking again.");
        }
        const requestId = crypto.randomUUID();
        row.tokenCheck = { status: "submitting", requestId, startedAt: new Date(now()).toISOString() };
        return { requestId, token: row.token };
      });
      let jobId;
      try {
        jobId = await client.createTokenCheck(claim.token);
        await update(id, claim.requestId, { jobId, status: "running" });
      } catch (error) {
        if (jobId) {
          await update(id, claim.requestId, { jobId, status: "running" });
          return { queued: true };
        }
        await update(id, claim.requestId, { status: error?.uncertain ? "unknown" : "error", message: error?.uncertain
          ? "Check submission was not confirmed. Wait 10 minutes before checking again."
          : "Salta7 could not start the check. Check the API connection or daily token limit." });
        // Do not log or return credential-bearing provider responses.
        throw Object.assign(new Error(error?.uncertain ? "Check submission was not confirmed. Wait before checking again." : error.message), { statusCode: error?.statusCode ?? 502, expose: true });
      }
      return { queued: true };
    },
    async refresh() {
      const claims = await stock.withAccounts(rows => {
        const claims = [];
        for (const row of rows) {
          const check = row.tokenCheck;
          if (!active(check)) continue;
          if (!check.jobId) {
            if (now() - Date.parse(check.startedAt) > 60_000) Object.assign(check, { status: "unknown", message: "Check submission was interrupted. Wait 10 minutes before checking again." });
            continue;
          }
          if (claims.length >= 10 || check.polledAt != null && now() - check.polledAt < 5000) continue;
          check.polledAt = now();
          claims.push({ id: row.id, token: row.token, ...check });
        }
        return claims;
      });
      await Promise.allSettled(claims.map(async claim => {
        try {
          const result = await client.getTokenCheck(claim.jobId, claim.token);
          await update(claim.id, claim.requestId, { ...result, message: result.message ?? null,
            ...(result.status !== "running" ? { checkedAt: new Date(now()).toISOString() } : {}) });
        } catch {
          await update(claim.id, claim.requestId, { message: "Check result is temporarily unavailable. Refresh to retry." });
        }
      }));
    }
  };
}
