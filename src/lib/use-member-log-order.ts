import { useEffect, useState } from "react";
import { advanceMemberLogOrder, type MemberLogOrder } from "./member-log-order";

export function useMemberLogOrder<T extends { index: number; state: string }>(source: T[], scope: string) {
  const [snapshot, setSnapshot] = useState<MemberLogOrder<T>>(() => advanceMemberLogOrder(null, source, scope, Date.now()));
  let current = snapshot;
  // Derive before commit so the latest Joined state renders in the previous slot.
  if (snapshot.source !== source || snapshot.scope !== scope) {
    current = advanceMemberLogOrder(snapshot, source, scope, Date.now());
    setSnapshot(current);
  }
  useEffect(() => {
    if (!current.holds.size) return;
    const deadline = Math.min(...Array.from(current.holds.values(), hold => hold.until));
    const timer = window.setTimeout(() => {
      setSnapshot(previous => advanceMemberLogOrder(previous, previous.source, previous.scope, Date.now()));
    }, Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [current]);
  return current.items;
}
