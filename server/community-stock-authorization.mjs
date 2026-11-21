import crypto from "node:crypto";

export function onlinerAuthorizationRouteKey(token, proxyUrl) {
  return crypto.createHash("sha256").update(token + "\0" + proxyUrl).digest("hex");
}

export function getReusableAuthorizationGatewayUser(account, proxyUrl, runtime, worker, now = Date.now()) {
  const heartbeat = new Date(worker?.heartbeat_at ?? 0).getTime();
  if (!account || !proxyUrl || worker?.status !== "online" || !Number.isFinite(heartbeat) || heartbeat < now - 15_000 || heartbeat > now + 5_000) return null;
  if (runtime?.connectionState !== "connected" || runtime.authorizationRouteKey !== onlinerAuthorizationRouteKey(account.botToken, proxyUrl)) return null;
  const userId = String(runtime.bot?.id ?? "");
  if (!/^\d{17,20}$/.test(userId) || (account.discordUserId && String(account.discordUserId) !== userId)) return null;
  return runtime.bot;
}

// Every REST step uses the chosen account proxy. No direct transport fallback.
export async function authorizeCommunityStockAccount({ config, accountToken, proxyUrl, onlinerAccount, redirectUri }, {
  normalizeProxy, withGatewaySession, getConnectedGatewayUser, requestThroughProxy, exchangeCode
}) {
  const proxy = normalizeProxy(proxyUrl);
  if (!proxy) throw Object.assign(new Error("Add an available proxy to the Onliner proxy pool before authorizing accounts."), { statusCode: 409 });
  const authorize = async (gatewayUser) => {
    const gatewayUserId = String(gatewayUser?.id ?? "");
    if (!/^\d{17,20}$/.test(gatewayUserId)) throw Object.assign(new Error("The Onliner Gateway did not return a valid account identity."), { statusCode: 409 });
    const accountIdentity = await requestThroughProxy("users/@me", proxy, { headers: { Authorization: accountToken } });
    if (!accountIdentity.response.ok) {
      throw Object.assign(new Error(accountIdentity.response.status === 429
        ? "Discord is rate limiting account checks. Try again shortly."
        : "Discord rejected this account token. Check that it is current and valid."), { statusCode: accountIdentity.response.status === 429 ? 429 : 401 });
    }
    const discordUserId = String(accountIdentity.payload?.id ?? "");
    if (discordUserId !== gatewayUserId) throw Object.assign(new Error("The REST account identity does not match the Onliner Gateway account."), { statusCode: 409 });
    const query = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: redirectUri, scope: "identify guilds.join" });
    const authorization = await requestThroughProxy("oauth2/authorize?" + query.toString(), proxy, {
      method: "POST", headers: { Authorization: accountToken, "Content-Type": "application/json" },
      body: JSON.stringify({ authorize: true, permissions: "0" })
    });
    if (!authorization.response.ok) {
      const status = authorization.response.status;
      const message = String(authorization.payload?.message ?? authorization.payload?.error_description ?? "Discord rejected the application authorization.").trim();
      throw Object.assign(new Error(status === 401 ? "Discord rejected this account token." : status === 429 ? "Discord is rate limiting OAuth authorizations. Try again shortly."
        : "Discord OAuth authorization failed (HTTP " + status + "): " + message), { statusCode: status === 429 ? 429 : status >= 500 ? 502 : 409 });
    }
    let code = "";
    try { code = new URL(String(authorization.payload?.location ?? ""), redirectUri).searchParams.get("code") ?? ""; } catch {}
    if (!code) throw Object.assign(new Error("Discord did not return an OAuth authorization code. The account may require additional verification or consent."), { statusCode: 409 });
    const oauth = await exchangeCode(config, code, redirectUri, proxy);
    const oauthIdentity = await requestThroughProxy("oauth2/@me", proxy, { headers: { Authorization: "Bearer " + oauth.accessToken } });
    const scopes = Array.isArray(oauthIdentity.payload?.scopes) ? oauthIdentity.payload.scopes.map(String) : [];
    if (!oauthIdentity.response.ok || String(oauthIdentity.payload?.user?.id ?? "") !== discordUserId || !scopes.includes("guilds.join")) {
      throw Object.assign(new Error("The new OAuth authorization could not be verified with the required guilds.join permission."), { statusCode: 502 });
    }
    return { accountIdentity, oauth, discordUserId };
  };
  const connectedUser = await getConnectedGatewayUser(onlinerAccount, proxy);
  if (connectedUser) return authorize(connectedUser);
  return withGatewaySession({ id: onlinerAccount?.discordUserId || null, token: accountToken, proxyUrl: proxy, onlinerAccountId: onlinerAccount?.id ?? null }, authorize);
}
