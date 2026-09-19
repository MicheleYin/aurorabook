import * as React from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const COMBOBOX_POPOVER_MIN_WIDTH_PX = 240;

export function getComboboxPopoverStyle(triggerWidth?: number): React.CSSProperties | undefined {
  if (triggerWidth === undefined) return undefined;
  const width = Math.max(triggerWidth, COMBOBOX_POPOVER_MIN_WIDTH_PX);
  return { width, minWidth: width };
}

export function comboboxTriggerPadding(showClear: boolean, size: "sm" | "default" = "default") {
  if (size === "sm") {
    return showClear ? "pr-14" : "pr-8";
  }
  return showClear ? "pr-16" : "pr-9";
}

const COMBOBOX_TRIGGER_WIDTH_CLASS_PATTERN = /\b(?:min-w|max-w|w)-[^\s]+/g;

/** Width utilities belong on the outer wrapper so clear/chevron align with the trigger edge. */
export function getComboboxTriggerWrapperClassName(className?: string) {
  const widthClasses = className?.match(COMBOBOX_TRIGGER_WIDTH_CLASS_PATTERN)?.join(" ");
  const triggerClassName = className?.replace(COMBOBOX_TRIGGER_WIDTH_CLASS_PATTERN, "").replace(/\s+/g, " ").trim();

  return {
    wrapperClassName: cn("relative min-w-0", widthClasses ?? "w-full"),
    triggerClassName: triggerClassName || undefined,
  };
}

export function comboboxTriggerMinHeightClass(size: "sm" | "default" = "default") {
  return size === "sm" ? "min-h-8" : "min-h-9";
}

export function comboboxEmptyMinHeightClass(isEmpty: boolean, size: "sm" | "default" = "default") {
  if (!isEmpty) return undefined;
  return comboboxTriggerMinHeightClass(size);
}

export interface ComboboxTriggerActionsProps {
  open: boolean;
  showClear: boolean;
  onClear: (event: React.MouseEvent | React.KeyboardEvent) => void;
  /** When set, the chevron becomes a button that toggles the popover. */
  onToggle?: (event: React.MouseEvent | React.KeyboardEvent) => void;
  clearLabel?: string;
  toggleLabel?: string;
  size?: "sm" | "default";
  disabled?: boolean;
}

export function ComboboxTriggerActions({
  open,
  showClear,
  onClear,
  onToggle,
  clearLabel = "Clear selection",
  toggleLabel = "Toggle suggestions",
  size = "default",
  disabled = false,
}: Readonly<ComboboxTriggerActionsProps>) {
  const chevron = <ChevronDownIcon className={cn("size-4 shrink-0 opacity-50 transition-transform", open && "rotate-180")} />;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 flex items-center gap-0.5",
        size === "sm" ? "right-2" : "right-3",
      )}
    >
      {showClear && (
        <button
          type="button"
          disabled={disabled}
          onClick={onClear}
          className={cn(
            "pointer-events-auto rounded-sm p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            !disabled && "hover:bg-accent",
          )}
          aria-label={clearLabel}
        >
          <XIcon className="size-3.5" />
        </button>
      )}
      {onToggle ? (
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-label={toggleLabel}
          onMouseDown={(event) => {
            // Keep focus on the input and avoid Radix treating this as an outside click.
            event.preventDefault();
          }}
          onClick={onToggle}
          className={cn(
            "pointer-events-auto rounded-sm p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            !disabled && "hover:bg-accent",
          )}
        >
          {chevron}
        </button>
      ) : (
        chevron
      )}
    </div>
  );
}
