import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AtSign,
  BadgeCheck,
  Check,
  CircleAlert,
  FileText,
  Gauge,
  Images,
  ListFilter,
  LoaderCircle,
  PackageOpen,
  Play,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  Sparkles,
  Type,
  Trash2,
  Upload,
  UserRoundCheck,
  Users,
  WandSparkles,
  Workflow
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  deleteHumanizerAvatar,
  deleteHumanizerPackage,
  getHumanizerCatalog,
  getHumanizerJob,
  getLatestHumanizerJob,
  getHumanizerPackages,
  saveHumanizerPackage,
  startHumanizerJob,
  uploadHumanizerAvatar,
  type HumanizerAccount,
  type HumanizerAvatar,
  type HumanizerCatalog,
  type HumanizerField,
  type HumanizerJob,
  type HumanizerPackage
} from "@/lib/humanizer";

function splitLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function accountLabel(account: HumanizerAccount) {
  return account.displayName || account.username;
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

            <div className="humanizer-package-panel">
              <div className="humanizer-package-copy">
                <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                <span className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="mt-2 h-3 w-48 max-w-full" />
                </span>
                <Skeleton className="h-6 w-8 rounded-full" />
              </div>
              <div className="humanizer-package-controls">
                <Skeleton className="h-[34px] w-full" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-[34px] w-full" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-8" />
              </div>
            </div>

            <div className="humanizer-recipe-grid">
              {["username", "name", "pronouns", "bio"].map((recipe) => (
                <div key={recipe} className="humanizer-recipe-card">
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

            <div className="humanizer-avatar-pool-panel">
              <div className="humanizer-avatar-pool-head">
                <div className="humanizer-avatar-pool-copy">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-2 h-3 w-44 max-w-full" />
                  </span>
                  <Skeleton className="h-6 w-14 rounded-full" />
                </div>
                <div className="humanizer-avatar-pool-actions">
                  <Skeleton className="h-8 w-36" />
                  <Skeleton className="h-8 w-28" />
                </div>
              </div>
              <div className="humanizer-avatar-pool-body">
                <div className="humanizer-avatar-preview-grid">
                  {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-[166px] w-full" />)}
                </div>
              </div>
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
  const [usernames, setUsernames] = useState("");
  const [displayNames, setDisplayNames] = useState("");
  const [bios, setBios] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [avatarData, setAvatarData] = useState<HumanizerAvatar[]>([]);
  const [selectedFields, setSelectedFields] = useState<HumanizerField[]>([]);
  const [uploadingAvatars, setUploadingAvatars] = useState(0);
  const [avatarPreviewLimit, setAvatarPreviewLimit] = useState(60);
  const [hypesquad, setHypesquad] = useState<"none" | "random" | "bravery" | "brilliance" | "balance">("none");
  const [concurrency, setConcurrency] = useState(2);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<HumanizerJob | null>(null);
  const [packages, setPackages] = useState<HumanizerPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [packageName, setPackageName] = useState("");
  const [savingPackage, setSavingPackage] = useState(false);
  const [deletingPackage, setDeletingPackage] = useState(false);
  const [packageModal, setPackageModal] = useState<"save" | "delete" | null>(null);
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
    void getHumanizerPackages()
      .then((next) => {
        setPackages(next);
        if (next[0]) setSelectedPackageId(next[0].id);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Saved packages could not be loaded."))
      .finally(() => setPackagesLoading(false));
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

  useEffect(() => {
    if (!packageModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingPackage && !deletingPackage) setPackageModal(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [packageModal, savingPackage, deletingPackage]);

  const visibleAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (catalog?.accounts ?? [])
      .filter((account) => {
        if (categoryId !== "all" && account.categoryId !== categoryId) return false;
        if (!query) return true;
        return [account.username, account.displayName, account.id, account.categoryName]
          .some((value) => String(value ?? "").toLowerCase().includes(query));
      })
      .sort((left, right) => (
        accountLabel(left).localeCompare(accountLabel(right), undefined, { sensitivity: "base", numeric: true })
        || left.username.localeCompare(right.username, undefined, { sensitivity: "base", numeric: true })
        || left.id.localeCompare(right.id)
      ));
  }, [catalog, categoryId, search]);

  const eligibleVisibleIds = visibleAccounts
    .filter((account) => account.hasToken && account.hasProxy)
    .map((account) => account.id);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = eligibleVisibleIds.length > 0 && eligibleVisibleIds.every((id) => selectedSet.has(id));
  const jobActive = job?.status === "queued" || job?.status === "running";
  const fieldContent: Record<HumanizerField, boolean> = {
    username: splitLines(usernames).length > 0,
    displayName: splitLines(displayNames).length > 0,
    bio: splitLines(bios).length > 0,
    pronouns: splitLines(pronouns).length > 0,
    avatar: avatarData.length > 0,
    hypesquad: hypesquad !== "none"
  };
  const activeFields = selectedFields.filter((field) => fieldContent[field]);
  const configuredChanges = activeFields.length;
  const progress = job?.total ? Math.round((job.completed / job.total) * 100) : 0;
  const eligibleAccountCount = (catalog?.accounts ?? []).filter((account) => account.hasToken && account.hasProxy).length;
  const selectedPackage = packages.find((item) => item.id === selectedPackageId) ?? null;
  const packageToOverwrite = packages.find((item) => item.name.localeCompare(packageName.trim(), undefined, { sensitivity: "accent" }) === 0) ?? null;

  function toggleAccount(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function setFieldEnabled(field: HumanizerField, enabled: boolean) {
    setSelectedFields((current) => enabled
      ? current.includes(field) ? current : [...current, field]
      : current.filter((item) => item !== field));
  }

  function updateLineField(field: HumanizerField, value: string, setter: (next: string) => void) {
    setter(value);
    setFieldEnabled(field, splitLines(value).length > 0);
  }

  function updateHypesquad(value: typeof hypesquad) {
    setHypesquad(value);
    setFieldEnabled("hypesquad", value !== "none");
  }

  async function handleAvatarFiles(files: FileList | null) {
    if (!files?.length) return;
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    const availableSlots = Math.max(0, 1000 - avatarData.length);
    const submitted = [...files];
    const eligible = submitted.filter((file) => allowedTypes.has(file.type) && file.size > 0 && file.size <= 1_000_000).slice(0, availableSlots);
    const rejectedCount = submitted.length - eligible.length;
    if (!eligible.length) {
      toast.error(availableSlots ? "Choose PNG, JPG, WEBP or GIF files up to 1 MB." : "The avatar pool already contains 1,000 images.");
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }

    setUploadingAvatars(eligible.length);
    const uploaded: Array<HumanizerAvatar | null> = Array.from({ length: eligible.length }, () => null);
    const failures: string[] = [];
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(4, eligible.length) }, async () => {
      while (nextIndex < eligible.length) {
        const fileIndex = nextIndex;
        const file = eligible[fileIndex];
        nextIndex += 1;
        try {
          uploaded[fileIndex] = await uploadHumanizerAvatar(file);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : `${file.name} could not be uploaded.`);
        }
      }
    });
    await Promise.all(workers);
    const successfulUploads = uploaded.filter((avatar): avatar is HumanizerAvatar => avatar !== null);
    setAvatarData((current) => [...current, ...successfulUploads].slice(0, 1000));
    if (successfulUploads.length) setFieldEnabled("avatar", true);
    setUploadingAvatars(0);
    if (successfulUploads.length) toast.success(`${successfulUploads.length} avatar${successfulUploads.length === 1 ? "" : "s"} uploaded.`);
    if (rejectedCount || failures.length) {
      toast.error(`${rejectedCount + failures.length} file${rejectedCount + failures.length === 1 ? "" : "s"} skipped.`);
    }
    if (avatarInputRef.current) avatarInputRef.current.value = "";
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
        enabledFields: activeFields,
        usernames: splitLines(usernames),
        displayNames: splitLines(displayNames),
        bios: splitLines(bios),
        pronouns: splitLines(pronouns),
        avatarIds: avatarData.map((avatar) => avatar.id),
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

  function requestSavePackage() {
    if (uploadingAvatars) {
      toast.error("Wait for avatar uploads to finish.");
      return;
    }
    if (!packageName.trim()) {
      toast.error("Enter a package name.");
      return;
    }
    if (!configuredChanges) {
      toast.error("Add at least one profile change before saving a package.");
      return;
    }
    setPackageModal("save");
  }

  async function handleSavePackage() {
    try {
      setSavingPackage(true);
      const saved = await saveHumanizerPackage({
        name: packageName.trim(),
        enabledFields: activeFields,
        usernames: splitLines(usernames),
        displayNames: splitLines(displayNames),
        bios: splitLines(bios),
        pronouns: splitLines(pronouns),
        avatars: avatarData,
        hypesquad,
        concurrency
      });
      setPackages((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSelectedPackageId(saved.id);
      setPackageName(saved.name);
      setPackageModal(null);
      toast.success(`“${saved.name}” package saved.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Package could not be saved.");
    } finally {
      setSavingPackage(false);
    }
  }

  function handleUsePackage() {
    if (!selectedPackage) return;
    setUsernames(selectedPackage.usernames.join("\n"));
    setDisplayNames(selectedPackage.displayNames.join("\n"));
    setBios(selectedPackage.bios.join("\n"));
    setPronouns(selectedPackage.pronouns.join("\n"));
    setAvatarData(selectedPackage.avatars);
    setSelectedFields(selectedPackage.enabledFields);
    setAvatarPreviewLimit(60);
    setHypesquad(selectedPackage.hypesquad);
    setConcurrency(selectedPackage.concurrency);
    setPackageName(selectedPackage.name);
    toast.success(`“${selectedPackage.name}” package loaded.`);
  }

  function handleRemoveAvatar(avatar: HumanizerAvatar) {
    const next = avatarData.filter((item) => item.id !== avatar.id);
    setAvatarData(next);
    if (!next.length) setFieldEnabled("avatar", false);
    void deleteHumanizerAvatar(avatar.id).catch(() => {
      // Package-owned avatars remain stored and can still be restored from that package.
    });
  }

  async function handleDeletePackage() {
    if (!selectedPackage) return;
    try {
      setDeletingPackage(true);
      await deleteHumanizerPackage(selectedPackage.id);
      const remaining = packages.filter((item) => item.id !== selectedPackage.id);
      setPackages(remaining);
      setSelectedPackageId(remaining[0]?.id ?? "");
      if (packageName === selectedPackage.name) setPackageName("");
      setPackageModal(null);
      toast.success("Package deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Package could not be deleted.");
    } finally {
      setDeletingPackage(false);
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

            <div className="humanizer-package-panel">
              <div className="humanizer-package-copy">
                <span className="humanizer-package-icon"><PackageOpen className="h-4 w-4" /></span>
                <span><strong>Ready packages</strong><small>Save this complete recipe or restore a saved setup.</small></span>
                <Badge variant={packages.length ? "secondary" : "outline"}>{packages.length}</Badge>
              </div>
              <div className="humanizer-package-controls">
                <Input value={packageName} maxLength={60} onChange={(event) => setPackageName(event.target.value)} placeholder="Package name" />
                <Button type="button" size="xs" variant="secondary" disabled={savingPackage || Boolean(uploadingAvatars) || !configuredChanges} onClick={requestSavePackage}>
                  {savingPackage ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                </Button>
                <FilterDropdown
                  label="Saved package"
                  showLabel={false}
                  className="humanizer-package-dropdown"
                  value={selectedPackageId}
                  options={packages.length
                    ? packages.map((item) => ({ value: item.id, label: item.name }))
                    : [{ value: "", label: packagesLoading ? "Loading packages…" : "No saved package" }]}
                  disabled={!packages.length}
                  onChange={setSelectedPackageId}
                />
                <Button type="button" size="xs" disabled={!selectedPackage} onClick={handleUsePackage}><PackageOpen className="h-3.5 w-3.5" /> Use</Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Delete selected package" title="Delete package" disabled={!selectedPackage || deletingPackage} onClick={() => setPackageModal("delete")}>
                  {deletingPackage ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <div className="humanizer-recipe-grid">
              <div className={`humanizer-recipe-card ${activeFields.includes("username") ? "is-enabled" : ""}`} data-recipe="username">
                <span className="humanizer-recipe-head"><i><AtSign className="h-4 w-4" /></i><span><strong>Usernames</strong><small>One value per line</small></span><span className="humanizer-recipe-head-actions"><b>{splitLines(usernames).length}</b><button type="button" className="humanizer-field-toggle" aria-pressed={activeFields.includes("username")} disabled={!fieldContent.username} onClick={() => setFieldEnabled("username", !activeFields.includes("username"))}><Check className="h-3 w-3" />{activeFields.includes("username") ? "Selected" : "Select"}</button></span></span>
                <textarea aria-label="Usernames" className="onliner-game-textarea" value={usernames} maxLength={33_000} onChange={(event) => updateLineField("username", event.target.value, setUsernames)} placeholder={"alex_01\ntaylor_02\njordan_03"} />
              </div>
              <div className={`humanizer-recipe-card ${activeFields.includes("displayName") ? "is-enabled" : ""}`} data-recipe="name">
                <span className="humanizer-recipe-head"><i><Type className="h-4 w-4" /></i><span><strong>Display names</strong><small>One value per line</small></span><span className="humanizer-recipe-head-actions"><b>{splitLines(displayNames).length}</b><button type="button" className="humanizer-field-toggle" aria-pressed={activeFields.includes("displayName")} disabled={!fieldContent.displayName} onClick={() => setFieldEnabled("displayName", !activeFields.includes("displayName"))}><Check className="h-3 w-3" />{activeFields.includes("displayName") ? "Selected" : "Select"}</button></span></span>
                <textarea aria-label="Display names" className="onliner-game-textarea" value={displayNames} maxLength={33_000} onChange={(event) => updateLineField("displayName", event.target.value, setDisplayNames)} placeholder={"Alex\nTaylor\nJordan"} />
              </div>
              <div className={`humanizer-recipe-card ${activeFields.includes("pronouns") ? "is-enabled" : ""}`} data-recipe="pronouns">
                <span className="humanizer-recipe-head"><i><UserRoundCheck className="h-4 w-4" /></i><span><strong>Pronouns</strong><small>One value per line</small></span><span className="humanizer-recipe-head-actions"><b>{splitLines(pronouns).length}</b><button type="button" className="humanizer-field-toggle" aria-pressed={activeFields.includes("pronouns")} disabled={!fieldContent.pronouns} onClick={() => setFieldEnabled("pronouns", !activeFields.includes("pronouns"))}><Check className="h-3 w-3" />{activeFields.includes("pronouns") ? "Selected" : "Select"}</button></span></span>
                <textarea aria-label="Pronouns" className="onliner-game-textarea" value={pronouns} maxLength={41_000} onChange={(event) => updateLineField("pronouns", event.target.value, setPronouns)} placeholder={"they/them\nshe/her\nhe/him"} />
              </div>
              <div className={`humanizer-recipe-card ${activeFields.includes("bio") ? "is-enabled" : ""}`} data-recipe="bio">
                <span className="humanizer-recipe-head"><i><FileText className="h-4 w-4" /></i><span><strong>Profile bios</strong><small>One value per line</small></span><span className="humanizer-recipe-head-actions"><b>{splitLines(bios).length}</b><button type="button" className="humanizer-field-toggle" aria-pressed={activeFields.includes("bio")} disabled={!fieldContent.bio} onClick={() => setFieldEnabled("bio", !activeFields.includes("bio"))}><Check className="h-3 w-3" />{activeFields.includes("bio") ? "Selected" : "Select"}</button></span></span>
                <textarea aria-label="Profile bios" className="onliner-game-textarea" value={bios} maxLength={191_000} onChange={(event) => updateLineField("bio", event.target.value, setBios)} placeholder={"Building something interesting.\nProbably listening to music."} />
              </div>
            </div>

            <section className="humanizer-hypesquad-panel" aria-labelledby="humanizer-hypesquad-title">
              <div className="humanizer-hypesquad-copy">
                <span className="humanizer-option-icon" aria-hidden="true"><Sparkles className="h-4 w-4" /></span>
                <span>
                  <strong id="humanizer-hypesquad-title">HypeSquad</strong>
                  <small>Leave unchanged or assign a specific house across selected accounts.</small>
                </span>
              </div>
              <FilterDropdown
                label="HypeSquad house"
                showLabel={false}
                placement="top"
                className="humanizer-hypesquad-dropdown"
                value={hypesquad}
                options={[
                  { value: "none", label: "Unchanged" },
                  { value: "random", label: "Random house" },
                  { value: "bravery", label: "Bravery" },
                  { value: "brilliance", label: "Brilliance" },
                  { value: "balance", label: "Balance" }
                ]}
                onChange={(value) => updateHypesquad(value as typeof hypesquad)}
              />
            </section>

            <section className={`humanizer-avatar-pool-panel ${activeFields.includes("avatar") ? "is-enabled" : ""}`} aria-labelledby="humanizer-avatar-pool-title">
              <header className="humanizer-avatar-pool-head">
                <div className="humanizer-avatar-pool-copy">
                  <span className="humanizer-option-icon"><Images className="h-4 w-4" /></span>
                  <span className="min-w-0"><strong id="humanizer-avatar-pool-title">Avatar pool</strong><small>PNG, JPG, WEBP or GIF · maximum 1 MB each</small></span>
                  <Badge variant={avatarData.length ? "secondary" : "outline"}>{avatarData.length}/1,000</Badge>
                  <button type="button" className="humanizer-field-toggle" aria-pressed={activeFields.includes("avatar")} disabled={!fieldContent.avatar} onClick={() => setFieldEnabled("avatar", !activeFields.includes("avatar"))}><Check className="h-3 w-3" />{activeFields.includes("avatar") ? "Selected" : "Select"}</button>
                </div>
                <div className="humanizer-avatar-pool-actions">
                  <Button type="button" variant="secondary" size="xs" disabled={Boolean(uploadingAvatars) || avatarData.length >= 1000} onClick={() => avatarInputRef.current?.click()}>
                    {uploadingAvatars ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {uploadingAvatars ? `Uploading ${uploadingAvatars}` : "Choose avatars"}
                  </Button>
                  <input ref={avatarInputRef} className="hidden" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void handleAvatarFiles(event.target.files)} />
                </div>
              </header>

              <div className={`humanizer-avatar-pool-body ${avatarData.length ? "" : "is-empty"}`}>
              {avatarData.length ? (
                <div className="humanizer-avatar-preview-section">
                <div className="humanizer-avatar-preview-grid" aria-label="Selected avatar previews">
                {avatarData.slice(0, avatarPreviewLimit).map((avatar, index) => (
                  <div key={`${avatar.name}-${index}`} className="humanizer-avatar-preview">
                    <div className="humanizer-avatar-preview-image">
                      <img src={avatar.url} alt={`Preview of ${avatar.name}`} loading="lazy" decoding="async" />
                    </div>
                    <div className="humanizer-avatar-preview-footer">
                      <span className="humanizer-avatar-preview-meta">
                        <strong title={avatar.name}>{avatar.name}</strong>
                        <small>Ready to use</small>
                      </span>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="dangerGhost"
                        aria-label={`Remove ${avatar.name}`}
                        title="Remove avatar"
                        onClick={() => handleRemoveAvatar(avatar)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
                </div>
                {avatarData.length > avatarPreviewLimit ? (
                  <Button type="button" size="xs" variant="ghost" className="humanizer-avatar-show-more" onClick={() => setAvatarPreviewLimit((current) => Math.min(current + 60, avatarData.length))}>
                    Show 60 more <span>{avatarPreviewLimit}/{avatarData.length}</span>
                  </Button>
                ) : null}
                </div>
              ) : (
                <div className="humanizer-avatar-empty">
                  <span><Images className="h-5 w-5" /></span>
                  <strong>No avatars in this pool yet</strong>
                  <small>Choose one or more images; previews will stay together in this panel.</small>
                </div>
              )}
              </div>
            </section>
          </section>
        </div>

        <footer className="humanizer-commandbar">
          <div className="humanizer-command-summary">
            <span className="humanizer-command-icon"><ShieldCheck className="h-4 w-4" /></span>
            <span><strong>Ready to apply</strong><small>{selectedIds.length ? `${selectedIds.length} account${selectedIds.length === 1 ? "" : "s"} selected` : "Select at least one eligible account"} · {configuredChanges ? `${configuredChanges} update field${configuredChanges === 1 ? "" : "s"} selected` : "Select at least one configured field"}</small></span>
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
            <Button type="button" disabled={starting || jobActive || Boolean(uploadingAvatars) || !selectedIds.length || !configuredChanges} onClick={() => void handleStart()}>
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
            <div className="humanizer-run-outcome" data-state={jobActive ? "running" : job.failed ? "attention" : "success"} role="status">
              <span className="humanizer-run-outcome-icon" aria-hidden="true">
                {jobActive ? <LoaderCircle className="h-4 w-4 animate-spin" /> : job.failed ? <CircleAlert className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              </span>
              <span className="humanizer-run-outcome-copy">
                <strong>{jobActive ? "Run in progress" : job.failed ? "Completed with attention" : "All updates complete"}</strong>
                <small>
                  {jobActive
                    ? `${job.completed} of ${job.total} processed · ${progress}%`
                    : job.failed
                      ? `${job.succeeded} successful · ${job.failed} need review`
                      : `${job.succeeded} account${job.succeeded === 1 ? "" : "s"} updated successfully`}
                </small>
              </span>
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

      {packageModal ? createPortal(
        <div
          className="confirm-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingPackage && !deletingPackage) setPackageModal(null);
          }}
        >
          <div
            className="confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="humanizer-package-modal-title"
            aria-describedby="humanizer-package-modal-description"
          >
            <span className={`confirm-modal-icon ${packageModal === "save" ? "is-success" : ""}`} aria-hidden="true">
              {packageModal === "save" ? <PackageOpen className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
            </span>
            <p className={`app-kicker ${packageModal === "delete" ? "text-[var(--app-danger)]" : "text-[var(--app-success)]"}`}>
              {packageModal === "save" ? (packageToOverwrite ? "Update ready package" : "Create ready package") : "Delete ready package"}
            </p>
            <h2 id="humanizer-package-modal-title">
              {packageModal === "save"
                ? packageToOverwrite ? `Replace “${packageToOverwrite.name}”?` : `Save “${packageName.trim()}”?`
                : selectedPackage ? `Delete “${selectedPackage.name}”?` : "Delete this package?"}
            </h2>
            <p id="humanizer-package-modal-description">
              {packageModal === "save"
                ? packageToOverwrite
                  ? "The saved usernames, display names, bios, pronouns, avatars and Humanizer settings in this package will be replaced with the current recipe."
                  : "The current usernames, display names, bios, pronouns, avatars and Humanizer settings will be stored together as a reusable package."
                : "This removes the saved package. Avatars currently loaded in the editor and your account profiles will not be changed."}
            </p>
            <div className="confirm-modal-actions">
              <Button
                autoFocus
                type="button"
                variant="secondary"
                disabled={savingPackage || deletingPackage}
                onClick={() => setPackageModal(null)}
              >
                Cancel
              </Button>
              {packageModal === "save" ? (
                <Button type="button" disabled={savingPackage} onClick={() => void handleSavePackage()}>
                  {savingPackage ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {savingPackage ? "Saving…" : packageToOverwrite ? "Replace package" : "Save package"}
                </Button>
              ) : (
                <Button type="button" variant="destructive" disabled={deletingPackage || !selectedPackage} onClick={() => void handleDeletePackage()}>
                  {deletingPackage ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {deletingPackage ? "Deleting…" : "Delete package"}
                </Button>
              )}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
