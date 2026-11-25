import { useEffect, useRef, useState } from "react";
import { getCommunityBotPool, type PoolBot } from "../lib/community";
import { Button } from "./ui/button";
import { FilterDropdown } from "./ui/filter-dropdown";
import { Skeleton } from "./ui/skeleton";

export function OAuthBotTargetField({ value, onChange, defaultName = "Default bot", disabled = false, onReadyChange, preview = false }: {
  value: string; onChange: (value: string) => void; defaultName?: string; disabled?: boolean; onReadyChange?: (ready: boolean) => void; preview?: boolean;
}) {
  const [bots, setBots] = useState<PoolBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const change = useRef(onChange); change.current = onChange;
  const ready = useRef(onReadyChange); ready.current = onReadyChange;
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void (preview ? Promise.resolve({ bots: [{ clientId: "1544546102458720277", name: "Members 02" } as PoolBot] }) : getCommunityBotPool())
      .then(result => { if (active) setBots(result.bots); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load bots."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; ready.current?.(false); };
  }, [preview, revision]);
  const missing = Boolean(value && !bots.some(bot => bot.clientId === value));
  useEffect(() => { ready.current?.(!loading && !error && !missing); }, [loading, error, missing]);
  return <div className="settings-field">
    {loading ? <div role="status" aria-label="Loading OAuth bots"><Skeleton className="h-4 w-20" /><Skeleton className="mt-2 h-10 w-full" /></div> : <FilterDropdown label="OAuth bot" value={value} options={[{ value: "", label: `${defaultName} · Default` }, ...bots.map(bot => ({ value: bot.clientId, label: bot.name })), ...(missing ? [{ value, label: "Unavailable bot" }] : [])]} onChange={onChange} disabled={disabled || Boolean(error)} />}
    {error ? <div className="settings-load-error" role="alert"><span>{error}</span><Button type="button" size="xs" variant="secondary" disabled={disabled} onClick={() => setRevision(current => current + 1)}>Retry</Button></div> : missing && !loading ? <div className="settings-load-error" role="alert"><span>This bot is no longer available.</span><Button type="button" size="xs" variant="secondary" disabled={disabled} onClick={() => change.current("")}>Use default</Button></div> : null}
    <p className="settings-field-note">{value ? "OAuth permissions for this bot only. Import attaches them to existing accounts in this category." : "OAuth permissions for the default bot only."}</p>
  </div>;
}
