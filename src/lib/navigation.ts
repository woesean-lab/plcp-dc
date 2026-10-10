export type AdminTab = "create" | "manage" | "stock" | "onliner" | "settings";

export function normalizeAdminTab(value: string | null): AdminTab {
  if (value === "manage" || value === "stock" || value === "onliner" || value === "settings") return value;
  return "create";
}
