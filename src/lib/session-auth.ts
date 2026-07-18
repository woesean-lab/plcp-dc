let authenticated = false;

export async function refreshSession() {
  try {
    const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    authenticated = response.ok;
  } catch {
    authenticated = false;
  }
  return authenticated;
}

export async function signIn(username: string, password: string) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username.trim(), password })
  });
  authenticated = response.ok;
  return authenticated;
}

export async function signOut() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    authenticated = false;
  }
}
