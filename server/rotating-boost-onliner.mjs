import crypto from "node:crypto";
import { tokenIdentity } from "./rotating-boost-stock.mjs";

const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode }); };
const matches = (account, row) => tokenIdentity(account.botToken) === tokenIdentity(row.token);

export function attachRotatingOnliner(accounts, config, snapshot) {
  const profiles = new Map(config.accounts.map((account) => [tokenIdentity(account.botToken), account]));
  const runtimes = new Map(snapshot.accounts.map((account) => [account.id, account]));
  return accounts.map((row) => {
    const profile = profiles.get(tokenIdentity(row.token));
    const runtime = profile ? runtimes.get(profile.id) : null;
    return { ...row, onlinerConnected: Boolean(profile),
      onlinerConnectionState: profile ? config.enabled === false ? "disabled" : runtime?.connectionState ?? "disconnected" : null,
      onlinerLastError: runtime?.lastError ?? null };
  });
}

export function createRotatingBoostOnliner({ stock, readConfig, writeConfig, accountLimit }) {
  async function detach(row, client) {
    const current = await readConfig(client);
    const removedIds = current.accounts.filter((account) => matches(account, row)).map((account) => account.id);
    const config = { ...current, accounts: current.accounts.filter((account) => !removedIds.includes(account.id)) };
    if (removedIds.length) {
      await writeConfig(client, config);
      await client.query("DELETE FROM discord_onliner_runtime WHERE account_id = ANY($1::text[])", [removedIds]);
    }
    return { config, removedIds };
  }
  return {
    connect: (id) => stock.withAccount(id, async (row, client) => {
      if (!row.proxy) fail("This account has no assigned fixed proxy. A proxy is assigned on its first delivery.");
      const current = await readConfig(client);
      if (current.enabled === false) fail("Enable Onliner before connecting a Rotating account.");
      const existing = current.accounts.find((account) => matches(account, row));
      if (!existing && current.accounts.length >= accountLimit) fail(`The Onliner supports up to ${accountLimit} account profiles.`);
      const account = { ...(existing ?? {}), id: existing?.id ?? crypto.randomUUID(),
        botToken: tokenIdentity(row.token), proxyUrl: row.proxy, richPresenceEnabled: false };
      const config = { ...current, accounts: existing
        ? current.accounts.map((item) => item.id === existing.id ? account : item)
        : [...current.accounts, account] };
      await writeConfig(client, config);
      return { config, account, removedIds: [] };
    }),
    disconnect: (id) => stock.withAccount(id, detach),
    remove: (id) => stock.remove(id, detach)
  };
}
