export const MEMBER_JOINED_HOLD_MS = 200;

type Member = { index: number; state: string };
type Hold = { position: number; until: number };
export type MemberLogOrder<T extends Member> = {
  scope: string;
  source: T[];
  items: T[];
  holds: Map<number, Hold>;
};

// Keep the latest data; defer only a newly joined row's move to its sorted slot.
export function advanceMemberLogOrder<T extends Member>(
  previous: MemberLogOrder<T> | null,
  source: T[],
  scope: string,
  now: number
): MemberLogOrder<T> {
  if (!previous || previous.scope !== scope) return { scope, source, items: source, holds: new Map() };
  const prior = new Map(previous.items.map((item, position) => [item.index, { item, position }]));
  const holds = new Map<number, Hold>();
  for (const item of source) {
    if (item.state.toLowerCase() !== "joined") continue;
    const existing = previous.holds.get(item.index);
    if (existing && existing.until > now) {
      holds.set(item.index, existing);
      continue;
    }
    const before = prior.get(item.index);
    if (before && ["queued", "joining", "replacing"].includes(before.item.state.toLowerCase())) {
      holds.set(item.index, { position: before.position, until: now + MEMBER_JOINED_HOLD_MS });
    }
  }
  const items = source.filter(item => !holds.has(item.index));
  const held = source.filter(item => holds.has(item.index))
    .sort((left, right) => holds.get(left.index)!.position - holds.get(right.index)!.position);
  for (const item of held) items.splice(Math.min(holds.get(item.index)!.position, items.length), 0, item);
  return { scope, source, items, holds };
}
