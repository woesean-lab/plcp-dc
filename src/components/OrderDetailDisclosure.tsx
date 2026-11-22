import { useId, type ReactNode } from "react";
import "./OrderDetailDisclosure.css";

export function OrderDetailDisclosure({ title, hint, icon, children, kind = "details" }: {
  title: string;
  hint?: string;
  icon: ReactNode;
  children: ReactNode;
  kind?: "details" | "payload";
}) {
  const titleId = useId();
  return <details className={kind === "payload" ? "lookup-raw-payload" : "lookup-technical-details"} aria-labelledby={titleId}>
    <summary>
      <span id={titleId}>{icon}{title}</span>
      {hint ? <small>{hint}</small> : null}
    </summary>
    {children}
  </details>;
}
