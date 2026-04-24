import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold backdrop-blur-sm transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[linear-gradient(135deg,#34C79A,#22B889)] text-white",
        secondary:
          "border-[#DDEAE5] bg-[rgba(255,255,255,0.78)] text-[#2F4A43] dark:border-[#294038] dark:bg-[rgba(20,31,27,0.88)] dark:text-[#D7ECE4]",
        outline: "border-[#DDEAE5] bg-[#F3F8F5] text-[#4D625B] dark:border-[#294038] dark:bg-[#16241f] dark:text-[#A3BBB3]",
        success: "border-[#BDEDDD] bg-[#E6FAF2] text-[#08785C] dark:text-[#08785C]",
        warning: "border-[#F7D9A6] bg-[#FFF5E6] text-[#A66A12] dark:border-[#6A5328] dark:bg-[#2E2616] dark:text-[#F0C067]",
        destructive: "border-[#F4C5C5] bg-[#FDECEC] text-[#C84F4F] dark:border-[#613131] dark:bg-[#2C1B1B] dark:text-[#F18D8D]"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
