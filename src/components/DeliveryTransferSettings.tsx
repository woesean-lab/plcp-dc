import toast from 'react-hot-toast';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRightLeft, Check, LoaderCircle } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { getDeliveryTransferSettings, saveDeliveryTransferSettings, type DeliveryTransferSettings as Settings } from '../lib/integration';
import { COMMUNITY_DELIVERY_TRANSFER_STATUSES, COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES } from '../../shared/community-delivery-transfer.mjs';

const labels: Record<string, string> = { WAITING: 'Waiting', PAUSED: 'Paused', 'INVITES PAUSED': 'Invites paused', ERROR: 'Error', PARTIAL: 'Partial' };
const defaults = () => ({ statuses: [...COMMUNITY_DELIVERY_TRANSFER_DEFAULT_STATUSES] });

export default function DeliveryTransferSettings({ preview = false }: { preview?: boolean }) {
  const id = useId();
  const [saved, setSaved] = useState<Settings | null>(preview ? defaults : null);
  const [draft, setDraft] = useState<Settings>(defaults);
  const [loading, setLoading] = useState(!preview);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load() {
    setLoading(true); setError('');
    try {
      const value = await getDeliveryTransferSettings();
      if (mounted.current) { setSaved(value); setDraft(value); }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Could not load transfer settings.'); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { if (!preview) void load(); }, [preview]);
  const dirty = Boolean(saved && COMMUNITY_DELIVERY_TRANSFER_STATUSES.some(status => draft.statuses.includes(status) !== saved.statuses.includes(status)));
  async function save() {
    if (!saved || !dirty || loading || pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      const value = preview ? draft : await saveDeliveryTransferSettings(draft);
      if (mounted.current) { setSaved(value); setDraft(value); toast.success('Transfer settings saved.'); }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Could not save transfer settings.'); }
    finally { pending.current = false; if (mounted.current) setSaving(false); }
  }
  return <section className="app-panel settings-card" aria-labelledby={`${id}-title`} aria-busy={loading || saving}>
    <header className="settings-card-heading"><span className="monitor-panel-icon" aria-hidden="true"><ArrowRightLeft className="h-4 w-4" /></span>
      <div className="settings-card-title"><span className="app-kicker">Members delivery</span><h3 id={`${id}-title`}>Waiting member transfers</h3></div>
      <Badge variant="secondary">{loading ? 'Loading…' : !saved ? 'Unavailable' : saved.statuses.length ? `${saved.statuses.length} enabled` : 'Disabled'}</Badge>
    </header>
    <form className="settings-connection-form" aria-label="Waiting member transfer settings" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="settings-card-body settings-field-grid">
        <p className="settings-field-note col-span-full">Show the transfer card and allow transfers in the selected order statuses. No selection disables transfers.</p>
        {COMMUNITY_DELIVERY_TRANSFER_STATUSES.map((status, index) => <div className="settings-field" key={status}>
          <div className="settings-field-heading"><span className="field-label" id={`${id}-status-${index}`}>{labels[status]}</span>
            <Switch aria-labelledby={`${id}-status-${index}`} checked={draft.statuses.includes(status)} disabled={loading || saving || !saved}
              onCheckedChange={checked => setDraft(current => ({ statuses: COMMUNITY_DELIVERY_TRANSFER_STATUSES.filter(value => value === status ? checked : current.statuses.includes(value)) }))} />
          </div>
        </div>)}
        <p className="settings-field-note col-span-full">Applies to existing and new Members orders. Support end dates stay unchanged.</p>
        {error ? <p className="text-xs text-[var(--app-danger)] col-span-full" role="alert">{error}</p> : null}
      </div>
      <footer className="settings-card-footer"><div>
        <Button type="submit" size="sm" disabled={loading || saving || !dirty}>{saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}{saving ? 'Saving…' : 'Save transfer settings'}</Button>
        {error && !saved ? <Button type="button" size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>Retry</Button> : null}
        {dirty ? <Button type="button" size="sm" variant="ghost" disabled={saving || loading} onClick={() => { if (saved) { setDraft(saved); setError(''); } }}>Reset</Button> : null}
      </div></footer>
    </form>
  </section>;
}
