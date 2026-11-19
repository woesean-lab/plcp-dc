export function convertOnlinerProxyImport(value: unknown): string;
export function normalizeOnlinerProxyImportDraft(value: string): string;
export function onlinerProxyImportKey(value: string): string;
export function mergeOnlinerProxyImports(existing: string[], additions: string[]): { newProxies: string[]; duplicateCount: number };
