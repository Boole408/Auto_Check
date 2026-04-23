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
        className={cn("relative h-2.5 w-full overflow-hidden rounded-full bg-muted", className)}
        {...props}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500", indicatorClassName)}
          style={{ width: `${Math.min(safeValue, 100)}%` }}
        />
      </div>
    );
  }
);
Progress.displayName = "Progress";

export { Progress };
