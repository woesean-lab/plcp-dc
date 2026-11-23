import { tokenIdentity } from "./rotating-boost-stock.mjs";

// Retire legacy Rotating profiles without touching Members or other Boost profiles.
export function createRotatingBoostOnliner({ stock, readConfig, writeConfig }) {
  async function detach(rows, client) {
    const identities = new Set(rows.map(row => tokenIdentity(row.token)));
    const current = await readConfig(client);
    const removedIds = current.accounts.filter(account => identities.has(tokenIdentity(account.botToken))).map(account => account.id);
    const removed = new Set(removedIds);
    const config = { ...current, accounts: current.accounts.filter(account => !removed.has(account.id)) };
    if (removedIds.length) {
      await writeConfig(client, config);
      await client.query("DELETE FROM discord_onliner_runtime WHERE account_id = ANY($1::text[])", [removedIds]);
    }
    return { config, removedIds };
  }
  return {
    retire: () => stock.withAccounts(detach),
    remove: id => stock.remove(id, (row, client) => detach([row], client)),
    removeMany: ids => stock.removeMany(ids, detach)
  };
}
