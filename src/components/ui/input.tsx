import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-[46px] w-full rounded-xl border border-white/[0.085] bg-black/20 px-3.5 py-2 text-sm text-[#f7f5ef] shadow-[inset_0_1px_3px_rgba(0,0,0,0.24)] outline-none transition-[border-color,box-shadow,background-color] placeholder:text-slate-600 hover:border-white/[0.13] focus-visible:border-[#7cc9ff94] focus-visible:bg-black/30 focus-visible:ring-4 focus-visible:ring-[#7cc9ff1a] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-45 autofill:bg-[#0c1018] autofill:text-slate-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
