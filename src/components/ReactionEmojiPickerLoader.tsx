import { useEffect, useState } from "react";
import { Button } from "./ui/button";

type PickerModule = typeof import("./VirtualReactionEmojiPicker");
let pending: Promise<PickerModule> | undefined;

function loadPicker() {
  return pending ??= import("./VirtualReactionEmojiPicker").catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
}

export function preloadReactionEmojiPicker() {
  // Hover/focus prefetch must never create an unhandled rejection.
  return loadPicker().then(() => undefined, () => undefined);
}

export function ReactionEmojiPickerLoader(props: Parameters<PickerModule["default"]>[0]) {
  const [Picker, setPicker] = useState<PickerModule["default"] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadPicker().then(
      (module) => { if (active) setPicker(() => module.default); },
      () => { if (active) setFailed(true); }
    );
    return () => { active = false; };
  }, []);

  if (failed) return <div className="reaction-emoji-empty" role="alert">
    <p>Emojis could not be loaded.</p>
    <Button type="button" size="xs" variant="accentGhost" onClick={() => window.location.reload()}>Refresh page</Button>
  </div>;
  if (Picker) return <Picker {...props} />;
  return <div className="monitor-reaction-emoji-loading" role="status" aria-label="Loading emojis">
    <span className="monitor-reaction-emoji-loading-search" />
    <span className="monitor-reaction-emoji-loading-title" />
    <span className="monitor-reaction-emoji-loading-grid">{Array.from({ length: 32 }, (_, index) => <i key={index} />)}</span>
  </div>;
}
