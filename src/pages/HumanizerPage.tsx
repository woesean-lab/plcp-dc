import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  CircleAlert,
  ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Users,
  WandSparkles
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getHumanizerCatalog,
  getHumanizerJob,
  getLatestHumanizerJob,
  startHumanizerJob,
  type HumanizerAccount,
  type HumanizerCatalog,
  type HumanizerJob
} from "@/lib/humanizer";

function splitLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function accountLabel(account: HumanizerAccount) {
  return account.displayName || account.username;
}

function readAvatar(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (file.size > 1_000_000) {
      reject(new Error(`${file.name} is larger than 1 MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.readAsDataURL(file);
  });
}

export default function HumanizerPage() {
  const [catalog, setCatalog] = useState<HumanizerCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("all");
  const [search, setSearch] = useState("");
  const [displayNames, setDisplayNames] = useState("");
  const [bios, setBios] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [avatarData, setAvatarData] = useState<Array<{ name: string; data: string }>>([]);
  const [hypesquad, setHypesquad] = useState<"none" | "random" | "bravery" | "brilliance" | "balance">("none");
  const [concurrency, setConcurrency] = useState(2);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<HumanizerJob | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  async function loadCatalog(showToast = false) {
    try {
      if (showToast) setRefreshing(true);
      const next = await getHumanizerCatalog();
      setCatalog(next);
      setSelectedIds((current) => current.filter((id) => next.accounts.some((account) => account.id === id && account.hasToken && account.hasProxy)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Humanizer accounts could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadCatalog();
    void getLatestHumanizerJob().then(setJob).catch(() => {});
  }, []);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    let active = true;
    const poll = async () => {
      try {
        const next = await getHumanizerJob(job.id);
        if (!active) return;
        setJob(next);
        if (next.status === "completed" || next.status === "failed") void loadCatalog();
      } catch {
        // Keep the last useful snapshot while a transient request fails.
      }
    };
    const timer = window.setInterval(() => void poll(), 1_000);
    void poll();
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.status]);

  const visibleAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (catalog?.accounts ?? []).filter((account) => {
      if (categoryId !== "all" && account.categoryId !== categoryId) return false;
      if (!query) return true;
      return [account.username, account.displayName, account.id, account.categoryName]
        .some((value) => String(value ?? "").toLowerCase().includes(query));
    });
  }, [catalog, categoryId, search]);

  const eligibleVisibleIds = visibleAccounts
    .filter((account) => account.hasToken && account.hasProxy)
    .map((account) => account.id);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = eligibleVisibleIds.length > 0 && eligibleVisibleIds.every((id) => selectedSet.has(id));
  const jobActive = job?.status === "queued" || job?.status === "running";
  const configuredChanges = [splitLines(displayNames).length, splitLines(bios).length, splitLines(pronouns).length, avatarData.length, hypesquad === "none" ? 0 : 1]
    .filter(Boolean).length;
  const progress = job?.total ? Math.round((job.completed / job.total) * 100) : 0;

  function toggleAccount(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function handleAvatarFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const nextFiles = [...files].slice(0, Math.max(0, 20 - avatarData.length));
      const next = await Promise.all(nextFiles.map(async (file) => ({ name: file.name, data: await readAvatar(file) })));
      setAvatarData((current) => [...current, ...next].slice(0, 20));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Avatar could not be loaded.");
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  async function handleStart() {
    if (!selectedIds.length) {
      toast.error("Select at least one eligible account.");
      return;
    }
    if (!configuredChanges) {
      toast.error("Add at least one profile change.");
      return;
    }
    try {
      setStarting(true);
      const next = await startHumanizerJob({
        accountIds: selectedIds,
        displayNames: splitLines(displayNames),
        bios: splitLines(bios),
        pronouns: splitLines(pronouns),
        avatars: avatarData.map((avatar) => avatar.data),
        hypesquad: hypesquad === "none" ? null : hypesquad,
        concurrency
      });
      setJob(next);
      toast.success(`Humanizer started for ${next.total} account${next.total === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Humanizer could not be started.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="grid gap-5 pb-10">
      <section className="app-panel overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="stat-icon mt-0.5"><WandSparkles className="h-5 w-5" /></span>
            <div>
              <p className="app-kicker text-[var(--app-accent)]">Account workspace</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Humanizer</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--app-text-secondary)]">
                Apply controlled profile changes to selected Members Stock accounts through each account&apos;s assigned Onliner proxy.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{catalog?.accounts.length ?? 0} accounts</Badge>
            <Badge variant={selectedIds.length ? "success" : "outline"}>{selectedIds.length} selected</Badge>
            <Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={() => void loadCatalog(true)}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,.95fr)]">
        <section className="app-panel min-w-0 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="app-kicker">Target accounts</p>
              <h2 className="mt-2 text-lg font-semibold">Members Stock selection</h2>
            </div>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={!eligibleVisibleIds.length}
              onClick={() => setSelectedIds((current) => allVisibleSelected
                ? current.filter((id) => !eligibleVisibleIds.includes(id))
                : [...new Set([...current, ...eligibleVisibleIds])])}
            >
              <Check className="h-3.5 w-3.5" /> {allVisibleSelected ? "Clear visible" : "Select eligible"}
            </Button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-muted)]" />
              <Input className="pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or ID" />
            </label>
            <select className="humanizer-select" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="all">All categories</option>
              {(catalog?.categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </div>

          <div className="humanizer-account-list mt-4">
            {loading ? (
              <div className="flex min-h-48 items-center justify-center text-sm text-[var(--app-muted)]"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading accounts…</div>
            ) : visibleAccounts.length ? visibleAccounts.map((account) => {
              const eligible = account.hasToken && account.hasProxy;
              return (
                <label key={account.id} className={`humanizer-account-row ${selectedSet.has(account.id) ? "is-selected" : ""} ${eligible ? "" : "is-disabled"}`}>
                  <input type="checkbox" checked={selectedSet.has(account.id)} disabled={!eligible || jobActive} onChange={() => toggleAccount(account.id)} />
                  <span className="humanizer-avatar">
                    {account.avatarUrl ? <img src={account.avatarUrl} alt="" /> : <Users className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">{accountLabel(account)}</strong>
                    <span className="mt-1 block truncate text-[11px] text-[var(--app-muted)]">@{account.username} · {account.categoryName}</span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {!account.hasToken ? <Badge variant="destructive">No token</Badge> : null}
                    {account.hasToken && !account.hasProxy ? <Badge variant="destructive">No proxy</Badge> : null}
                    {account.reserved ? <Badge variant="secondary">In order</Badge> : null}
                    {eligible ? <Badge variant="success">Ready</Badge> : null}
                  </span>
                </label>
              );
            }) : (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-[var(--app-muted)]">
                <Users className="h-5 w-5" /><span>No account matches this filter.</span>
              </div>
            )}
          </div>
        </section>

        <section className="app-panel min-w-0 p-5 sm:p-6">
          <div>
            <p className="app-kicker">Profile recipe</p>
            <h2 className="mt-2 text-lg font-semibold">Choose what changes</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">Values are distributed line-by-line across the selected accounts.</p>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="field-label">Display names · one per line</span>
              <textarea className="onliner-game-textarea min-h-28" value={displayNames} maxLength={16_500} onChange={(event) => setDisplayNames(event.target.value)} placeholder={"Alex\nTaylor\nJordan"} />
              <small className="text-[10px] text-[var(--app-muted)]">{splitLines(displayNames).length} values</small>
            </label>
            <label className="grid gap-2">
              <span className="field-label">Pronouns · one per line</span>
              <textarea className="onliner-game-textarea min-h-28" value={pronouns} maxLength={20_500} onChange={(event) => setPronouns(event.target.value)} placeholder={"they/them\nshe/her\nhe/him"} />
              <small className="text-[10px] text-[var(--app-muted)]">{splitLines(pronouns).length} values</small>
            </label>
            <label className="grid gap-2 sm:col-span-2">
              <span className="field-label">Bios · one per line</span>
              <textarea className="onliner-game-textarea min-h-28" value={bios} maxLength={95_500} onChange={(event) => setBios(event.target.value)} placeholder={"Building something interesting.\nProbably listening to music."} />
              <small className="text-[10px] text-[var(--app-muted)]">{splitLines(bios).length} values</small>
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="humanizer-option-card">
              <span className="humanizer-option-icon"><ImageIcon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><strong>Avatar pool</strong><small>PNG, JPG, WEBP or GIF · max 1 MB</small></span>
              <Button type="button" variant="secondary" size="xs" onClick={() => avatarInputRef.current?.click()}>Choose</Button>
              <input ref={avatarInputRef} className="hidden" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void handleAvatarFiles(event.target.files)} />
            </div>
            <label className="humanizer-option-card">
              <span className="humanizer-option-icon"><Sparkles className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><strong>HypeSquad</strong><small>Leave unchanged or assign a house</small></span>
              <select value={hypesquad} onChange={(event) => setHypesquad(event.target.value as typeof hypesquad)}>
                <option value="none">Unchanged</option>
                <option value="random">Balanced rotation</option>
                <option value="bravery">Bravery</option>
                <option value="brilliance">Brilliance</option>
                <option value="balance">Balance</option>
              </select>
            </label>
          </div>
          {avatarData.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {avatarData.map((avatar, index) => (
                <button key={`${avatar.name}-${index}`} type="button" className="humanizer-file-chip" onClick={() => setAvatarData((current) => current.filter((_, itemIndex) => itemIndex !== index))} title="Remove avatar">
                  {avatar.name}<span>×</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 border-t border-[var(--app-border)] pt-5 sm:flex-row sm:items-end sm:justify-between">
            <label className="grid gap-2">
              <span className="field-label">Parallel accounts</span>
              <select className="humanizer-select w-28" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))}>
                {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <Button type="button" disabled={starting || jobActive || !selectedIds.length || !configuredChanges} onClick={() => void handleStart()}>
              {starting || jobActive ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {jobActive ? "Humanizer running" : `Run for ${selectedIds.length || 0} account${selectedIds.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </section>
      </div>

      {job ? (
        <section className="app-panel overflow-hidden p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="app-kicker">Latest run</p>
              <h2 className="mt-2 flex items-center gap-2 text-lg font-semibold">
                {jobActive ? <LoaderCircle className="h-4 w-4 animate-spin text-[var(--app-accent)]" /> : <BadgeCheck className="h-5 w-5 text-[var(--app-success)]" />}
                {jobActive ? "Updating account profiles" : "Humanizer run finished"}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{job.completed}/{job.total} processed</Badge>
              <Badge variant="success">{job.succeeded} successful</Badge>
              {job.failed ? <Badge variant="destructive">{job.failed} attention</Badge> : null}
            </div>
          </div>
          <div className="humanizer-progress mt-4"><span style={{ width: `${progress}%` }} /></div>
          {job.skipped?.length ? (
            <div className="mt-4 rounded-xl bg-[color-mix(in_srgb,var(--app-danger)_8%,transparent)] px-4 py-3 text-xs leading-5 text-[var(--app-text-secondary)]">
              <strong className="text-[var(--app-danger)]">{job.skipped.length} account skipped before start.</strong>{" "}
              {job.skipped.slice(0, 3).join(" · ")}{job.skipped.length > 3 ? ` · +${job.skipped.length - 3} more` : ""}
            </div>
          ) : null}
          <div className="humanizer-results mt-4">
            {job.results.map((result) => (
              <div key={result.id} className="humanizer-result-row">
                <span className={`humanizer-result-state is-${result.state}`}>
                  {result.state === "running" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : result.state === "success" ? <Check className="h-4 w-4" /> : result.state === "pending" ? <span /> : <CircleAlert className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{result.displayName || result.username}</strong>
                  <small className="mt-1 block text-[11px] leading-4 text-[var(--app-muted)]">
                    {result.error || (result.changed.length
                      ? `${result.changed.join(" · ")}${result.gatewayFallback ? " · Gateway fallback used" : ""}`
                      : result.state === "pending" ? "Waiting" : "No changes reported")}
                  </small>
                </span>
                <Badge variant={result.state === "success" ? "success" : result.state === "failed" || result.state === "partial" ? "destructive" : "secondary"}>{result.state}</Badge>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
