import { useEffect, useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { PaginatedList } from "./ListPagination";
import type { PoolBot } from "../lib/community";
import "./BotDirectory.css";

export type DirectoryBot = PoolBot & { isDefault?: boolean; serverCount?: string };
const count = (value = 0) => value.toLocaleString("en-US");

export function BotDirectory({ bots, loading = false, actions, accountActions, status }: {
  bots: DirectoryBot[]; loading?: boolean; actions: (bot: DirectoryBot) => ReactNode; accountActions?: (bot: DirectoryBot) => ReactNode;
  status?: (bot: DirectoryBot) => ReactNode;
}) {
  return <div className="bot-directory app-panel-soft" aria-busy={loading}>
    <PaginatedList items={loading ? [] : bots} label="Bot pages">{items => <table className="bot-directory-table" aria-label="Members bots">
      <thead><tr><th scope="col">Bot</th><th scope="col">Accounts</th><th scope="col">Delivered</th><th scope="col">Orders</th><th scope="col">Remaining</th><th scope="col">Process members</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{loading ? [0, 1, 2].map(index => <tr key={index} className="bot-directory-skeleton">
        <td><div className="bot-directory-identity"><Skeleton className="h-9 w-9 shrink-0 rounded-lg" /><div className="bot-directory-copy"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-36 max-w-full" /></div></div></td>
        {[0, 1, 2, 3, 4].map(metric => <td key={metric}><Skeleton className="h-4 w-12" /><Skeleton className="mt-2 h-3 w-14" /></td>)}<td><Skeleton className="h-8 w-24" /></td>
      </tr>) : items.map(bot => {
        const accountAction = accountActions?.(bot);
        return <tr key={bot.isDefault ? "default" : bot.clientId}>
        <td><div className="bot-directory-identity"><BotAvatar url={bot.avatarUrl} /><div className="bot-directory-copy">
          <div className="bot-directory-name"><strong>{bot.name}</strong>{bot.isDefault ? <Badge variant="secondary">Default</Badge> : null}<Badge variant={bot.enabled ? "success" : "secondary"}>{bot.isDefault ? bot.enabled ? "Configured" : "Not configured" : bot.enabled ? "Enabled" : "Disabled"}</Badge></div>
          <span className="bot-directory-id">{bot.clientId === "default" ? "Set up the default bot" : bot.clientId}</span>
          {bot.serverCount ? <span className="bot-directory-detail">{bot.serverCount} servers</span> : null}
          {status ? <div className="flex flex-wrap gap-2">{status(bot)}</div> : null}
        </div></div></td>
        <td><span className="bot-directory-mobile-label">Accounts</span><strong className="bot-directory-number">{count(bot.authorizedAccounts)}</strong><span className="bot-directory-detail">{count(bot.activeAccounts)} unexpired</span>{accountAction ? <div className="bot-directory-account-actions">{accountAction}</div> : null}</td>
        <td><span className="bot-directory-mobile-label">Delivered</span><strong className="bot-directory-number" data-tone="success">{count(bot.deliveredMembers)}</strong><span className="bot-directory-detail">members</span></td>
        <td><span className="bot-directory-mobile-label">Orders</span><strong className="bot-directory-number">{count(bot.totalOrders)}</strong><span className="bot-directory-detail">{count(bot.activeOrders)} active</span></td>
        <td><span className="bot-directory-mobile-label">Remaining</span><strong className="bot-directory-number">{count(bot.pendingMembers)}</strong><span className="bot-directory-detail">members</span></td>
        <td><span className="bot-directory-mobile-label">Process members</span><strong className="bot-directory-number">{count(bot.processMembers)}</strong><span className="bot-directory-detail">{count(bot.processOrders)} in progress</span></td>
        <td><span className="community-member-row-actions">{actions(bot)}</span></td>
      </tr>; })}</tbody>
    </table>}</PaginatedList>
    {loading ? <span className="sr-only" role="status">Loading bots</span> : null}
  </div>;
}

function BotAvatar({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className="settings-bot-avatar" aria-hidden="true">{url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : <Bot className="h-5 w-5" />}</span>;
}
