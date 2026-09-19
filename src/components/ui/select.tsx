"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import {
  ComboboxTriggerActions,
  comboboxTriggerMinHeightClass,
  comboboxTriggerPadding,
  getComboboxTriggerWrapperClassName,
} from "@/components/ui/combobox-trigger-actions";
import { cn } from "@/lib/utils";

type SelectContextValue = {
  value?: string;
  clearable: boolean;
  open: boolean;
  disabled?: boolean;
  onClear: () => void;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const ctx = React.useContext(SelectContext);
  if (!ctx) {
    throw new Error("Select components must be used within <Select />");
  }
  return ctx;
}

type SelectProps = React.ComponentProps<typeof SelectPrimitive.Root> & {
  /** When false, the selection cannot be cleared; at least one option must remain selected. Default true. */
  clearable?: boolean;
  /** Radix only emits string values; `undefined` is used when clearing via the clear button. */
  onValueChange?: (value: string | undefined) => void;
};

function Select(props: SelectProps) {
  const {
    clearable = true,
    disabled,
    value: valueProp,
    defaultValue,
    open: openProp,
    defaultOpen,
    ...rootProps
  } = props;
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);

  const isValueControlled = valueProp !== undefined;
  const isOpenControlled = openProp !== undefined;

  const value = isValueControlled ? valueProp : internalValue;
  const open = isOpenControlled ? openProp : internalOpen;
  const rootValue = value ? value : undefined;

  const onValueChange = props.onValueChange
    ? (nextValue: string | undefined) => {
        props.onValueChange?.(nextValue);
      }
    : undefined;

  const onOpenChange = props.onOpenChange
    ? (nextOpen: boolean) => {
        props.onOpenChange?.(nextOpen);
      }
    : undefined;

  const handleValueChange = React.useCallback(
    (next: string) => {
      if (!isValueControlled) {
        setInternalValue(next);
      }
      onValueChange?.(next);
    },
    [isValueControlled, onValueChange],
  );

  const handleClear = React.useCallback(() => {
    if (!isValueControlled) {
      setInternalValue("");
    }
    onValueChange?.(undefined);
  }, [isValueControlled, onValueChange]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isOpenControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isOpenControlled, onOpenChange],
  );

  const contextValue = React.useMemo<SelectContextValue>(
    () => ({
      value: rootValue,
      clearable,
      open,
      disabled,
      onClear: handleClear,
    }),
    [rootValue, clearable, open, disabled, handleClear],
  );

  return (
    <SelectContext.Provider value={contextValue}>
      <SelectPrimitive.Root
        data-slot="select"
        {...rootProps}
        disabled={disabled}
        value={rootValue}
        onValueChange={handleValueChange}
        open={open}
        onOpenChange={handleOpenChange}
      />
    </SelectContext.Provider>
  );
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex min-w-0 flex-1 items-center gap-2 truncate line-clamp-1", className)}
      {...props}
    />
  );
}

function SelectTrigger({
  className,
  size = "default",
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  const ctx = useSelectContext();
  const isDisabled = disabled ?? ctx.disabled;
  const showClear = ctx.clearable && Boolean(ctx.value);
  const { wrapperClassName, triggerClassName } = getComboboxTriggerWrapperClassName(className);

  return (
    <div className={wrapperClassName} data-slot="select-trigger-wrapper">
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        data-size={size}
        disabled={isDisabled}
        className={cn(
          "border-input data-placeholder:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 shadow-xs flex w-full min-w-0 items-center justify-between gap-2 whitespace-nowrap rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=sm]:gap-1.5 data-[size=sm]:px-2 data-[size=sm]:py-1.5 data-[size=sm]:text-xs [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
          !ctx.value && "text-muted-foreground",
          comboboxTriggerMinHeightClass(size),
          triggerClassName,
          comboboxTriggerPadding(showClear, size),
        )}
        {...props}
      >
        <span className="flex min-w-0 flex-1 truncate text-left">{children}</span>
      </SelectPrimitive.Trigger>
      <ComboboxTriggerActions
        open={ctx.open}
        showClear={showClear}
        disabled={isDisabled}
        size={size}
        onClear={(event) => {
          event.preventDefault();
          event.stopPropagation();
          ctx.onClear();
        }}
      />
    </div>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "center",
  collisionPadding = 8,
  sticky = "always",
  updatePositionStrategy = "always",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-h-(--radix-select-content-available-height) max-w-(--radix-select-content-available-width) origin-(--radix-select-content-transform-origin) wrap-break-word relative z-50 min-w-32 overflow-y-auto overflow-x-hidden rounded-md border shadow-md [scrollbar-gutter:stable]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        align={align}
        collisionPadding={collisionPadding}
        sticky={sticky}
        updatePositionStrategy={updatePositionStrategy}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn("p-1", position === "popper" && "h-(--radix-select-trigger-height) min-w-(--radix-select-trigger-width) w-full scroll-my-1")}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label data-slot="select-label" className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)} {...props} />;
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground outline-hidden *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2 data-disabled:pointer-events-none data-disabled:opacity-50 relative flex w-full cursor-default select-none items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator data-slot="select-separator" className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)} {...props} />
  );
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn("flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn("flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
export type { SelectProps };
