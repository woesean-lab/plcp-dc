const STORAGE_KEY = "tokenu.console.session";

const DEFAULT_USERNAME = import.meta.env.VITE_ADMIN_USERNAME;
const DEFAULT_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;

export function isAuthenticated() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function signIn(username: string, password: string) {
  const normalizedUsername = username.trim();
  const normalizedPassword = password;

  const configured = getConfiguredCredentials();
  if (!configured) return false;

  if (normalizedUsername !== configured.username || normalizedPassword !== configured.password) {
    return false;
  }

  localStorage.setItem(STORAGE_KEY, "1");
  return true;
}

export function signOut() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getDefaultUsername() {
  return DEFAULT_USERNAME ?? "";
}

export function hasAuthConfig() {
  return Boolean(getConfiguredCredentials());
}

export function getConfiguredCredentials() {
  return DEFAULT_USERNAME && DEFAULT_PASSWORD ? { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD } : null;
}
