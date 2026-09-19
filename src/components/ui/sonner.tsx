import {
    CircleCheck,
    Info,
    Loader2,
    OctagonX,
    TriangleAlert,
} from "lucide-react";
import { type CSSProperties } from "react";
import type { ToasterProps } from "sonner";
import { Toaster as SonnerToaster } from "sonner";

const toastClassNames = {
  toast:
    "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg !px-4 !py-3.5 !gap-3 !text-sm !leading-snug",
  description: "group-[.toast]:text-muted-foreground !text-sm !leading-snug",
  title: "!text-sm !font-medium !leading-snug",
  actionButton:
    "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
  cancelButton:
    "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
} as const;

/** Sonner defaults (32 desktop / 16 mobile) plus top safe-area for notch/status bar. */
const SAFE_TOP_OFFSET = {
  desktop: "calc(32px + var(--app-safe-top, 0px))",
  mobile: "calc(16px + var(--app-safe-top, 0px))",
} as const;

export function Toaster({
  toastOptions,
  style,
  offset,
  mobileOffset,
  ...props
}: ToasterProps) {
  return (
    <SonnerToaster
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-4 shrink-0" />,
        info: <Info className="size-4 shrink-0" />,
        warning: <TriangleAlert className="size-4 shrink-0" />,
        error: <OctagonX className="size-4 shrink-0" />,
        loading: <Loader2 className="size-4 shrink-0 animate-spin" />,
      }}
      offset={offset ?? { top: SAFE_TOP_OFFSET.desktop }}
      mobileOffset={mobileOffset ?? { top: SAFE_TOP_OFFSET.mobile }}
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...toastClassNames,
          ...toastOptions?.classNames,
        },
      }}
      style={
        {
          "--border-radius": "var(--radius)",
          "--normal-bg": "hsl(var(--popover))",
          "--normal-border": "hsl(var(--border))",
          "--normal-text": "hsl(var(--popover-foreground))",
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  );
}
