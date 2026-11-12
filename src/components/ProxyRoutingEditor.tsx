import type { ReactNode } from "react";

export function ProxyRoutingEditor({ kicker, title, stats, actions, children }: {
  kicker: string;
  title: string;
  stats: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  return <div className="dcord-proxy-panel proxy-routing-editor">
    <header className="dcord-proxy-header">
      <div><p className="app-kicker">{kicker}</p><h2>{title}</h2></div>
      <div className="dcord-proxy-actions"><span>{stats}</span>{actions}</div>
    </header>
    {children}
  </div>;
}
