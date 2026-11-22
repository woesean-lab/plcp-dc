import type { ReactNode } from "react";

export function OrderDetailsLayout({ overview, footer, children, standaloneSections = false }: {
  overview: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  standaloneSections?: boolean;
}) {
  return <>
    <article className="app-panel lookup-workspace">
      {overview}
      {!standaloneSections ? children : null}
      {footer}
    </article>
    {standaloneSections ? children : null}
  </>;
}
