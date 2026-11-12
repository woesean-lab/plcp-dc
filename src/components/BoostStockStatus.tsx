import type { ReactNode } from "react";

export function BoostStockStatus({ tone = "neutral", children }: { tone?: "neutral" | "success" | "accent" | "danger"; children: ReactNode }) {
  return <span className={`boost-stock-status is-${tone}`}><span aria-hidden="true" />{children}</span>;
}

export const boostStockOrderLink = (orderId: string) => `/orders?uniqid=${encodeURIComponent(orderId)}&provider=dcord`;
