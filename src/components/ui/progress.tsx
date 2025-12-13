import * as React from "react";

import { cn } from "@/lib/utils";
import { animPatterns } from "@/lib/animations";

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
  max?: number;
  animated?: boolean;
  showPulse?: boolean;
  showShimmer?: boolean;
  showWave?: boolean;
};

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ 
    className, 
    value = 0, 
    max = 100, 
    animated = true,
    showPulse = false,
    showShimmer = false,
    showWave = false,
    ...props 
  }, ref) => {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
    
    // Determine which animation pattern to use
    const fillAnimationClass = React.useMemo(() => {
      if (showShimmer) return animPatterns.progressBarShimmer;
      if (showPulse) return animPatterns.progressBarPulse;
      return animPatterns.progressBar;
    }, [showPulse, showShimmer]);

    return (
      <div
        ref={ref}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
          showWave && animPatterns.progressBarWave,
          className,
        )}
        {...props}
      >
        <div
          className={cn(
            "h-full bg-primary",
            animated && fillAnimationClass
          )}
          style={{ 
            width: `${percentage}%`,
            transition: animated ? "width 300ms ease-in-out" : "none"
          }}
        />
      </div>
    );
  },
);
Progress.displayName = "Progress";

export { Progress };

