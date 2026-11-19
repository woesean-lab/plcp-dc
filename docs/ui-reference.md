# Pulcip UI reference

The authenticated **`/ui-kit`** page collects the console's existing UI styles. Open it from the **UI Kit** link in the admin footer. Its examples use the actual React components and CSS, so changes to shared styles appear there automatically. The page is loaded separately and uses sample data only.

- Gallery: `src/pages/UiKitPage.tsx`
- Gallery layout only: `src/pages/UiKitPage.css`
- Shared theme and existing patterns: `src/index.css`
- Shared status geometry: `src/components/ui/badge.css`

Use the gallery and these source files as the reference for future UI work. Prefer the implementation already used by the relevant console screen. Do not copy a rendered appearance into a new set of colors, radii or dimensions.

## Components and patterns

| UI | Source / usage | Reference |
| --- | --- | --- |
| Buttons | `src/components/ui/button.tsx` | `default`, `secondary`, `outline`, `ghost`, `destructive`, `dangerGhost`, `link` |
| Row actions | `Button size="icon-sm"`; `community-member-row-actions` | Members Stock in `src/pages/HomePage.tsx`; 32px controls, standard rounded corners and shared hover |
| Rich Presence action | `community-rich-presence-action` plus existing Button variant | Members Stock star action; preserve the purple tint |
| Destructive icon action | `Button variant="dangerGhost" size="icon-sm"` | Members Stock power/delete; red hover treatment |
| Leave all action | `src/components/AutoLeaveActionButton.tsx` | Last on the right, separated from the standard row icons. Uses the shared text Button (`size="xs"`) labelled Leave all with the Members Stock `dangerGhost` hover. Exit = not started; spinner = starting/running; check = finished; warning = errors. Previously started jobs stay disabled. |
| Compact tabs | `stock-duration-filter`, `is-active`, `aria-pressed` | Stock filters and Orders service filter |
| Stock category tabs | `stock-category-tabs`, `is-active` | Stock section's larger category cards |
| Text inputs | `src/components/ui/input.tsx` | Shared Input; visible labels and disabled state |
| Compact search | `community-member-search` with Search icon and Input | Members Stock username / name / ID search |
| Dropdowns | `src/components/ui/filter-dropdown.tsx` | Use themed FilterDropdown; `portal` in clipped/scrolling containers; no native select replacement |
| Selection | `community-member-checkbox`, `community-member-select-all` | Members Stock checkboxes |
| Option cards | `boost-proxy-toggle`, `is-enabled` | Create order's Eldorado checkbox card |
| Badges | `src/components/ui/badge.tsx`, `badge.css` | All statuses keep the shared `status-badge` geometry |
| Account chips | `community-onliner-chip`, `community-rich-presence-chip`, `community-server-count-chip` | Members Stock; include `status-badge` |
| Cards | `src/components/ui/card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter |
| Surfaces | `app-panel`, `app-panel-soft`, `payload-panel` | Main panels, nested groups and code/payload blocks |
| Member rows | `community-recent-list`, `community-recent-avatar`, `community-member-row-actions` | Members Stock; keep selection/actions distinct from search |
| Bulk Onliner connections | `src/lib/community-onliner-connect.ts`, Members Stock toolbar | Existing secondary Button and connection modal; optional Rich Presence, progress, skip existing profiles, keep failures selected for retry |
| Pagination | `src/components/ListPagination.tsx`: `paginate` and ListPagination | 50 / 100 / 200 / 500; optional `showNavigationLabels`; reset page when filters/page size change. Keep the shared button/dropdown sizes, corners and spacing; page CSS must not override these controls. |
| Order warnings | `od-order-alert`, `od-alert-copy`, `od-alert-actions` in `src/components/OrdersWorkspace.css` | Paused invite warning stays a red card with its Continue action |
| Expired support notice | `monitor-expired-support-note` | Monitor's amber warning; icon and heading stay aligned |
| Row hover & navigation | `od-order-group` in `OrdersWorkspace.tsx` and its CSS | Order details and warning share hover. The main row opens order details; actions and text selection stay independent. Keep the name and Open links for keyboard navigation. |
| Progress | `monitor-live-progress-track` | Monitor's existing purple track |
| Loading | `src/components/ui/skeleton.tsx` | Skeleton placeholders; LoaderCircle for pending actions |
| Empty state | `stock-empty-state` | Icon, concise heading and helpful next step |
| Confirmation | `confirm-modal`, `confirm-modal-actions` | Existing confirmations; retain accessible focus/keyboard behavior |
| Order category transfer | `src/components/OrderCategoryTransferDialog.tsx` | Existing confirmation styling, native dialog focus behavior, themed destination dropdown, preview before moving existing orders |
| Help tooltip | `member-check-control`, `member-check-help`, `member-check-tooltip` | Monitor help; show on hover and keyboard focus |
| Colors | `--app-*` in `src/index.css` | Current dark surfaces, purple accent, green success and red danger |
| Text | `app-kicker`, `field-label`, `--app-text`, `--app-text-secondary`, `--app-muted`, `--app-subtle` | Preserve the existing hierarchy |

## Applying a UI change

1. Find the closest example in `/ui-kit` and inspect the referenced implementation.
2. Reuse that component's props/classes and interaction states. Add layout only where the new context needs it.
3. Check the requested area at desktop and narrow widths, including hover, keyboard focus, selected, disabled, loading and empty states where relevant.
4. Run the applicable build/type checks. Describe any limitation if a live browser check is unavailable.
5. Update the example and mapping if the shared pattern itself changed.

The reference is an HTML page rendered by the app's existing React/Vite setup, rather than a detached CSS snapshot. Snippets are available under **View usage → Copy code**. Demo actions never call the production operation APIs.
