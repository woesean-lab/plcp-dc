// Provider export: host:port:username:password:old_ip.
export function convertOnlinerProxyImport(value) {
  const input = String(value ?? "").trim();
  const match = input.match(/^([^:\s]+):(\d+):([^:]+):([^:]+):(\d{1,3}(?:\.\d{1,3}){3})\\?$/);
  if (!match) return input;
  const [, host, port, username, password, oldIp] = match;
  if (Number(port) < 1 || Number(port) > 65535 || oldIp.split(".").some((part) => Number(part) > 255)) return input;
  return `socks5://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
}

export function normalizeOnlinerProxyImportDraft(value) {
  return value.split(/(\r\n|\n|\r|,)/).map((part) => /^(\r\n|\n|\r|,)$/.test(part) ? part : convertOnlinerProxyImport(part)).join("");
}

export function onlinerProxyImportKey(value) {
  const parsed = new URL(value);
  const defaultPort = parsed.protocol.startsWith("socks") ? "1080" : parsed.protocol === "https:" ? "443" : "80";
  return `${parsed.hostname.toLowerCase()}:${parsed.port || defaultPort}`;
}

export function mergeOnlinerProxyImports(existing, additions) {
  const seen = new Set(existing.map(onlinerProxyImportKey));
  const newProxies = additions.filter((proxy) => {
    const key = onlinerProxyImportKey(proxy);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { newProxies, duplicateCount: additions.length - newProxies.length };
}
