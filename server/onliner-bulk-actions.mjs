export function planOnlinerBulkAction(config, accountIds, action, selectProxy) {
  const selected = new Set(accountIds);
  const succeeded = [];
  const failed = [];
  const known = new Set(config.accounts.map((account) => account.id));
  for (const id of selected) if (!known.has(id)) failed.push({ accountId: id, message: "Bot profile not found." });
  const accounts = config.accounts.map((account) => ({ ...account }));
  for (const account of accounts) {
    if (!selected.has(account.id)) continue;
    if (action === "rotate-proxy") {
      const proxyUrl = selectProxy({ ...config, accounts }, [], account.proxyUrl ? [account.proxyUrl] : []);
      if (!proxyUrl) {
        failed.push({ accountId: account.id, message: "No other available proxy exists in the Onliner pool." });
        continue;
      }
      account.proxyUrl = proxyUrl;
    }
    succeeded.push(account.id);
  }
  return { accounts: action === "remove" ? accounts.filter((account) => !selected.has(account.id)) : accounts, succeeded, failed };
}
