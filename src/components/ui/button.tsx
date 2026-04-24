import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border border-transparent bg-[linear-gradient(135deg,#34C79A,#22B889)] text-white shadow-[0_8px_20px_rgba(52,199,154,0.28)] hover:shadow-[0_10px_24px_rgba(52,199,154,0.34)] hover:brightness-[0.99]",
        secondary:
          "border border-[#DDEAE5] bg-[rgba(255,255,255,0.78)] text-[#2F4A43] shadow-[inset_0_1px_0_rgba(255,255,255,0.84)] hover:border-[#34C79A] hover:text-[#08785C] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.88)] dark:text-[#D8EEE6] dark:hover:border-[#34C79A] dark:hover:text-white",
        outline:
          "border border-[#DDEAE5] bg-[rgba(255,255,255,0.78)] text-[#2F4A43] shadow-[inset_0_1px_0_rgba(255,255,255,0.84)] hover:border-[#34C79A] hover:text-[#08785C] hover:bg-[#F7FBF9] dark:border-[#294038] dark:bg-[rgba(19,31,27,0.88)] dark:text-[#D8EEE6] dark:hover:border-[#34C79A] dark:hover:bg-[#172722] dark:hover:text-white",
        ghost: "text-[#71867F] hover:bg-[#ECFBF6] hover:text-[#08785C] dark:text-[#94ADA4] dark:hover:bg-[#162620] dark:hover:text-[#E8F8F1]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
