const STORAGE_KEY = "tokenu.console.session";
const CREDENTIALS_KEY = "tokenu.console.credentials";

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
  return DEFAULT_USERNAME ?? getStoredCredentials()?.username ?? "";
}

export function hasAuthConfig() {
  return Boolean(getConfiguredCredentials());
}

export function setRuntimeCredentials(username: string, password: string) {
  const next = {
    username: username.trim(),
    password
  };
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(next));
}

export function clearRuntimeCredentials() {
  localStorage.removeItem(CREDENTIALS_KEY);
}

export function getConfiguredCredentials() {
  return (
    (DEFAULT_USERNAME && DEFAULT_PASSWORD ? { username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD } : null) ??
    getStoredCredentials()
  );
}

function getStoredCredentials() {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { username?: string; password?: string };
    if (!parsed.username || !parsed.password) return null;

    return {
      username: parsed.username,
      password: parsed.password
    };
  } catch {
    return null;
  }
}
