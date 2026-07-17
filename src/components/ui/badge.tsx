import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[3px] border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-white/10 bg-slate-700/40 text-slate-100",
        secondary: "border-white/10 bg-slate-800 text-slate-200",
        outline: "border-white/10 bg-transparent text-slate-200",
        success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
        destructive: "border-rose-500/20 bg-rose-500/10 text-rose-200"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
