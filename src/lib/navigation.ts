export type AdminTab = "create" | "manage" | "settings";

export function normalizeAdminTab(value: string | null): AdminTab {
  if (value === "manage" || value === "settings") return value;
  return "create";
}
