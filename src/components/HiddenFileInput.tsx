import { forwardRef } from "react";

export type HiddenFileInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
>;

export const HiddenFileInput = forwardRef<HTMLInputElement, HiddenFileInputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="file"
      className={["hidden", className].filter(Boolean).join(" ")}
      {...props}
    />
  ),
);

HiddenFileInput.displayName = "HiddenFileInput";

