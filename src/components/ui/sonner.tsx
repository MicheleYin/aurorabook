import type { ToasterProps } from "sonner";
import { type CSSProperties } from "react";
import {
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
} from "lucide-react";
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

export function Toaster({ toastOptions, style, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      className="toaster group"
      icons={{
        success: <CircleCheck className="h-4 w-4 shrink-0" />,
        info: <Info className="h-4 w-4 shrink-0" />,
        warning: <TriangleAlert className="h-4 w-4 shrink-0" />,
        error: <OctagonX className="h-4 w-4 shrink-0" />,
        loading: <Loader2 className="h-4 w-4 shrink-0 animate-spin" />,
      }}
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
