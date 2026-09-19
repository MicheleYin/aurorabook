"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import * as React from "react";

import { isPopoverInteraction, isToastInteraction, separateInsideScrollChildren } from "@/lib/dialog-utils";
import { cn } from "@/lib/utils";

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

type MaxWidth = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl" | "7xl" | "full";

const maxWidthClasses: Record<MaxWidth, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
  "4xl": "sm:max-w-4xl",
  "5xl": "sm:max-w-5xl",
  "6xl": "sm:max-w-6xl",
  "7xl": "sm:max-w-7xl",
  full: "sm:max-w-full",
};

function resolveMaxWidthClass(maxWidth: MaxWidth): string {
  switch (maxWidth) {
    case "sm":
      return maxWidthClasses.sm;
    case "md":
      return maxWidthClasses.md;
    case "lg":
      return maxWidthClasses.lg;
    case "xl":
      return maxWidthClasses.xl;
    case "2xl":
      return maxWidthClasses["2xl"];
    case "3xl":
      return maxWidthClasses["3xl"];
    case "4xl":
      return maxWidthClasses["4xl"];
    case "5xl":
      return maxWidthClasses["5xl"];
    case "6xl":
      return maxWidthClasses["6xl"];
    case "7xl":
      return maxWidthClasses["7xl"];
    case "full":
      return maxWidthClasses.full;
  }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  scrollable,
  maxWidth = "2xl",
  disableOutsideClose = false,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  scrollable?: "inside" | "outside";
  maxWidth?: MaxWidth;
  disableOutsideClose?: boolean;
}) {
  const isInsideScroll = scrollable === "inside";
  const isOutsideScroll = scrollable === "outside";

  const { headerElement, footerElement, contentElements } = isInsideScroll
    ? separateInsideScrollChildren(children)
    : { headerElement: null, footerElement: null, contentElements: [] as React.ReactNode[] };

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          if (isToastInteraction(event) || isPopoverInteraction(event)) {
            event.preventDefault();
            return;
          }

          if (disableOutsideClose) {
            event.preventDefault();
          }
        }}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed left-[50%] top-[50%] z-50 w-full min-w-0 max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] rounded-lg border shadow-lg duration-200",
          resolveMaxWidthClass(maxWidth),
          // Outside scroll: keep overflow off this node so the dialog-scoped Sonner toaster is not clipped
          // (same idea as inside scroll — toaster sits beside the scrollable region, not inside it).
          isOutsideScroll && "flex max-h-[calc(100vh-4rem)] min-h-0 flex-col p-6",
          isInsideScroll && "flex max-h-[calc(100vh-4rem)] flex-col p-0",
          !isInsideScroll && !isOutsideScroll && "grid min-w-0 gap-4 p-6",
          className,
        )}
        {...props}
      >
        {isInsideScroll ? (
          <>
            {headerElement && <div className="shrink-0 px-6 pt-6">{headerElement}</div>}
            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6"
              onWheel={(e) => {
                const el = e.currentTarget;
                const canScrollUp = el.scrollTop > 0;
                const canScrollDown = el.scrollTop < el.scrollHeight - el.clientHeight;
                if ((e.deltaY < 0 && canScrollUp) || (e.deltaY > 0 && canScrollDown)) {
                  e.preventDefault();
                  el.scrollTop += e.deltaY;
                }
              }}
            >
              {contentElements}
            </div>
            {footerElement && <div className="shrink-0 px-6 pb-6">{footerElement}</div>}
          </>
        ) : isOutsideScroll ? (
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div className="grid min-w-0 gap-4">{children}</div>
          </div>
        ) : (
          children
        )}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground rounded-xs focus:outline-hidden absolute right-4 top-4 opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-2 text-center sm:text-left", className)} {...props} />;
}
DialogHeader.displayName = "DialogHeader";

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}
DialogFooter.displayName = "DialogFooter";

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-lg font-semibold leading-none", className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-muted-foreground text-sm", className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
