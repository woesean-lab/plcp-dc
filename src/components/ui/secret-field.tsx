import { useId, useState, type InputHTMLAttributes } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";

export function SecretField({ label, saved, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; saved?: boolean }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <div className="settings-field">
    <div className="settings-field-heading"><label className="field-label" htmlFor={id}>{label}</label>{saved ? <span className="settings-saved"><Check className="h-3 w-3" aria-hidden="true" />Saved</span> : null}</div>
    <div className="settings-secret-input">
      <Input {...props} id={id} type={visible ? "text" : "password"} />
      <span className="community-member-row-actions settings-secret-action"><Button type="button" size="icon-sm" variant="ghost" disabled={props.disabled} aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button></span>
    </div>
  </div>;
}
