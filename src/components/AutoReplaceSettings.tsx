import { useEffect, useId, useRef, useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { getAutoReplaceSettings, saveAutoReplaceSettings, type AutoReplaceLimits } from "../lib/integration";

export default function AutoReplaceSettings({ preview = false }: { preview?: boolean }) {
  const id = useId();
  const [saved, setSaved] = useState<AutoReplaceLimits | null>(preview ? { members: 3, boosts: 3 } : null);
  const [draft, setDraft] = useState({ members: "3", boosts: "3" });
  const [loading, setLoading] = useState(!preview);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load() {
    setLoading(true); setError("");
    try {
      const value = preview ? { members: 3, boosts: 3 } : await getAutoReplaceSettings();
      if (!mounted.current) return;
      setSaved(value); setDraft({ members: String(value.members), boosts: String(value.boosts) });
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Could not load auto-replace limits."); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { if (!preview) void load(); }, [preview]);
  const limits = { members: Number(draft.members), boosts: Number(draft.boosts) };
  const valid = Object.entries(draft).every(([key, value]) => value.trim() !== "" && Number.isInteger(limits[key as keyof AutoReplaceLimits]) && Number(value) >= 0 && Number(value) <= 10);
  const dirty = Boolean(saved && (limits.members !== saved.members || limits.boosts !== saved.boosts));
  async function save() {
    if (!valid || !saved || pending.current) return;
    pending.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const value = preview ? limits : await saveAutoReplaceSettings(limits);
      if (mounted.current) { setSaved(value); setNotice("Auto-replace limits saved."); }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : "Could not save auto-replace limits."); }
    finally { pending.current = false; if (mounted.current) setSaving(false); }
  }
  return <section className="app-panel settings-card" aria-labelledby={`${id}-title`} aria-busy={loading || saving}>
    <header className="settings-card-heading"><span className="monitor-panel-icon" aria-hidden="true"><RefreshCw className="h-4 w-4" /></span>
      <div className="settings-card-title"><span className="app-kicker">Delivery automation</span><h3 id={`${id}-title`}>Auto-replace</h3></div>
      <Badge variant="secondary">{loading ? "Loading…" : "Round limits"}</Badge>
    </header>
    <form className="settings-connection-form" aria-label="Auto-replace settings" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="settings-card-body settings-field-grid">
        {(["members", "boosts"] as const).map(key => <label className="settings-field" key={key}>
          <span className="field-label">{key === "members" ? "Members" : "Boosts"} · maximum rounds</span>
          <Input type="number" min={0} max={10} step={1} required disabled={loading || saving || !saved} value={draft[key]}
            onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setNotice(""); }} />
        </label>)}
        <p className="settings-field-note">0 disables auto-replace. Limits apply per order, including existing orders with Auto-replace enabled. Maximum 10 rounds.</p>
        {notice ? <p className="settings-field-note" role="status">{notice}</p> : null}
        {error ? <p className="text-xs text-[var(--app-danger)]" role="alert">{error}</p> : null}
      </div>
      <footer className="settings-card-footer"><div>
        <Button type="submit" size="sm" disabled={loading || saving || !valid || !dirty}>{saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{saving ? "Saving…" : "Save limits"}</Button>
        {error && !saved ? <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>Retry</Button> : null}
        {dirty ? <Button type="button" size="sm" variant="ghost" disabled={saving || loading} onClick={() => { if (saved) setDraft({ members: String(saved.members), boosts: String(saved.boosts) }); setNotice(""); }}>Reset</Button> : null}
      </div></footer>
    </form>
  </section>;
}
