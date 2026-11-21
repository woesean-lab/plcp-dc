export const EMOJI_ROW_HEIGHT = 36;
export const EMOJI_VIEWPORT_HEIGHT = 222;
export const EMOJI_OVERSCAN_ROWS = 2;
const CATEGORIES = [
  ["smileys_people", "Smileys & People"], ["animals_nature", "Animals & Nature"],
  ["food_drink", "Food & Drink"], ["travel_places", "Travel & Places"],
  ["activities", "Activities"], ["objects", "Objects"], ["symbols", "Symbols"], ["flags", "Flags"]
];
export type EmojiCatalog = { emojis: Record<string, Array<{ n: string[]; u: string }>> };
export type ReactionEmoji = { id: string; emoji: string; name: string; search: string; category: string };
export type EmojiRow = { key: string; label?: string; emojis: ReactionEmoji[] };
const normalize = (value: string) => value.toLowerCase().replace(/\ufe0f/g, "").trim();

export function indexReactionEmojis(catalog: EmojiCatalog): ReactionEmoji[] {
  return CATEGORIES.flatMap(([category]) => (catalog.emojis[category] ?? []).map((item) => {
    const emoji = String.fromCodePoint(...item.u.split("-").map((part) => Number.parseInt(part, 16)));
    return { id: item.u, emoji, name: item.n[item.n.length - 1] || emoji, search: normalize(item.n.join(" ")), category };
  }));
}

export function buildEmojiRows(emojis: ReactionEmoji[], search: string, columns: number): EmojiRow[] {
  const query = normalize(search);
  const width = Math.max(1, Math.floor(columns));
  const rows: EmojiRow[] = [];
  for (const [category, label] of CATEGORIES) {
    const matches = emojis.filter((item) => item.category === category && (!query || item.search.includes(query) || normalize(item.emoji).includes(query)));
    if (!matches.length) continue;
    rows.push({ key: category, label, emojis: [] });
    for (let index = 0; index < matches.length; index += width) rows.push({ key: category + ":" + index, emojis: matches.slice(index, index + width) });
  }
  return rows;
}

export function getEmojiWindow(rowCount: number, scrollTop: number, height = EMOJI_VIEWPORT_HEIGHT) {
  const visibleRows = Math.max(1, Math.ceil(height / EMOJI_ROW_HEIGHT));
  const first = Math.min(Math.max(0, rowCount - visibleRows), Math.floor(Math.max(0, scrollTop) / EMOJI_ROW_HEIGHT));
  const start = Math.max(0, first - EMOJI_OVERSCAN_ROWS);
  const end = Math.min(rowCount, first + visibleRows + EMOJI_OVERSCAN_ROWS);
  return { start, end, totalHeight: rowCount * EMOJI_ROW_HEIGHT };
}
