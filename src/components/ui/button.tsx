import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#7cc9ff1f] focus-visible:ring-offset-1 focus-visible:ring-offset-[#070910] active:translate-y-px disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "border-[#b8e3ff5c] bg-gradient-to-br from-[#b8e3ff] to-[#5faee5] text-[#06131d] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_10px_28px_rgba(75,157,214,0.15)] hover:border-[#d8f1ff99] hover:from-[#d8f1ff] hover:to-[#7cc9ff] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_14px_34px_rgba(75,157,214,0.22)]",
        destructive: "border-rose-400/20 bg-rose-500/10 text-rose-200 hover:border-rose-400/30 hover:bg-rose-500/16",
        outline: "border-white/10 bg-transparent text-slate-100 hover:border-white/15 hover:bg-white/[0.045]",
        secondary: "border-white/[0.08] bg-white/[0.045] text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] hover:border-white/[0.13] hover:bg-white/[0.075] hover:text-slate-50",
        ghost: "border-transparent bg-white/[0.035] text-slate-300 hover:border-white/[0.07] hover:bg-white/[0.065] hover:text-slate-50",
        link: "border-transparent bg-transparent text-[#7cc9ff] underline-offset-4 hover:text-[#b8e3ff] hover:underline"
      },
      size: {
        default: "h-11 px-4 py-2.5",
        sm: "h-10 px-3",
        lg: "h-12 px-8",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
        "icon-lg": "h-12 w-12",
        xs: "h-8 px-2.5 text-xs"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
