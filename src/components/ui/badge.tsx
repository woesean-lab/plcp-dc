import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-[#7cc9ff33] bg-[#7cc9ff14] text-[#b8e3ff]",
        secondary: "border-indigo-400/15 bg-indigo-400/10 text-indigo-200",
        outline: "border-white/10 bg-transparent text-slate-300",
        success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
        destructive: "border-rose-400/20 bg-rose-400/10 text-rose-200"
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
