import { Gem, Radio, Users, type LucideIcon } from "lucide-react";
import type { ServiceType } from "../types";

export type ServiceOption = {
  value: ServiceType;
  title: string;
  description: string;
  icon: LucideIcon;
  kind: "community" | "boosts";
};

export const SERVICE_OPTIONS: ServiceOption[] = [
  { value: "COMMUNITY-OFFLINE", title: "Offline", description: "Connected OAuth members", icon: Users, kind: "community" },
  { value: "COMMUNITY-ONLINE", title: "Online", description: "Live OAuth members", icon: Radio, kind: "community" },
  { value: "DCORD-BOOSTS", title: "Boosts", description: "Discord server boosts", icon: Gem, kind: "boosts" }
];

export function getServiceTitle(service?: string) {
  return SERVICE_OPTIONS.find((option) => option.value === service)?.title ?? service ?? "Unknown service";
}

export function isBoostService(service?: string): service is "DCORD-BOOSTS" {
  return service === "DCORD-BOOSTS";
}

export function isCommunityService(service?: string): service is "COMMUNITY-OFFLINE" | "COMMUNITY-ONLINE" {
  return service === "COMMUNITY-OFFLINE" || service === "COMMUNITY-ONLINE";
}
