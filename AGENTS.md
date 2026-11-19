# UI work

Before changing the UI, read [docs/ui-reference.md](docs/ui-reference.md) and inspect the relevant live example in `src/pages/UiKitPage.tsx` (`/ui-kit`). Follow the user's requested scope.

- Reuse the existing components from `src/components/ui` and `src/components/ListPagination.tsx`.
- Members Stock is the reference for row actions: `Button` with `size="icon-sm"`, the existing variant, and `community-member-row-actions`. Do not override its dimensions, radius, padding or hover to create a parallel style.
- Reuse existing tab, field, status and surface classes listed in the reference. Keep their normal, hover, focus, selected, loading and disabled states.
- Use the existing `--app-*` theme variables. Preserve the page's palette, typography and spacing unless the user asks to change them.
- Keep UI Kit examples and `docs/ui-reference.md` current when shared UI components or patterns change. A missing pattern can be added to the shared library and reference when needed; do not redesign unrelated screens.
- Check responsive layout and interaction states when browser access is available. Build/type checks do not establish visual correctness. Report any visual verification limitation honestly.
