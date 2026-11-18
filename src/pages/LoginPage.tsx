import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, KeyRound, LockKeyhole, LogIn, ShieldCheck, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "../lib/session-auth";

type LocationState = {
  from?: {
    pathname?: string;
    search?: string;
  };
};

type LoginPageProps = {
  onAuthenticated?: () => void;
};

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    try {
      const ok = await signIn(username, password);
      if (!ok) {
        toast.error("Invalid username or password.");
        return;
      }

      toast.success("Signed in.");
      onAuthenticated?.();
      const destination = `${state?.from?.pathname ?? "/manage"}${state?.from?.search ?? "?tab=create"}`;
      navigate(destination, { replace: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="login-shell">
      <div className="app-ambient app-ambient-one" aria-hidden="true" />
      <div className="app-ambient app-ambient-two" aria-hidden="true" />
      <div className="login-card app-panel">
        <aside className="login-story">
          <div>
            <div className="login-brand">
              <span className="brand-mark" aria-hidden="true"><span className="brand-letter">P</span></span>
              <span><span className="brand-eyebrow">Pulcip</span><strong>Members Suite</strong></span>
            </div>
            <div className="login-hero-icon" aria-hidden="true"><Sparkles className="h-6 w-6" /></div>
            <h1 className="login-headline">Everything in control.<br />Beautifully simple.</h1>
            <p className="login-copy">Create, monitor, and manage every delivery from one secure workspace.</p>
          </div>
          <ul className="login-benefits" aria-label="Platform benefits">
            <li><Check className="h-4 w-4" /> Live delivery intelligence</li>
            <li><Check className="h-4 w-4" /> Protected local credentials</li>
            <li><Check className="h-4 w-4" /> Precision order controls</li>
          </ul>
        </aside>

        <div className="login-form-panel">
          <div className="flex items-center justify-between gap-3">
            <span className="stat-icon" aria-hidden="true"><LockKeyhole className="h-4 w-4" /></span>
            <span className="login-security"><ShieldCheck className="h-3.5 w-3.5" /> Secure access</span>
          </div>
          <div className="mt-8">
            <p className="app-kicker">Welcome back</p>
            <h2 className="app-title mt-2 text-3xl font-semibold">Sign in to continue</h2>
            <p className="app-copy mt-3 max-w-lg text-sm leading-6">Use your dashboard credentials to open the operations suite.</p>
          </div>
        <form className="mt-7 grid gap-5" onSubmit={handleSubmit}>
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

          <div className="grid gap-3">
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            <div className="login-hint">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              <span>Use the configured dashboard credentials.</span>
            </div>
          </div>
        </form>
        </div>
      </div>
    </section>
  );
}
