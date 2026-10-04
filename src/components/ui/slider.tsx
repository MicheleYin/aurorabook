"use client";

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(
  (
    {
      className,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    ref
  ) => {
    const value = props.value ?? props.defaultValue ?? [0];
    const thumbCount = Array.isArray(value) ? value.length : 1;

    return (
      <SliderPrimitive.Root
        ref={ref}
        data-slot="slider"
        className={cn(
          "relative flex w-full touch-none select-none items-center",
          className
        )}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        {...props}
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="bg-primary/20 relative h-2 w-full grow overflow-hidden rounded-full"
        >
          <SliderPrimitive.Range
            data-slot="slider-range"
            className="bg-primary absolute h-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }, (_, index) => (
          <SliderPrimitive.Thumb
            key={`slider-thumb-${index}`}
            data-slot="slider-thumb"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className="bg-background border-primary/50 ring-offset-background focus-visible:ring-ring dark:border-primary block size-4 rounded-full border-2 shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Root>
    );
  }
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
