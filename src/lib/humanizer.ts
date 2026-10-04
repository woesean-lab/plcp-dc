export type HumanizerAccount = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  categoryId: string;
  categoryName: string;
  status: string;
  reserved: boolean;
  hasToken: boolean;
  hasProxy: boolean;
  onlinerState: "linked" | "not_linked";
};

export type HumanizerCatalog = {
  categories: Array<{ id: string; name: string }>;
  accounts: HumanizerAccount[];
};

export type HumanizerResult = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  categoryId: string;
  state: "pending" | "running" | "success" | "partial" | "failed";
  changed: string[];
  error: string | null;
  gatewayFallback: boolean;
  startedAt: string | null;
  completedAt: string | null;
};

export type HumanizerJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  total: number;
  completed: number;
  succeeded: number;
  failed: number;
  skipped: string[];
  results: HumanizerResult[];
};

export type HumanizerJobInput = {
  accountIds: string[];
  usernames: string[];
  displayNames: string[];
  bios: string[];
  pronouns: string[];
  avatars: string[];
  hypesquad: null | "random" | "bravery" | "brilliance" | "balance";
  concurrency: number;
};

export type HumanizerPackage = {
  id: string;
  name: string;
  usernames: string[];
  displayNames: string[];
  bios: string[];
  pronouns: string[];
  avatars: Array<{ name: string; data: string }>;
  hypesquad: "none" | "random" | "bravery" | "brilliance" | "balance";
  concurrency: number;
  createdAt: string;
  updatedAt: string;
};

export type HumanizerPackageInput = Omit<HumanizerPackage, "id" | "createdAt" | "updatedAt">;

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `Request failed with ${response.status}`);
  return payload;
}

export function getHumanizerCatalog() {
  return fetch("/api/humanizer/catalog", { cache: "no-store", credentials: "same-origin" })
    .then(parseResponse<HumanizerCatalog>);
}

export function getHumanizerPackages() {
  return fetch("/api/humanizer/packages", { cache: "no-store", credentials: "same-origin" })
    .then(parseResponse<HumanizerPackage[]>);
}

export function saveHumanizerPackage(input: HumanizerPackageInput) {
  return fetch("/api/humanizer/packages", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse<HumanizerPackage>);
}

export function deleteHumanizerPackage(packageId: string) {
  return fetch(`/api/humanizer/packages/${encodeURIComponent(packageId)}`, {
    method: "DELETE",
    credentials: "same-origin"
  }).then(parseResponse<{ deleted: boolean }>);
}

export function getLatestHumanizerJob() {
  return fetch("/api/humanizer/jobs/latest", { cache: "no-store", credentials: "same-origin" })
    .then(parseResponse<HumanizerJob | null>);
}

export function getHumanizerJob(jobId: string) {
  return fetch(`/api/humanizer/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", credentials: "same-origin" })
    .then(parseResponse<HumanizerJob>);
}

export function startHumanizerJob(input: HumanizerJobInput) {
  return fetch("/api/humanizer/jobs", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then(parseResponse<HumanizerJob>);
}
