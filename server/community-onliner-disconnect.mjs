// Resolve explicit links and legacy identities without touching unrelated profiles.
export function planCommunityOnlinerDisconnect(accounts, runtimes, userIds) {
  const selected = new Set(userIds);
  const runtimeUsers = new Map(runtimes.map((row) => [String(row.account_id), String(row.payload?.bot?.id ?? "")]));
  const removedIds = [];
  const removedUsers = new Set();
  const recoverableTokens = new Map();
  for (const account of accounts) {
    const matches = [account.discordUserId, runtimeUsers.get(account.id)].filter((id) => selected.has(id));
    if (!matches.length) continue;
    removedIds.push(account.id);
    for (const id of matches) {
      removedUsers.add(id);
      if (account.botToken && !recoverableTokens.has(id)) recoverableTokens.set(id, account.botToken);
    }
  }
  const removed = new Set(removedIds);
  return { removedIds, removedUsers: [...removedUsers], recoverableTokens,
    remainingAccounts: accounts.filter((account) => !removed.has(account.id)) };
}
