let authenticated = false;

export type AdminProfile = {
  username: string;
  role: string;
  signedInAt: string;
  expiresAt: string;
  passwordUpdatedAt: string | null;
};

async function profileRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Could not update your account.");
  return body;
}

export const getAdminProfile = () => profileRequest<AdminProfile>("/api/auth/profile");
export const changeAdminPassword = (currentPassword: string, newPassword: string) => profileRequest<{ changed: boolean; passwordUpdatedAt: string }>("/api/auth/password", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword })
});

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
  const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not sign out.");
  authenticated = false;
}
