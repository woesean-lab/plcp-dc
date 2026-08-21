export type AdminTab = "create" | "manage" | "stock" | "settings";

export function normalizeAdminTab(value: string | null): AdminTab {
  if (value === "manage" || value === "stock" || value === "settings") return value;
  return "create";
}
