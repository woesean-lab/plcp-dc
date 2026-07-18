import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { KeyRound, LockKeyhole, LogIn } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getConfiguredCredentials,
  getDefaultUsername,
  hasAuthConfig,
  isAuthenticated,
  signIn
} from "../lib/session-auth";

type LocationState = {
  from?: {
    pathname?: string;
    search?: string;
  };
};

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [username, setUsername] = useState(getDefaultUsername());
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated()) {
    const destination = `${state?.from?.pathname ?? "/manage"}${state?.from?.search ?? "?tab=create"}`;
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      if (!hasAuthConfig()) {
        toast.error("Login credentials are not configured.");
        return;
      }

      const ok = signIn(username, password);
      if (!ok) {
        toast.error("Invalid username or password.");
        return;
      }

      toast.success("Signed in.");
      const destination = `${state?.from?.pathname ?? "/manage"}${state?.from?.search ?? "?tab=create"}`;
      navigate(destination, { replace: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-2xl items-center px-3 py-8 sm:px-5">
      <div className="app-panel w-full p-5 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="stat-icon" aria-hidden="true">
            <LockKeyhole className="h-4 w-4" />
          </span>
          <div>
            <p className="app-kicker">Protected access</p>
            <h1 className="app-title mt-1 text-2xl font-semibold">Sign in</h1>
          </div>
        </div>

        <p className="app-copy mt-4 max-w-lg text-sm leading-6">
          Enter the dashboard credentials to access the manage console.
        </p>
        {!getConfiguredCredentials() ? (
          <div className="app-panel-soft mt-5 px-4 py-3 text-sm text-[var(--app-danger)]">
            Missing `VITE_ADMIN_USERNAME` or `VITE_ADMIN_PASSWORD`.
          </div>
        ) : null}

        <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
          <label className="grid gap-2">
            <span className="field-label">Username</span>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </label>

          <label className="grid gap-2">
            <span className="field-label">Password</span>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" className="min-w-[132px] px-4 py-2.5 max-sm:w-full" disabled={loading}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            <div className="app-panel-soft flex items-center gap-2 px-4 py-3 text-sm text-[var(--app-muted)] max-sm:w-full">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <span>Use the configured dashboard credentials.</span>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
