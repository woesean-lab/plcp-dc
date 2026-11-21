export type StockAccountPair = { token: string; proxy: string; lineNumber: number };

function lines(value: string) {
  const rows = value.split(/\r?\n/).map(line => line.trim());
  while (rows.length && !rows[rows.length - 1]) rows.pop();
  return rows;
}

// Keep row positions: independently filtering blank lines would shift proxies.
export function parseStockAccountPairs(tokens: string, proxies: string): StockAccountPair[] {
  const tokenLines = lines(tokens);
  const proxyLines = lines(proxies);
  if (!tokens.trim() || tokenLines.length !== proxyLines.length) {
    throw new Error("Enter exactly one auth proxy per account: 500 accounts require 500 proxy lines.");
  }
  if (tokenLines.length > 500) throw new Error("You can add up to 500 accounts in one bulk operation.");
  const seenTokens = new Set<string>();
  const seenProxies = new Set<string>();
  return tokenLines.map((line, index) => {
    const parts = line.split(":");
    const token = (parts.length >= 3 ? parts.slice(2).join(":") : line).trim();
    const proxy = proxyLines[index];
    if (token.length < 20 || token.length > 4096 || !proxy) {
      throw new Error("Line " + (index + 1) + " needs a valid account token and its auth proxy. Do not leave blank rows.");
    }
    if (seenTokens.has(token) || seenProxies.has(proxy)) {
      throw new Error("Line " + (index + 1) + " repeats an account or proxy. Use one unique proxy per account.");
    }
    seenTokens.add(token); seenProxies.add(proxy);
    return { token, proxy, lineNumber: index + 1 };
  });
}

