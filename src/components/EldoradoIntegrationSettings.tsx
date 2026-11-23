import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Settings = { configured: boolean; keySuffix: string; publicBase: string; revision: number; updatedAt?: string; apiKey?: string };
const endpoint = "/api/admin/eldorado-integration";
async function requestSettings(path = endpoint, init?: RequestInit): Promise<Settings> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || "Could not update integration settings."), { status: response.status });
  return data;
}

export default function EldoradoIntegrationSettings({ preview = false, onConfigured }: {
  preview?: boolean; onConfigured?: (configured: boolean) => void;
}) {
  const id = useId();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const load = preview ? Promise.resolve({ configured: false, keySuffix: "", publicBase: "https://monitor.example.com", revision: 0 }) : requestSettings();
    void load.then(data => {
      if (!active) return;
      setSettings(data); setOrigin(data.publicBase || window.location.origin);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; mounted.current = false; };
  }, [preview]);
  useEffect(() => { onConfigured?.(Boolean(settings?.configured)); }, [settings?.configured, onConfigured]);
  useEffect(() => {
    if (!confirming) return;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [confirming]);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true); setError("");
    try {
      const data = preview ? settings : await requestSettings();
      if (mounted.current && data) { setSettings(data); setOrigin(data.publicBase || window.location.origin); }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Could not load settings."); }
    finally { inFlight.current = false; if (mounted.current) setLoading(false); }
  }
  async function save(generate: boolean) {
    if (inFlight.current || !settings || loading) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const data: Settings = preview
        ? { ...settings, configured: generate || settings.configured, publicBase: origin, revision: settings.revision + 1,
          keySuffix: generate ? "DEMO" : settings.keySuffix, ...(generate ? { apiKey: "preview_only_not_a_real_key_DEMO" } : {}) }
        : await requestSettings(generate ? `${endpoint}/key` : endpoint, {
          method: generate ? "POST" : "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicBase: origin, revision: settings.revision, rotate: confirming }),
        });
      if (!mounted.current) return;
      const { apiKey: generatedKey, ...safeSettings } = data;
      setSettings(safeSettings); setOrigin(safeSettings.publicBase);
      if (generatedKey) { setApiKey(generatedKey); setCopied(false); }
      setNotice(generate ? "API key created. Copy it to plcp-mng Admin." : "Monitor URL saved.");
      setConfirming(false);
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "Could not save settings.");
        if ((err as { status?: number }).status === 409 && !preview) {
          try { const data = await requestSettings(); if (mounted.current) setSettings(data); } catch { /* Keep the error visible; Refresh retries. */ }
        }
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function copyKey() {
    try { await navigator.clipboard.writeText(apiKey); if (mounted.current) setCopied(true); }
    catch { if (mounted.current) setError("Copy is unavailable. Select and copy the displayed key."); }
  }
  const disabled = loading || busy;
  return <section className="app-panel settings-card" aria-labelledby={`${id}-title`} aria-busy={disabled}>
    <header className="settings-card-heading">
      <span className="monitor-panel-icon" aria-hidden="true"><KeyRound className="h-4 w-4" /></span>
      <div className="settings-card-title"><span className="app-kicker">Members & Boosts automation</span><h3 id={`${id}-title`}>plcp-mng integration</h3></div>
      <Badge variant={settings?.configured ? "success" : "secondary"}>{loading ? "Loading…" : settings?.configured ? "Configured" : "Not configured"}</Badge>
    </header>
    <form className="settings-connection-form" onSubmit={event => { event.preventDefault(); void save(false); }}>
      <div className="settings-card-body grid gap-4">
        <label className="settings-field" htmlFor={`${id}-origin`}><span className="field-label">Public monitor URL</span>
          <Input id={`${id}-origin`} type="url" required placeholder="https://monitor.example.com" disabled={disabled || !settings} value={origin} onChange={event => setOrigin(event.target.value)} />
        </label>
        <p className="settings-field-note">Customer monitor links use this address.</p>
        {settings?.configured && !apiKey ? <p className="settings-field-note">Saved key · ••••{settings.keySuffix}</p> : null}
        {apiKey ? <div className="app-panel-soft grid min-w-0 gap-3 p-4" role="status">
          <label className="settings-field" htmlFor={`${id}-key`}><span className="field-label">New API key</span>
            <Input id={`${id}-key`} value={apiKey} readOnly autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} className="font-mono" />
          </label>
          <p className="settings-field-note">Shown once. Paste it into plcp-mng Admin → plcp-dc.</p>
          <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => void copyKey()}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy key"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setApiKey(""); setNotice(""); }}>Hide key</Button></div>
        </div> : null}
        {notice ? <p className="settings-field-note" role="status">{notice}</p> : null}
        {error && !confirming ? <p className="text-xs text-[var(--app-danger)]" role="alert">{error}</p> : null}
      </div>
      <footer className="settings-card-footer"><div>
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || !settings || !origin.trim() || origin === settings.publicBase}><Check className="h-3.5 w-3.5" />Save URL</Button>
        <Button type="button" size="sm" disabled={disabled || !settings || !origin.trim() || Boolean(apiKey)} onClick={() => {
          if (settings?.configured) { setError(""); setConfirming(true); } else void save(true);
        }}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}{settings?.configured ? "Rotate API key" : "Generate API key"}</Button>
      </div><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => void refresh()}><RefreshCw className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`} />Refresh</Button></footer>
    </form>
    {confirming ? <dialog ref={dialog} className="confirm-modal fixed inset-0 m-auto max-h-[calc(100dvh-32px)] overflow-y-auto text-[var(--app-text)] backdrop:bg-[var(--app-overlay-bg)] backdrop:backdrop-blur-md"
      aria-labelledby={`${id}-confirm-title`} aria-describedby={`${id}-confirm-description`}
      onCancel={event => { if (inFlight.current) event.preventDefault(); }} onClose={() => setConfirming(false)}>
      <span className="confirm-modal-icon" aria-hidden="true"><KeyRound className="h-5 w-5" /></span>
      <p className="app-kicker">plcp-mng integration</p><h2 id={`${id}-confirm-title`}>Replace the API key?</h2>
      <p id={`${id}-confirm-description`}>The old key stops working immediately. Update the key in plcp-mng Admin to reconnect the worker.</p>
      {error ? <p className="mt-4 text-xs text-[var(--app-danger)]" role="alert">{error}</p> : null}
      <div className="confirm-modal-actions"><Button autoFocus type="button" variant="secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => void save(true)}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{busy ? "Replacing…" : "Replace key"}</Button></div>
    </dialog> : null}
  </section>;
}
