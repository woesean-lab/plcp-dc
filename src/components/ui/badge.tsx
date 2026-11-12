import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "ui-badge status-badge inline-flex items-center justify-center transition-colors",
  {
    variants: {
      variant: {
        default: "ui-badge-primary",
        secondary: "ui-badge-secondary",
        outline: "ui-badge-outline",
        success: "ui-badge-success",
        destructive: "ui-badge-destructive"
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
