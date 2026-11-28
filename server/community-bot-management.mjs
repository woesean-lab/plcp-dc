export function createManagedBotResolver({ getSharedConfig, loadPoolConfig }) {
  return async clientId => {
    const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
    if (!/^\d{16,22}$/.test(String(clientId || ""))) throw fail("A valid bot application is required.", 400);
    const shared = await getSharedConfig();
    const config = clientId === shared.clientId ? shared : { ...await loadPoolConfig(clientId), guildId: shared.guildId };
    if (config.clientId !== clientId || !config.botToken) throw fail("Configure this bot before managing it.", 409);
    return { ...config, configured: true };
  };
}

export function withoutManagedBotProfiles(config) {
  if (!Array.isArray(config?.accounts)) return config;
  return { ...config, accounts: config.accounts.filter(account => !/^\d{16,22}$/.test(String(account?.communityBotClientId || ""))) };
}
