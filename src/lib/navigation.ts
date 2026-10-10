export type AdminTab = "create" | "manage" | "reactions" | "stock" | "onliner" | "settings";

export function normalizeAdminTab(value: string | null): AdminTab {
  if (value === "manage" || value === "reactions" || value === "stock" || value === "onliner" || value === "settings") return value;
  return "create";
}
