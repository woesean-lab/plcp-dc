import type { ReactNode } from "react";

export function OrderDetailsLayout({ overview, children, standaloneSections = false }: {
  overview: ReactNode;
  children: ReactNode;
  standaloneSections?: boolean;
}) {
  return <>
    <article className="app-panel lookup-workspace">
      {overview}
      {!standaloneSections ? children : null}
    </article>
    {standaloneSections ? children : null}
  </>;
}
