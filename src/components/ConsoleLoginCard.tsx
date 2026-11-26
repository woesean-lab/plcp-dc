import { useId, type FormEvent } from "react";
import { ArrowRight, CircleAlert, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SecretField } from "./ui/secret-field";
import "./ConsoleLoginCard.css";

export function ConsoleLoginCard({ username, password, loading = false, error = "", onUsernameChange, onPasswordChange, onSubmit }: {
  username: string; password: string; loading?: boolean; error?: string;
  onUsernameChange: (value: string) => void; onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const id = useId();
  return <section className="app-panel console-auth-card" aria-labelledby={`${id}-title`}>
    <header className="console-auth-heading"><span className="console-auth-emblem" aria-hidden="true"><ShieldCheck /></span><span className="app-kicker">Workspace access</span><h1 id={`${id}-title`}>Welcome back<span>.</span></h1><p>Sign in to your Discord console.</p></header>
    <form className="console-auth-form" onSubmit={onSubmit} aria-busy={loading}>
      <div className="settings-field"><label className="field-label" htmlFor={`${id}-username`}>Username</label><Input id={`${id}-username`} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Your username" required value={username} disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onUsernameChange(event.target.value)} /></div>
      <SecretField label="Password" name="password" placeholder="Enter your password" autoComplete="current-password" required maxLength={1024} value={password} disabled={loading} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onPasswordChange(event.target.value)} />
      {error ? <div className="console-auth-error" id={`${id}-error`} role="alert"><CircleAlert className="h-4 w-4" aria-hidden="true" /><span>{error}</span></div> : null}
      <Button type="submit" size="lg" className="console-auth-submit" disabled={loading}>{loading ? <><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />Signing in…</> : <>Sign in<ArrowRight className="h-4 w-4" aria-hidden="true" /></>}</Button>
    </form>
    <footer className="console-auth-card-footer"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Administrator access only</footer>
  </section>;
}
