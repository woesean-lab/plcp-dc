import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, KeyRound, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SecretField } from "./ui/secret-field";
import { Skeleton } from "./ui/skeleton";
import { getSolarixConfig, getSolarixStock, removeSolarixConfig, saveSolarixConfig, type SolarixConfig } from "../lib/solarix-aio";

export default function SolarixSettings({ preview = false, onConfigured }: { preview?: boolean; onConfigured?: (value: boolean) => void }) {
  const id = useId();
  const [config, setConfig] = useState<SolarixConfig | null>(null);
  const [slug, setSlug] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "check" | "remove" | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void (preview ? Promise.resolve({ configured: false, slug: "", secretSuffix: "" }) : getSolarixConfig(controller.signal))
      .then(value => { if (!controller.signal.aborted) { setConfig(value); setSlug(current => current || value.slug); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load SolarixAIO settings."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [preview, revision]);
  useEffect(() => { onConfigured?.(Boolean(config?.configured)); }, [config?.configured, onConfigured]);
  async function act(action: "save" | "check" | "remove", event?: FormEvent) {
    event?.preventDefault(); if (pending.current || loading || !config) return;
    pending.current = true; setBusy(action); setError("");
    try {
      if (action === "check") {
        if (!preview) await getSolarixStock();
        if (mounted.current) toast.success("SolarixAIO stock is reachable.");
      } else {
        let next: SolarixConfig;
        if (action === "remove") {
          if (!preview) await removeSolarixConfig();
          next = { configured: false, slug: "", secretSuffix: "" };
        } else next = preview ? { configured: true, slug: slug.trim(), secretSuffix: "DEMO" } : await saveSolarixConfig(slug.trim(), secret.trim());
        if (mounted.current) { setConfig(next); setSlug(next.slug); setSecret(""); toast.success(action === "remove" ? "SolarixAIO connection removed." : "SolarixAIO connection saved."); }
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not update SolarixAIO."); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  }
  const disabled = loading || Boolean(busy);
  return <section className="app-panel settings-card" aria-labelledby={`${id}-title`} aria-busy={disabled}>
    <header className="settings-card-heading"><span className="monitor-panel-icon" aria-hidden="true"><KeyRound className="h-4 w-4" /></span><div className="settings-card-title"><span className="app-kicker">Boost delivery</span><h3 id={`${id}-title`}>SolarixAIO</h3></div><Badge variant={config?.configured ? "success" : "secondary"}>{loading ? "Loading…" : config?.configured ? "Configured" : "Not configured"}</Badge></header>
    <form onSubmit={event => void act("save", event)}>
      <div className="settings-card-body solarix-body">
        {loading ? <div role="status" aria-label="Loading SolarixAIO settings"><Skeleton className="h-12 w-full" /><Skeleton className="mt-4 h-12 w-full" /></div> : <>
          <label className="settings-field"><span className="field-label">Integration slug</span><Input autoComplete="off" required value={slug} disabled={disabled || !config} onChange={event => setSlug(event.target.value)} placeholder="Your integration slug" /></label>
          <SecretField label="Secret" saved={config?.configured} required disabled={disabled || !config} value={secret} onChange={event => setSecret(event.target.value)} autoComplete="new-password" placeholder={config?.configured ? "Enter a replacement secret" : "Paste SolarixAIO secret"} />
          <p className="settings-field-note">Uses stock from your SolarixAIO Boost Bot integration.{config?.configured ? ` Saved secret · ••••${config.secretSuffix}` : ""}</p>
        </>}
        {error ? <div className="settings-load-error app-panel-soft" role="alert"><span>{error}</span>{!config ? <Button type="button" variant="secondary" size="xs" disabled={disabled} onClick={() => setRevision(value => value + 1)}>Retry</Button> : null}</div> : null}
      </div>
      <footer className="settings-card-footer"><div><Button type="submit" size="sm" disabled={disabled || !config || !slug.trim() || !secret.trim()}>{busy === "save" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Verify & save</Button><Button type="button" size="sm" variant="secondary" disabled={disabled || !config?.configured} onClick={() => void act("check")}>{busy === "check" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check</Button></div>{config?.configured ? <Button type="button" size="sm" variant="dangerGhost" disabled={disabled} onClick={() => void act("remove")}><Trash2 className="h-3.5 w-3.5" />Remove</Button> : null}</footer>
    </form>
  </section>;
}

export function SolarixSetupLink({ onClick }: { onClick?: () => void }) {
  return <Button asChild size="sm" variant="secondary"><Link to="/manage?tab=settings&settings=connections" onClick={onClick}>Configure SolarixAIO</Link></Button>;
}
