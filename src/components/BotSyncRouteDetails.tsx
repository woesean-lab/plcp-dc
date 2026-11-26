import { ChevronDown, Copy, Network } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { PaginatedList } from "./ListPagination";
import type { BotSyncJob, BotSyncRoute } from "../lib/community";

const modes = { authorization: "New OAuth authorization", refresh: "OAuth token refresh", reused: "Saved permission reused", unavailable: "No proxy available", unknown: "Route not recorded" };
const outcomes = { running: "In progress", succeeded: "Synced", failed: "Failed", paused: "Paused" };
const address = (route: BotSyncRoute) => route.transport === "proxy" ? route.endpoint || "Endpoint unavailable" : route.transport === "server" ? "Server connection" : route.mode === "reused" ? "No Discord request" : "No connection";
const source = (route: BotSyncRoute) => route.source === "linked" ? "Account's assigned proxy" : route.source === "pool" ? "Onliner proxy pool" : route.source === "server" ? "Direct server request" : "";

async function copyEndpoint(value: string) {
  try { await navigator.clipboard.writeText(value); toast.success("Proxy address copied."); }
  catch { toast.error("Could not copy the proxy address."); }
}

export function BotSyncRouteDetails({ job }: { job: BotSyncJob }) {
  const route = job.route;
  const history = job.routes ?? [];
  return <section className="app-panel-soft bot-sync-overview bot-sync-route" aria-label="Sync connection route">
    <div className="bot-sync-progress-heading"><h4><Network className="h-4 w-4" aria-hidden="true" />Connection route</h4>{route ? <Badge variant={route.status === "failed" ? "destructive" : route.status === "succeeded" ? "success" : "secondary"}>{outcomes[route.status]}</Badge> : null}</div>
    {route ? <>
      <dl className="bot-sync-route-fields">
        <div><dt>{route.status === "running" ? "Current account" : "Last account"}</dt><dd>{route.userId}</dd></div>
        <div><dt>Operation</dt><dd>{modes[route.mode]}</dd></div>
        <div className="bot-sync-route-endpoint"><dt>{route.transport === "proxy" ? "Proxy endpoint" : "Connection"}</dt><dd><span>{address(route)}</span>{route.transport === "proxy" && route.endpoint ? <span className="community-member-row-actions"><Button type="button" variant="secondary" size="icon-sm" aria-label="Copy proxy address" title="Copy proxy address" onClick={() => void copyEndpoint(route.endpoint!)}><Copy className="h-3.5 w-3.5" /></Button></span> : null}</dd>{source(route) ? <small>{source(route)}</small> : null}</div>
      </dl>
    </> : <p className="settings-field-note">Connection details appear when an account is processed. Earlier requests were not recorded.</p>}
    <p className="settings-field-note">{route?.transport === "proxy" ? "Selected proxy address; public exit IP is not measured. " : route?.transport === "server" ? "Server connection; public IP is not measured. " : ""}Sync does not add accounts to Onliner.</p>
    {history.length ? <details className="bot-sync-route-history">
      <summary>Recent routes <Badge variant="secondary">{history.length}</Badge><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></summary>
      <p className="settings-field-note">Last {history.length} account attempts. Each entry shows its final connection route.</p>
      <div className="bot-sync-route-list"><PaginatedList items={history} label="Sync connection pages">{items => items.map((item, index) => <article key={`${item.userId}:${item.updatedAt}:${index}`}>
        <div><strong>{item.userId}</strong><Badge variant={item.status === "failed" ? "destructive" : item.status === "succeeded" ? "success" : "secondary"}>{outcomes[item.status]}</Badge></div>
        <span>{modes[item.mode]} · {address(item)}</span>
        <small>{source(item)}{source(item) ? " · " : ""}<time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleTimeString()}</time></small>
      </article>)}</PaginatedList></div>
    </details> : null}
  </section>;
}
