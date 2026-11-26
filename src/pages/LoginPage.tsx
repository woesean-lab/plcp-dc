import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import toast from "react-hot-toast";
import { ConsoleLoginCard } from "../components/ConsoleLoginCard";
import { signIn } from "../lib/session-auth";

type LocationState = { from?: { pathname?: string; search?: string } };
type LoginPageProps = { onAuthenticated?: () => void };

export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setLoading(true); setError("");
    try {
      const ok = await signIn(username, password);
      if (!ok) { setError("Username or password is incorrect."); return; }
      toast.success("Signed in.");
      onAuthenticated?.();
      const destination = (state?.from?.pathname ?? "/console") + (state?.from?.search ?? "?tab=create");
      navigate(destination, { replace: true });
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      pending.current = false; setLoading(false);
    }
  }
  return <main className="console-auth-shell">
    <div className="console-auth-backdrop" aria-hidden="true" />
    <header className="console-auth-topbar"><Link to="/" className="console-auth-brand" aria-label="Pulcip home"><span className="brand-mark" aria-hidden="true"><span className="brand-letter">P</span></span><span><strong>Pulcip</strong><small>Discord Console</small></span></Link><span className="console-auth-private"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />Private workspace</span></header>
    <div className="console-auth-content"><ConsoleLoginCard username={username} password={password} loading={loading} error={error} onUsernameChange={setUsername} onPasswordChange={setPassword} onSubmit={handleSubmit} /><Link to="/" className="console-auth-back"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to Pulcip</Link></div>
    <footer className="console-auth-footer">Pulcip · Private operations suite</footer>
  </main>;
}
