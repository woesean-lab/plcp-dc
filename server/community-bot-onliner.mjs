export function planBotOnlinerConnection(current, bot, limit, selectProxy) {
  const existing = current.accounts.find(account => account.communityBotClientId === bot.clientId || account.botToken === bot.botToken);
  if (!existing && current.accounts.length >= limit) {
    throw Object.assign(new Error(`The Onliner supports up to ${limit} account profiles.`), { statusCode: 409 });
  }
  const proxyUrl = existing?.proxyUrl || selectProxy(current);
  if (!proxyUrl) throw Object.assign(new Error("Add an available proxy to the Onliner proxy pool first."), { statusCode: 409 });
  const account = { ...existing, id: existing?.id || `community-bot-${bot.clientId}`,
    botToken: bot.botToken, proxyUrl, richPresenceEnabled: false,
    discordUserId: bot.clientId, communityBotClientId: bot.clientId, communityBotOnlinerEnabled: true };
  return { account, alreadyExisted: Boolean(existing), config: { ...current,
    accounts: existing ? current.accounts.map(item => item.id === existing.id ? account : item) : [...current.accounts, account] } };
}

export function assignMissingBotOnlinerProxies(config, selectProxy) {
  const accounts = [...config.accounts];
  const assignedIds = [];
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index];
    if (account.communityBotOnlinerEnabled !== true || account.proxyUrl) continue;
    const proxyUrl = selectProxy({ ...config, accounts });
    if (!proxyUrl) continue;
    accounts[index] = { ...account, proxyUrl, richPresenceEnabled: false };
    assignedIds.push(account.id);
  }
  return { config: assignedIds.length ? { ...config, accounts } : config, assignedIds };
}
