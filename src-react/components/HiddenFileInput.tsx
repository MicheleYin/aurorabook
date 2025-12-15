import { forwardRef, memo } from "react";

export type HiddenFileInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>;

const HiddenFileInputComponent = forwardRef<HTMLInputElement, HiddenFileInputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="file"
      className={["hidden", className].filter(Boolean).join(" ")}
      {...props}
    />
  ),
);

HiddenFileInputComponent.displayName = "HiddenFileInput";

export const HiddenFileInput = memo(HiddenFileInputComponent, (prevProps, nextProps) => {
  // Compare className
  if (prevProps.className !== nextProps.className) return false;
  
  // Compare other input props - check key ones
  if (
    prevProps.accept !== nextProps.accept ||
    prevProps.multiple !== nextProps.multiple ||
    prevProps.disabled !== nextProps.disabled ||
    prevProps.onChange !== nextProps.onChange
  ) {
    return false;
  }
  
  // For other props, assume they're stable if the component reference is the same
  // This is a simple component, so shallow comparison should be sufficient
  return true;
});

