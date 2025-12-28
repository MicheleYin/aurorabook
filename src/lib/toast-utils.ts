import { toast } from "sonner";

// Track the current loading toast ID to ensure only one is shown at a time
let currentLoadingToastId: string | null = null;

/**
 * Shows a loading toast, dismissing any existing loading toast with a different ID first.
 * If updating a toast with the same ID, it will update the existing toast instead of dismissing it.
 * Ensures only one loading toast is visible at a time.
 *
 * @param message - The message to display in the toast
 * @param id - Optional custom ID for the toast. If not provided, uses a default ID.
 * @returns The toast ID
 */
export function showLoadingToast(message: string, id?: string): string {
  const toastId = id || "loading";

  // If we're updating the same toast, just update it (sonner handles this automatically)
  // Otherwise, dismiss any existing loading toast with a different ID
  if (currentLoadingToastId && currentLoadingToastId !== toastId) {
    toast.dismiss(currentLoadingToastId);
  }

  // Show or update the loading toast (sonner will update if ID matches existing toast)
  toast.loading(message, { id: toastId });
  currentLoadingToastId = toastId;

  return toastId;
}

/**
 * Dismisses the current loading toast if one is active.
 *
 * @param id - Optional specific toast ID to dismiss. If not provided, dismisses the tracked loading toast.
 */
export function dismissLoadingToast(id?: string): void {
  if (id) {
    toast.dismiss(id);
    if (currentLoadingToastId === id) {
      currentLoadingToastId = null;
    }
  } else if (currentLoadingToastId) {
    toast.dismiss(currentLoadingToastId);
    currentLoadingToastId = null;
  }
}

/**
 * Updates a loading toast to success, dismissing it from tracking.
 *
 * @param message - The success message
 * @param id - The toast ID to update
 */
export function updateLoadingToastToSuccess(message: string, id: string): void {
  toast.success(message, { id });
  if (currentLoadingToastId === id) {
    currentLoadingToastId = null;
  }
}

/**
 * Updates a loading toast to error, dismissing it from tracking.
 *
 * @param message - The error message
 * @param id - The toast ID to update
 */
export function updateLoadingToastToError(message: string, id: string): void {
  toast.error(message, { id });
  if (currentLoadingToastId === id) {
    currentLoadingToastId = null;
  }
}

