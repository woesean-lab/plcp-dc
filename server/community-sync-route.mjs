// Only a proxy endpoint is public. Never persist credentials, URL paths or tokens.
export function describeBotSyncRoute(input, userId, now = new Date()) {
  const mode = ["authorization", "refresh", "reused", "unavailable"].includes(input?.mode) ? input.mode : "unknown";
  const transport = ["proxy", "server", "none"].includes(input?.transport) ? input.transport : "none";
  let endpoint = null;
  if (transport === "proxy") {
    try {
      const url = new URL(input.proxyUrl);
      if (["http:", "https:", "socks4:", "socks5:", "socks5h:"].includes(url.protocol) && url.hostname.length <= 253) endpoint = url.host;
    } catch { /* An invalid endpoint is unavailable, never shown verbatim. */ }
  }
  return { userId, mode, transport, endpoint,
    source: transport === "proxy" ? input?.source === "linked" ? "linked" : "pool" : transport === "server" ? "server" : "none",
    status: "running", updatedAt: now.toISOString() };
}
