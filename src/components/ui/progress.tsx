import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  indicatorClassName?: string;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, indicatorClassName, ...props }, ref) => {
    const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), 140) : 0;

    return (
      <div
        ref={ref}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-[#E7F0EC] shadow-[inset_0_1px_2px_rgba(16,42,36,0.04)] dark:bg-[#1A2B25] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]",
          className
        )}
        {...props}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]", indicatorClassName)}
          style={{ width: `${Math.min(safeValue, 100)}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
