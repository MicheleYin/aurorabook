"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function ScrollArea({ className, children, tabIndex = 0, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="scroll-area" tabIndex={tabIndex} className={cn("overflow-auto", className)} {...props}>
      {children}
    </div>
  );
}

function ScrollBar(_props: React.ComponentProps<"div">) {
  // Kept for backwards compatibility; native browser scrollbars are used instead.
  void _props;
  return null;
}

export { ScrollArea, ScrollBar };
