import { RadioTower } from "lucide-react";
import { StatusField } from "./ui/status-field";
import type { CommunityJoinRecord } from "../lib/community";

export function OnlinerStatusField({ state, details, unavailable = false }: {
  state: CommunityJoinRecord["onlinerConnectionState"]; details?: string | null; unavailable?: boolean;
}) {
  const value = unavailable ? "Unknown" : state === "connected" ? "Live"
    : state === "connecting" ? "Starting" : state === "reconnecting" ? "Retrying"
    : state === "error" ? "Failed" : "Offline";
  return <StatusField label="Onliner" state={unavailable ? "unknown" : state === "disconnected" || !state ? "inactive" : state}
    value={value} details={details || undefined} icon={<RadioTower aria-hidden="true" />} />;
}
