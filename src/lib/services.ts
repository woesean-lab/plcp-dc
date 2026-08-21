import { CloudOff, Gem, Hexagon, Radio, Sparkles, type LucideIcon } from "lucide-react";
import type { MemberServiceType, ServiceType } from "../types";

export type ServiceOption = {
  value: ServiceType;
  title: string;
  description: string;
  icon: LucideIcon;
  kind: "members" | "boosts";
};

export const SERVICE_OPTIONS: ServiceOption[] = [
  { value: "OAUTH-OFFLINE", title: "OAuth Offline", description: "Persistent authorization", icon: CloudOff, kind: "members" },
  { value: "OAUTH-ONLINE", title: "OAuth Online", description: "Live authorization", icon: Radio, kind: "members" },
  { value: "OAUTH-PREMIUM", title: "OAuth Premium", description: "Priority authorization", icon: Sparkles, kind: "members" },
  { value: "OAUTH-NFT", title: "OAuth NFT", description: "Token-based authorization", icon: Hexagon, kind: "members" },
  { value: "DCORD-BOOSTS", title: "Boosts", description: "Discord server boosts", icon: Gem, kind: "boosts" }
];

export function getServiceTitle(service?: string) {
  return SERVICE_OPTIONS.find((option) => option.value === service)?.title ?? service ?? "Unknown service";
}

export function isBoostService(service?: string): service is "DCORD-BOOSTS" {
  return service === "DCORD-BOOSTS";
}

export function isMemberService(service?: string): service is MemberServiceType {
  return SERVICE_OPTIONS.some((option) => option.value === service && option.kind === "members");
}
