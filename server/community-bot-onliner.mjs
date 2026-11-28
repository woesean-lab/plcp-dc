export function planBotOnlinerConnection(current, bot, limit) {
  const existing = current.accounts.find(account => account.communityBotClientId === bot.clientId || account.botToken === bot.botToken);
  if (!existing && current.accounts.length >= limit) {
    throw Object.assign(new Error(`The Onliner supports up to ${limit} account profiles.`), { statusCode: 409 });
  }
  const account = { ...existing, id: existing?.id || `community-bot-${bot.clientId}`,
    botToken: bot.botToken, proxyUrl: "", richPresenceEnabled: false,
    discordUserId: bot.clientId, communityBotClientId: bot.clientId, communityBotOnlinerEnabled: true };
  return { account, alreadyExisted: Boolean(existing), config: { ...current,
    accounts: existing ? current.accounts.map(item => item.id === existing.id ? account : item) : [...current.accounts, account] } };
}
