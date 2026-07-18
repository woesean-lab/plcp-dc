import { CloudOff, Hexagon, Radio, Sparkles, type LucideIcon } from "lucide-react";
import type { ServiceType } from "../types";

export type ServiceOption = {
  value: ServiceType;
  title: string;
  description: string;
  icon: LucideIcon;
};

export const SERVICE_OPTIONS: ServiceOption[] = [
  { value: "OAUTH-OFFLINE", title: "OAuth Offline", description: "Persistent authorization", icon: CloudOff },
  { value: "OAUTH-ONLINE", title: "OAuth Online", description: "Live authorization", icon: Radio },
  { value: "OAUTH-PREMIUM", title: "OAuth Premium", description: "Priority authorization", icon: Sparkles },
  { value: "OAUTH-NFT", title: "OAuth NFT", description: "Token-based authorization", icon: Hexagon }
];

export function getServiceTitle(service?: string) {
  return SERVICE_OPTIONS.find((option) => option.value === service)?.title ?? service ?? "Unknown service";
}
