import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  CircleAlert,
  FileText,
  Gauge,
  ImageIcon,
  Images,
  ListFilter,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Type,
  Upload,
  UserRoundCheck,
  Users,
  WandSparkles,
  Workflow,
  X
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

function HumanizerPageSkeleton() {
  return (
    <div
      className="humanizer-page grid gap-5 pb-10 tab-slide-in"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading Humanizer"
    >
      <span className="sr-only">Loading Humanizer</span>

      <header className="page-heading humanizer-page-heading" aria-hidden="true">
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-3 h-3 w-32" />
          <Skeleton className="h-10 w-52" />
          <Skeleton className="mt-3 h-4 w-full max-w-[680px]" />
        </div>
        <div className="page-heading-meta humanizer-heading-actions">
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-8 w-24" />
        </div>
      </header>

      <section className="app-panel humanizer-overview" aria-hidden="true">
        <div className="humanizer-overview-lead">
          <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-2 h-5 w-40" />
            <Skeleton className="mt-2 h-3 w-64 max-w-full" />
          </div>
        </div>
        {[0, 1, 2].map((item) => (
          <div key={item} className="humanizer-overview-metric">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-10" />
            <Skeleton className="mt-2 h-3 w-28 max-w-full" />
          </div>
        ))}
      </section>

      <section className="app-panel humanizer-workspace" aria-hidden="true">
        <div className="humanizer-workspace-grid">
          <section className="humanizer-pane humanizer-target-pane">
            <header className="humanizer-pane-head">
              <div className="onliner-section-heading min-w-0 flex-1">
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3 w-64 max-w-full" />
                </span>
              </div>
              <Skeleton className="h-7 w-28" />
            </header>

            <div className="humanizer-filterbar">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>

            <div className="humanizer-account-list">
              {Array.from({ length: 7 }, (_, index) => (
                <div key={index} className="humanizer-account-row">
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-36 max-w-full" />
                    <Skeleton className="mt-2 h-3 w-48 max-w-full" />
                  </span>
                  <Skeleton className="h-6 w-14 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
            <footer className="humanizer-pane-foot"><Skeleton className="h-3 w-32" /></footer>
          </section>

          <section className="humanizer-pane humanizer-recipe-pane">
            <header className="humanizer-pane-head">
              <div className="onliner-section-heading min-w-0 flex-1">
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="mt-2 h-3 w-64 max-w-full" />
                </span>
              </div>
              <Skeleton className="h-6 w-16 rounded-full" />
            </header>

            <div className="humanizer-recipe-grid">
              {["name", "pronouns", "bio"].map((recipe) => (
                <div key={recipe} className={`humanizer-recipe-card ${recipe === "bio" ? "is-wide" : ""}`}>
                  <span className="humanizer-recipe-head">
                    <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="mt-2 h-3 w-28" />
                    </span>
                    <Skeleton className="h-5 w-5 rounded-full" />
                  </span>
                  <Skeleton className="h-[82px] w-full" />
                </div>
              ))}
            </div>

            <div className="humanizer-options-grid">
              {[0, 1].map((item) => (
                <div key={item} className="humanizer-option-card">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-2 h-3 w-40 max-w-full" />
                  </span>
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="humanizer-commandbar">
          <div className="humanizer-command-summary min-w-0 flex-1">
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
            <span className="min-w-0 flex-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-3 w-56 max-w-full" />
            </span>
          </div>
          <div className="humanizer-command-actions">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-40" />
          </div>
        </footer>
      </section>
    </div>
  );
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
  const eligibleAccountCount = (catalog?.accounts ?? []).filter((account) => account.hasToken && account.hasProxy).length;

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

  if (loading && !catalog) return <HumanizerPageSkeleton />;

  return (
    <div className="humanizer-page grid gap-5 pb-10 tab-slide-in">
      <header className="page-heading humanizer-page-heading">
        <div>
          <p className="app-kicker">Account workspace</p>
          <h1 className="page-title">Humanizer</h1>
          <p className="app-copy page-copy">Build a profile recipe, choose eligible Members Stock accounts, and apply every update through its assigned Onliner proxy.</p>
        </div>
        <div className="page-heading-meta humanizer-heading-actions">
          <Badge variant={eligibleAccountCount ? "success" : "destructive"}>{eligibleAccountCount} ready</Badge>
          <Badge variant={selectedIds.length ? "default" : "outline"}>{selectedIds.length} selected</Badge>
          <Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={() => void loadCatalog(true)}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </header>

      <section className="app-panel humanizer-overview" aria-label="Humanizer overview">
        <div className="humanizer-overview-lead">
          <span className="humanizer-overview-icon"><Workflow className="h-5 w-5" /></span>
          <div><small>Profile operations</small><strong>{jobActive ? "Run in progress" : "Ready to compose"}</strong><span>{jobActive ? `${progress}% complete across ${job?.total ?? 0} accounts` : "One recipe, safely distributed account by account"}</span></div>
        </div>
        <div className="humanizer-overview-metric"><small>Available</small><strong>{catalog?.accounts.length ?? 0}</strong><span>Members Stock accounts</span></div>
        <div className="humanizer-overview-metric"><small>Selected</small><strong>{selectedIds.length}</strong><span>Queued targets</span></div>
        <div className="humanizer-overview-metric"><small>Recipe</small><strong>{configuredChanges}</strong><span>Configured change types</span></div>
      </section>

      <section className="app-panel humanizer-workspace">
        <div className="humanizer-workspace-grid">
          <section className="humanizer-pane humanizer-target-pane" aria-labelledby="humanizer-target-title">
            <header className="humanizer-pane-head">
              <div className="onliner-section-heading">
                <span className="onliner-section-icon" aria-hidden="true"><Users className="h-4 w-4" /></span>
                <span><strong id="humanizer-target-title">Target accounts</strong><small>Select profiles that have both a saved user token and an assigned proxy.</small></span>
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
            </header>

            <div className="humanizer-filterbar">
            <label className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-muted)]" />
              <Input className="pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or ID" />
            </label>
            <FilterDropdown
              label="Account category"
              showLabel={false}
              className="humanizer-category-dropdown"
              value={categoryId}
              options={[
                { value: "all", label: "All categories" },
                ...(catalog?.categories ?? []).map((category) => ({ value: category.id, label: category.name }))
              ]}
              onChange={setCategoryId}
            />
            </div>

            <div className="humanizer-account-list">
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
            <footer className="humanizer-pane-foot"><ListFilter className="h-3.5 w-3.5" /><span>{visibleAccounts.length} visible · {eligibleVisibleIds.length} eligible</span></footer>
          </section>

          <section className="humanizer-pane humanizer-recipe-pane" aria-labelledby="humanizer-recipe-title">
            <header className="humanizer-pane-head">
              <div className="onliner-section-heading">
                <span className="onliner-section-icon" aria-hidden="true"><WandSparkles className="h-4 w-4" /></span>
                <span><strong id="humanizer-recipe-title">Profile recipe</strong><small>Each list is distributed line-by-line across the selected accounts.</small></span>
              </div>
              <Badge variant={configuredChanges ? "default" : "outline"}>{configuredChanges} active</Badge>
            </header>

            <div className="humanizer-recipe-grid">
              <label className="humanizer-recipe-card" data-recipe="name">
                <span className="humanizer-recipe-head"><i><Type className="h-4 w-4" /></i><span><strong>Display names</strong><small>One value per line</small></span><b>{splitLines(displayNames).length}</b></span>
                <textarea className="onliner-game-textarea" value={displayNames} maxLength={16_500} onChange={(event) => setDisplayNames(event.target.value)} placeholder={"Alex\nTaylor\nJordan"} />
              </label>
              <label className="humanizer-recipe-card" data-recipe="pronouns">
                <span className="humanizer-recipe-head"><i><UserRoundCheck className="h-4 w-4" /></i><span><strong>Pronouns</strong><small>One value per line</small></span><b>{splitLines(pronouns).length}</b></span>
                <textarea className="onliner-game-textarea" value={pronouns} maxLength={20_500} onChange={(event) => setPronouns(event.target.value)} placeholder={"they/them\nshe/her\nhe/him"} />
              </label>
              <label className="humanizer-recipe-card is-wide" data-recipe="bio">
                <span className="humanizer-recipe-head"><i><FileText className="h-4 w-4" /></i><span><strong>Profile bios</strong><small>One value per line</small></span><b>{splitLines(bios).length}</b></span>
                <textarea className="onliner-game-textarea" value={bios} maxLength={95_500} onChange={(event) => setBios(event.target.value)} placeholder={"Building something interesting.\nProbably listening to music."} />
              </label>
            </div>

            <div className="humanizer-options-grid">
              <div className="humanizer-option-card">
                <span className="humanizer-option-icon"><Images className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><strong>Avatar pool</strong><small>PNG, JPG, WEBP or GIF · max 1 MB</small></span>
                <Button type="button" variant="secondary" size="xs" onClick={() => avatarInputRef.current?.click()}><Upload className="h-3.5 w-3.5" /> Choose</Button>
                <input ref={avatarInputRef} className="hidden" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void handleAvatarFiles(event.target.files)} />
              </div>
              <div className="humanizer-option-card">
                <span className="humanizer-option-icon"><Sparkles className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><strong>HypeSquad</strong><small>Leave unchanged or assign a house</small></span>
                <FilterDropdown
                  label="HypeSquad house"
                  showLabel={false}
                  placement="top"
                  className="humanizer-hypesquad-dropdown"
                  value={hypesquad}
                  options={[
                    { value: "none", label: "Unchanged" },
                    { value: "random", label: "Balanced rotation" },
                    { value: "bravery", label: "Bravery" },
                    { value: "brilliance", label: "Brilliance" },
                    { value: "balance", label: "Balance" }
                  ]}
                  onChange={(value) => setHypesquad(value as typeof hypesquad)}
                />
              </div>
            </div>
            {avatarData.length ? (
              <div className="humanizer-file-list">
                {avatarData.map((avatar, index) => (
                  <button key={`${avatar.name}-${index}`} type="button" className="humanizer-file-chip" onClick={() => setAvatarData((current) => current.filter((_, itemIndex) => itemIndex !== index))} title="Remove avatar">
                    <ImageIcon className="h-3.5 w-3.5" />{avatar.name}<X className="h-3 w-3" />
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="humanizer-commandbar">
          <div className="humanizer-command-summary">
            <span className="humanizer-command-icon"><ShieldCheck className="h-4 w-4" /></span>
            <span><strong>Ready to apply</strong><small>{selectedIds.length ? `${selectedIds.length} account${selectedIds.length === 1 ? "" : "s"} selected` : "Select at least one eligible account"} · {configuredChanges ? `${configuredChanges} change type${configuredChanges === 1 ? "" : "s"}` : "Recipe is empty"}</small></span>
          </div>
          <div className="humanizer-command-actions">
            <div className="humanizer-parallel-control">
              <span><Gauge className="h-3.5 w-3.5" /> Parallel</span>
              <FilterDropdown
                label="Parallel accounts"
                showLabel={false}
                placement="top"
                className="humanizer-parallel-dropdown"
                value={String(concurrency)}
                options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }))}
                onChange={(value) => setConcurrency(Number(value))}
              />
            </div>
            <Button type="button" disabled={starting || jobActive || !selectedIds.length || !configuredChanges} onClick={() => void handleStart()}>
              {starting || jobActive ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {jobActive ? "Humanizer running" : `Run ${selectedIds.length || 0} account${selectedIds.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </footer>
      </section>

      {job ? (
        <section className="app-panel humanizer-run-panel">
          <header className="humanizer-run-head">
            <div className="onliner-section-heading">
              <span className="onliner-section-icon" aria-hidden="true">{jobActive ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}</span>
              <span><strong>{jobActive ? "Updating account profiles" : "Latest run completed"}</strong><small>{jobActive ? "Results update live as each account finishes." : "Review every applied change and account requiring attention."}</small></span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{job.completed}/{job.total} processed</Badge>
              <Badge variant="success">{job.succeeded} successful</Badge>
              {job.failed ? <Badge variant="destructive">{job.failed} attention</Badge> : null}
            </div>
          </header>
          <div className="humanizer-run-body">
          <div className="humanizer-progress"><span style={{ width: `${progress}%` }} /></div>
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
                      ? `${result.changed.join(" · ")}${result.gatewayFallback ? " · Onliner Gateway session used" : ""}`
                      : result.state === "pending" ? "Waiting" : "No changes reported")}
                  </small>
                </span>
                <Badge variant={result.state === "success" ? "success" : result.state === "failed" || result.state === "partial" ? "destructive" : "secondary"}>{result.state}</Badge>
              </div>
            ))}
          </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
