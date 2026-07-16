const STORAGE_KEY = "tokenu.apiKey";

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

export function setApiKey(value: string) {
  localStorage.setItem(STORAGE_KEY, value.trim());
}

export function clearApiKey() {
  localStorage.removeItem(STORAGE_KEY);
}
