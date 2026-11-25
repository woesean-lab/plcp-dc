import { SecretField } from "./ui/secret-field";
import BotPoolSettings from "./BotPoolSettings";
import { useSearchParams } from "react-router-dom";
import { useEffect, useId, useRef, useState, type FormEventHandler, type KeyboardEvent } from "react";
import { Bot, Check, CheckCircle2, KeyRound, LoaderCircle, LockKeyhole, RefreshCw, Settings2, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import type { CommunityBotGuild, CommunityConfig, CommunityConfigInput, CommunityGuildLeaveProgress } from "../lib/community";
import "./SettingsWorkspace.css";
import EldoradoIntegrationSettings from "./EldoradoIntegrationSettings";
import AutoReplaceSettings from "./AutoReplaceSettings";

export type SettingsWorkspaceProps = {
  loading: boolean;
  integrationPreview?: boolean;
  error?: string;
  onRefresh: () => void;
  members: {
    config: CommunityConfig | null;
    draft: CommunityConfigInput;
    onDraftChange: (draft: CommunityConfigInput) => void;
    saving: boolean;
    onSave: FormEventHandler<HTMLFormElement>;
    onRemove: () => void;
  };
  dcord: {
    configured: boolean;
    draft: string;
    onDraftChange: (value: string) => void;
    saving: boolean;
    onSave: FormEventHandler<HTMLFormElement>;
    onRemove: () => void;
  };
  salta7?: SettingsWorkspaceProps["dcord"] & { checking: boolean; onCheck: () => void };
  guilds: {
    items: CommunityBotGuild[];
    loading: boolean;
    error?: string;
    leaving: boolean;
    selected: Record<string, boolean>;
    onSelectionChange: (selected: Record<string, boolean>) => void;
    onOpen: () => void;
    onRefresh: () => void;
    onLeave: () => void;
    progress: CommunityGuildLeaveProgress | null;
  };
};

const SECTIONS = [
  { id: "connections", label: "Connections", description: "APIs & integrations", Icon: Settings2 },
  { id: "bot-pool", label: "Bots", description: "Default bot & pool", Icon: Bot }
] as const;
type Section = typeof SECTIONS[number]["id"];

export function SettingsWorkspaceSkeleton() {
  return <section className="settings-workspace" role="status" aria-busy="true" aria-label="Loading settings">
    <header className="page-heading settings-page-heading"><div><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-10 w-40" /><Skeleton className="mt-3 h-4 w-64 max-w-full" /></div><Skeleton className="h-9 w-36" /></header>
    <div className="settings-layout"><aside className="settings-navigation"><div className="stock-category-tabs settings-section-tabs settings-preference-tabs">{SECTIONS.map(({ id }) => <Skeleton key={id} className="h-16 w-full" />)}</div></aside><div className="settings-content"><Skeleton className="mb-6 h-10 w-56 max-w-full" /><div className="settings-connections-grid">{[0, 1].map((index) => <section key={index} className="app-panel settings-card"><header className="settings-card-heading"><Skeleton className="h-8 w-8" /><Skeleton className="h-7 w-36" /></header><div className="settings-card-body settings-form-skeleton">{Array.from({ length: index === 0 ? 4 : 2 }, (_, field) => <Skeleton key={field} className="h-14 w-full" />)}</div><footer className="settings-card-footer"><Skeleton className="h-9 w-28" /></footer></section>)}</div></div></div>
  </section>;
}

export default function SettingsWorkspace({ loading, error, onRefresh, members, dcord, salta7, guilds, integrationPreview = false }: SettingsWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [integrationConfigured, setIntegrationConfigured] = useState(false);
  const requestedSection = searchParams.get("settings");
  const section: Section = requestedSection === "servers" ? "bot-pool" : SECTIONS.some(item => item.id === requestedSection) ? requestedSection as Section : "connections";
  const [compactNavigation, setCompactNavigation] = useState(false);
  const workspace = useRef<HTMLElement | null>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const config = members.config;
  const membersBusy = loading || members.saving || guilds.leaving;
  const dcordBusy = loading || dcord.saving;
  const membersDirty = members.draft.clientId !== (config?.clientId ?? "") || members.draft.guildId !== (config?.guildId ?? "") || Boolean(members.draft.clientSecret || members.draft.botToken);
  const connectedCount = Number(Boolean(config?.configured)) + Number(dcord.configured) + Number(Boolean(salta7?.configured)) + Number(integrationConfigured);
  const connectionCount = salta7 ? 4 : 3;
  const canSaveMembers = !membersBusy && Boolean(members.draft.clientId.trim())
    && Boolean(config?.hasClientSecret || members.draft.clientSecret.trim()) && Boolean(config?.hasBotToken || members.draft.botToken.trim());
  useEffect(() => {
    const node = workspace.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setCompactNavigation(entry.contentRect.width <= 820));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  function selectSection(next: Section) {
    setSearchParams(current => { const params = new URLSearchParams(current); params.set("settings", next); return params; }, { replace: true });
  }
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = ["ArrowRight", "ArrowDown"].includes(event.key) ? (index + 1) % SECTIONS.length
      : ["ArrowLeft", "ArrowUp"].includes(event.key) ? (index + SECTIONS.length - 1) % SECTIONS.length
      : event.key === "Home" ? 0 : event.key === "End" ? SECTIONS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); selectSection(SECTIONS[next].id); tabs.current[next]?.focus();
  }
  function resetMembers() {
    members.onDraftChange({ clientId: config?.clientId ?? "", guildId: config?.guildId ?? "", clientSecret: "", botToken: "" });
  }

  const defaultBotEditor = (onCancel: () => void) => <form onSubmit={members.onSave} className="settings-connection-form" aria-label="Members bot settings">
    <div className="settings-card-body settings-field-grid">
      <label className="settings-field"><span className="field-label">Client ID</span><Input autoFocus disabled={membersBusy} value={members.draft.clientId} onChange={(event) => members.onDraftChange({ ...members.draft, clientId: event.target.value })} placeholder="Discord application ID" inputMode="numeric" required /></label>
      <label className="settings-field"><span className="field-label">Stock server ID</span><Input disabled={membersBusy} value={members.draft.guildId} onChange={(event) => members.onDraftChange({ ...members.draft, guildId: event.target.value })} placeholder="Discord server ID" inputMode="numeric" /></label>
      <SecretField label="Client secret" saved={config?.hasClientSecret} disabled={membersBusy} value={members.draft.clientSecret} onChange={(event) => members.onDraftChange({ ...members.draft, clientSecret: event.target.value })} placeholder={config?.hasClientSecret ? "Keep saved value" : "Discord client secret"} autoComplete="new-password" />
      <SecretField label="Bot token" saved={config?.hasBotToken} disabled={membersBusy} value={members.draft.botToken} onChange={(event) => members.onDraftChange({ ...members.draft, botToken: event.target.value })} placeholder={config?.hasBotToken ? "Keep saved value" : "Discord bot token"} autoComplete="new-password" />
    </div>
    <div className="settings-form-meta"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Blank secret fields keep the saved values.{membersDirty ? <span className="settings-dirty-dot">Unsaved changes</span> : null}</div>
    <footer className="settings-card-footer"><div><Button type="submit" size="sm" disabled={!canSaveMembers}>{members.saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{members.saving ? "Verifying…" : config?.configured ? "Save changes" : "Verify & save"}</Button><Button type="button" size="sm" variant="secondary" disabled={membersBusy} onClick={onCancel}>Cancel</Button>{membersDirty ? <Button type="button" size="sm" variant="secondary" disabled={membersBusy} onClick={resetMembers}>Reset</Button> : null}</div>{config?.stored ? <Button type="button" size="sm" variant="dangerGhost" disabled={membersBusy} onClick={members.onRemove}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Remove</Button> : null}</footer>
  </form>;

  return <section ref={workspace} className="settings-workspace" aria-label="Workspace settings">
    <header className="page-heading settings-page-heading">
      <div><p className="app-kicker">Workspace</p><h1 className="page-title">Settings</h1><p className="app-copy page-copy">Connections and bot server access.</p></div>
      <div className="settings-heading-actions">
        {loading ? <span className="settings-refreshing" role="status"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Refreshing</span> : <Badge variant={connectedCount === connectionCount ? "success" : "secondary"}>{connectedCount === connectionCount ? <CheckCircle2 aria-hidden="true" /> : <Settings2 aria-hidden="true" />}{connectedCount} / {connectionCount} configured</Badge>}
        <Button type="button" size="sm" variant="secondary" disabled={loading || members.saving || dcord.saving || salta7?.saving || salta7?.checking || guilds.leaving} onClick={onRefresh}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} aria-hidden="true" />Refresh status</Button>
      </div>
    </header>

    <div className="settings-layout">
      <aside className="settings-navigation">
        <span className="app-kicker settings-navigation-label">Preferences</span>
        <div className="stock-category-tabs settings-section-tabs settings-preference-tabs" role="tablist" aria-label="Settings sections" aria-orientation={compactNavigation ? "horizontal" : "vertical"}>{SECTIONS.map(({ id: key, label, description, Icon }, index) => <button
          ref={(node) => { tabs.current[index] = node; }} key={key} id={`${id}-${key}-tab`} type="button" role="tab" className={section === key ? "is-active" : undefined}
          aria-selected={section === key} aria-controls={`${id}-${key}-panel`} tabIndex={section === key ? 0 : -1} onKeyDown={(event) => handleTabKey(event, index)} onClick={() => selectSection(key)}>
          <Icon className="h-4 w-4" aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span>
        </button>)}</div>
        <div className="settings-storage-note"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /><span>Saved credentials are encrypted.</span></div>
      </aside>

      <div className="settings-content">
        {error ? <div className="settings-load-error app-panel-soft" role="alert"><span>{error}</span><Button type="button" variant="secondary" size="xs" disabled={loading} onClick={onRefresh}>Retry</Button></div> : null}
        <div id={`${id}-connections-panel`} role="tabpanel" aria-labelledby={`${id}-connections-tab`} hidden={section !== "connections"} tabIndex={0}>
          <div className="settings-section-heading"><div><h2>Connections</h2><p>Boost APIs, integrations and automation.</p></div><span className="settings-section-index">01</span></div>
          <div className="settings-connections-grid">
            <section className="app-panel settings-card settings-dcord-card" aria-labelledby={`${id}-dcord-title`}>
              <header className="settings-card-heading"><span className="monitor-panel-icon" aria-hidden="true"><KeyRound className="h-4 w-4" /></span><div className="settings-card-title"><span className="app-kicker">Boost delivery</span><h3 id={`${id}-dcord-title`}>Dcord API</h3></div><Badge variant={dcord.configured ? "success" : "secondary"}>{dcord.configured ? "Configured" : "Not configured"}</Badge></header>
              <form onSubmit={dcord.onSave} className="settings-connection-form" aria-label="Dcord settings">
                <div className="settings-card-body">
                  <SecretField label="API key" saved={dcord.configured} disabled={dcordBusy} value={dcord.draft} onChange={(event) => dcord.onDraftChange(event.target.value)} placeholder={dcord.configured ? "Enter a replacement key" : "Paste Dcord API key"} autoComplete="new-password" />
                  <p className="settings-field-note">Connects Boosts orders to Dcord.</p>
                  <div className="settings-credential-state"><span className="settings-credential-icon" aria-hidden="true"><LockKeyhole className="h-4 w-4" /></span><div><strong>{dcord.configured ? "Key stored securely" : "No key saved"}</strong><p>{dcord.configured ? "The saved key is never displayed." : "A key is required for boost delivery."}</p></div></div>
                </div>
                <footer className="settings-card-footer"><div><Button type="submit" size="sm" disabled={dcordBusy || !dcord.draft.trim()}>{dcord.saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{dcord.saving ? "Saving…" : dcord.configured ? "Replace key" : "Save key"}</Button>{dcord.draft ? <Button type="button" size="sm" variant="ghost" disabled={dcordBusy} onClick={() => dcord.onDraftChange("")}>Reset</Button> : null}</div>{dcord.configured ? <Button type="button" size="sm" variant="dangerGhost" disabled={dcordBusy} onClick={dcord.onRemove}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Remove</Button> : null}</footer>
              </form>
            </section>
            {salta7 ? <section className="app-panel settings-card settings-dcord-card" aria-labelledby={`${id}-salta7-title`}>
              <header className="settings-card-heading"><span className="monitor-panel-icon" aria-hidden="true"><KeyRound className="h-4 w-4" /></span><div className="settings-card-title"><span className="app-kicker">Boost delivery</span><h3 id={`${id}-salta7-title`}>Salta7 API</h3></div><Badge variant={salta7.configured ? "success" : "secondary"}>{salta7.configured ? "Configured" : "Not configured"}</Badge></header>
              <form onSubmit={salta7.onSave} className="settings-connection-form" aria-label="Salta7 settings">
                <div className="settings-card-body"><SecretField label="API key" saved={salta7.configured} disabled={loading || salta7.saving || salta7.checking} value={salta7.draft} onChange={event => salta7.onDraftChange(event.target.value)} placeholder={salta7.configured ? "Enter a replacement key" : "Paste Salta7 API key"} autoComplete="new-password" /><p className="settings-field-note">Uses Boost Stock tokens without sending proxies.</p></div>
                <footer className="settings-card-footer"><div><Button type="submit" size="sm" disabled={loading || salta7.saving || salta7.checking || !salta7.draft.trim()}>{salta7.saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{salta7.saving ? "Verifying…" : "Verify & save"}</Button><Button type="button" size="sm" variant="secondary" disabled={loading || salta7.saving || salta7.checking || !salta7.configured} onClick={salta7.onCheck}>{salta7.checking ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check</Button></div>{salta7.configured ? <Button type="button" size="sm" variant="dangerGhost" disabled={loading || salta7.saving || salta7.checking} onClick={salta7.onRemove}><Trash2 className="h-3.5 w-3.5" />Remove</Button> : null}</footer>
              </form>
            </section> : null}
            <EldoradoIntegrationSettings preview={integrationPreview} onConfigured={setIntegrationConfigured} />
            <AutoReplaceSettings preview={integrationPreview} />
          </div>
        </div>

        <div id={`${id}-bot-pool-panel`} role="tabpanel" aria-labelledby={`${id}-bot-pool-tab`} hidden={section !== "bot-pool"} tabIndex={0}>
          <div className="settings-section-heading"><div><h2>Bots</h2><p>Manage the default bot and pool bots together.</p></div><span className="settings-section-index">02</span></div>
          {section === "bot-pool" ? <BotPoolSettings preview={integrationPreview} defaultConfig={config} defaultEditor={defaultBotEditor} disabled={membersBusy} onRefreshDefault={onRefresh} openDefaultServers={requestedSection === "servers"} /> : null}

        </div>


      </div>
    </div>
  </section>;
}
