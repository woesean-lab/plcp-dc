import type { ReactNode } from "react";
import { Badge } from "./ui/badge";

export function BoostStockStatus({ tone = "neutral", children }: { tone?: "neutral" | "success" | "accent" | "danger"; children: ReactNode }) {
  return <Badge variant={tone === "success" ? "success" : tone === "danger" ? "destructive" : tone === "accent" ? "default" : "outline"}>{children}</Badge>;
}

export const boostStockOrderLink = (orderId: string) => `/orders?uniqid=${encodeURIComponent(orderId)}&provider=dcord`;
