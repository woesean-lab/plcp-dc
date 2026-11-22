import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, ShieldCheck, UserRound, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { changeAdminPassword, getAdminProfile, type AdminProfile } from "../lib/session-auth";
import "./ProfileDialog.css";

export function ProfileDialog({ onClose, loadProfile = getAdminProfile, savePassword = changeAdminPassword }: {
  onClose: () => void;
  loadProfile?: () => Promise<AdminProfile>;
  savePassword?: typeof changeAdminPassword;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const id = useId();
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState({ current: "", next: "", confirm: "" });
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError("");
    void loadProfile().then(data => { if (active) setProfile(data); })
      .catch(error => { if (active) setLoadError(error instanceof Error ? error.message : "Could not load your profile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadProfile, revision]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !profile) return;
    setSuccess(false); setError("");
    if (draft.next.length < 12 || draft.next.length > 128 || !draft.next.trim()) { setError("New password must be 12–128 characters."); return; }
    if (draft.next !== draft.confirm) { setError("Passwords do not match."); return; }
    if (draft.current === draft.next) { setError("Choose a different password."); return; }
    busy.current = true; setSaving(true);
    try {
      const result = await savePassword(draft.current, draft.next);
      if (!result.changed) throw new Error("Password was not changed.");
      setProfile({ ...profile, passwordUpdatedAt: result.passwordUpdatedAt });
      setDraft({ current: "", next: "", confirm: "" }); setVisible(false); setSuccess(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not change your password."); }
    finally { busy.current = false; setSaving(false); }
  }
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not changed yet";
  const close = () => { if (!busy.current) dialog.current?.close(); };

  return <dialog ref={dialog} className="confirm-modal profile-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onClose={onClose} onCancel={event => { if (busy.current) event.preventDefault(); }}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
    <header className="profile-dialog-heading"><span className="monitor-panel-icon" aria-hidden="true"><UserRound className="h-4 w-4" /></span><div><p className="app-kicker">Your account</p><h2 id={`${id}-title`}>Profile</h2><p id={`${id}-description`}>Account details and password.</p></div><span className="community-member-row-actions"><Button type="button" variant="ghost" size="icon-sm" autoFocus disabled={saving} aria-label="Close profile" onClick={close}><X className="h-4 w-4" /></Button></span></header>
    {loading ? <div className="profile-dialog-body" role="status" aria-label="Loading profile"><Skeleton className="h-20 w-full" /><Skeleton className="mt-5 h-12 w-full" /><Skeleton className="mt-4 h-12 w-full" /></div> : loadError ? <div className="profile-dialog-body profile-load-error" role="alert"><p>{loadError}</p><Button type="button" variant="secondary" size="sm" onClick={() => setRevision(value => value + 1)}>Retry</Button></div> : profile ? <>
      <div className="profile-dialog-body">
        <div className="app-panel-soft profile-identity"><span className="profile-avatar" aria-hidden="true">{profile.username.slice(0, 2).toUpperCase()}</span><div><span className="field-label">Username</span><strong>{profile.username}</strong></div><Badge variant="secondary"><ShieldCheck aria-hidden="true" />{profile.role}</Badge></div>
        <dl className="profile-details"><div><dt>Signed in</dt><dd>{date(profile.signedInAt)}</dd></div><div><dt>Session expires</dt><dd>{date(profile.expiresAt)}</dd></div><div><dt>Password updated</dt><dd>{date(profile.passwordUpdatedAt)}</dd></div></dl>
        <form id={`${id}-password`} onSubmit={event => void submit(event)} aria-label="Change password" className="profile-password-form">
          <div className="profile-password-heading"><h3><KeyRound className="h-4 w-4" aria-hidden="true" />Change password</h3><span className="community-member-row-actions"><Button type="button" variant="ghost" size="icon-sm" disabled={saving} aria-label={visible ? "Hide passwords" : "Show passwords"} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button></span></div>
          <input type="text" name="username" autoComplete="username" value={profile.username} readOnly hidden />
          {([{ key: "current", label: "Current password", autoComplete: "current-password" }, { key: "next", label: "New password", autoComplete: "new-password" }, { key: "confirm", label: "Confirm new password", autoComplete: "new-password" }] as const).map(field => <label key={field.key} className="profile-field"><span className="field-label">{field.label}</span><Input name={field.key} type={visible ? "text" : "password"} autoComplete={field.autoComplete} required maxLength={field.key === "current" ? 1024 : 128} minLength={field.key === "current" ? 1 : 12} disabled={saving} value={draft[field.key]} onChange={event => { setDraft({ ...draft, [field.key]: event.target.value }); setError(""); setSuccess(false); }} /></label>)}
          <p className="profile-password-note">12–128 characters. Changing your password signs out other sessions.</p>
          {error ? <p className="profile-message is-error" role="alert">{error}</p> : null}
          {success ? <p className="profile-message is-success" role="status"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Password changed. Other sessions signed out.</p> : null}
        </form>
      </div>
      <footer className="profile-dialog-footer"><Button type="button" size="sm" variant="secondary" disabled={saving} onClick={close}>Close</Button><Button type="submit" form={`${id}-password`} size="sm" disabled={saving || !draft.current || !draft.next || !draft.confirm}>{saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{saving ? "Saving…" : "Change password"}</Button></footer>
    </> : null}
  </dialog>;
}
