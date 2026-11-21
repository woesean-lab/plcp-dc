import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import emojiData from "emoji-picker-react/dist/data/emojis.json";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { buildEmojiRows, EMOJI_ROW_HEIGHT, EMOJI_VIEWPORT_HEIGHT, getEmojiWindow, indexReactionEmojis } from "../lib/reaction-emoji-window";

// This module and catalog load once on demand. Only the visible rows become DOM nodes.
const catalog = indexReactionEmojis(emojiData);
export default function VirtualReactionEmojiPicker({ selectedEmojis, onSelect }: {
  selectedEmojis: string[]; onSelect: (emoji: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [columns, setColumns] = useState(8);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(EMOJI_VIEWPORT_HEIGHT);
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef(false);
  const rows = useMemo(() => buildEmojiRows(catalog, search, columns), [search, columns]);
  const items = useMemo(() => rows.flatMap((row, rowIndex) => row.emojis.map((emoji) => ({ ...emoji, rowIndex }))), [rows]);
  const range = getEmojiWindow(rows.length, scrollTop, viewportHeight);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      setColumns(Math.max(1, Math.min(12, Math.floor(element.clientWidth / EMOJI_ROW_HEIGHT))));
      setViewportHeight(element.clientHeight || EMOJI_VIEWPORT_HEIGHT);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = 0;
    setScrollTop(0);
  }, [search, columns]);

  useLayoutEffect(() => {
    if (!pendingFocus.current || !focusTarget) return;
    const button = scrollRef.current?.querySelector<HTMLButtonElement>('[data-emoji-id="' + focusTarget.id + '"]');
    if (button) { button.focus({ preventScroll: true }); pendingFocus.current = false; }
  }, [focusTarget, range.start, range.end, columns]);

  function focusEmoji(index: number) {
    const item = items[Math.max(0, Math.min(items.length - 1, index))];
    const element = scrollRef.current;
    if (!item || !element) return;
    const top = item.rowIndex * EMOJI_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + EMOJI_ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + EMOJI_ROW_HEIGHT - element.clientHeight;
    pendingFocus.current = true;
    setFocusTarget({ id: item.id });
    setScrollTop(element.scrollTop);
  }

  function handleEmojiKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const index = items.findIndex((item) => item.id === id);
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1
      : event.key === "ArrowDown" ? index + columns : event.key === "ArrowUp" ? index - columns
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    focusEmoji(next);
  }

  return <div className="reaction-emoji-browser">
    <div className="reaction-emoji-search">
      <Input type="search" aria-label="Search emojis" placeholder="Search by name or paste an emoji" value={search}
        onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown" && items.length) { event.preventDefault(); focusEmoji(0); } }} />
      {search ? <Button type="button" size="icon-sm" variant="ghost" aria-label="Clear emoji search" onClick={() => setSearch("")}><X className="h-3.5 w-3.5" /></Button> : null}
    </div>
    <div ref={scrollRef} className="reaction-emoji-scroll" role="region" aria-label="Emoji list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      {!rows.length ? <p className="reaction-emoji-empty" role="status">No emojis found.</p> : <div className="reaction-emoji-window" style={{ height: range.totalHeight }}>
        {rows.slice(range.start, range.end).map((row, offset) => <div key={row.key} className="reaction-emoji-window-row"
          style={{ top: (range.start + offset) * EMOJI_ROW_HEIGHT, height: EMOJI_ROW_HEIGHT, gridTemplateColumns: "repeat(" + columns + ", minmax(0, 1fr))" }}>
          {row.label ? <h3>{row.label}</h3> : row.emojis.map((item) => <button key={item.id} type="button" data-emoji-id={item.id} aria-label={item.name} title={item.name}
            aria-pressed={selectedEmojis.includes(item.emoji)} onKeyDown={(event) => handleEmojiKey(event, item.id)} onClick={() => onSelect(item.emoji)}>{item.emoji}</button>)}
        </div>)}
      </div>}
    </div>
    <span className="sr-only" role="status">{items.length} emojis available. Use arrow keys to browse.</span>
  </div>;
}
