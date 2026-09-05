import { CloudOff, Gem, Hexagon, Radio, Sparkles, Users, type LucideIcon } from "lucide-react";
import type { MemberServiceType, S2ToolsServiceType, ServiceType } from "../types";

export type ServiceOption = {
  value: ServiceType;
  title: string;
  description: string;
  icon: LucideIcon;
  kind: "members" | "community" | "s2tools" | "boosts";
};

export const SERVICE_OPTIONS: ServiceOption[] = [
  { value: "OAUTH-OFFLINE", title: "OAuth Offline", description: "Persistent authorization", icon: CloudOff, kind: "members" },
  { value: "OAUTH-ONLINE", title: "OAuth Online", description: "Live authorization", icon: Radio, kind: "members" },
  { value: "OAUTH-PREMIUM", title: "OAuth Premium", description: "Priority authorization", icon: Sparkles, kind: "members" },
  { value: "OAUTH-NFT", title: "OAuth NFT", description: "Token-based authorization", icon: Hexagon, kind: "members" },
  { value: "COMMUNITY-OFFLINE", title: "Offline", description: "Connected OAuth members", icon: Users, kind: "community" },
  { value: "S2TOOLS-ONLINE", title: "Online", description: "S2Tools online stock", icon: Radio, kind: "s2tools" },
  { value: "S2TOOLS-OFFLINE", title: "Offline", description: "S2Tools offline stock", icon: CloudOff, kind: "s2tools" },
  { value: "S2TOOLS-1MONTH", title: "1 Month", description: "S2Tools one-month stock", icon: Sparkles, kind: "s2tools" },
  { value: "S2TOOLS-3MONTH", title: "3 Month", description: "S2Tools three-month stock", icon: Sparkles, kind: "s2tools" },
  { value: "DCORD-BOOSTS", title: "Boosts", description: "Discord server boosts", icon: Gem, kind: "boosts" }
];

export function getServiceTitle(service?: string) {
  return SERVICE_OPTIONS.find((option) => option.value === service)?.title ?? service ?? "Unknown service";
}

export function isBoostService(service?: string): service is "DCORD-BOOSTS" {
  return service === "DCORD-BOOSTS";
}

export function isCommunityService(service?: string): service is "COMMUNITY-OFFLINE" {
  return service === "COMMUNITY-OFFLINE";
}

export function isS2ToolsService(service?: string): service is S2ToolsServiceType {
  return SERVICE_OPTIONS.some((option) => option.value === service && option.kind === "s2tools");
}

export function isMemberService(service?: string): service is MemberServiceType {
  return SERVICE_OPTIONS.some((option) => option.value === service && option.kind === "members");
}
