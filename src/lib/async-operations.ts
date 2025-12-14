/**
 * Standardized Async Operation Utilities
 * 
 * Provides consistent patterns for:
 * - Loading state management
 * - Cancellation support
 * - Error recovery with retry logic
 * - Error handling and logging
 */

import { logger } from "./logger";

/**
 * Standard loading state for single operations
 */
export type LoadingState = {
  isLoading: boolean;
  error: Error | null;
};

/**
 * Standard loading states for multiple operations
 */
export type MultiLoadingState<T extends string> = {
  [K in T]: boolean;
} & {
  error: Error | null;
};

/**
 * Options for async operations with retry
 */
export type AsyncOperationOptions = {
  /**
   * Maximum number of retries (default: 0)
   */
  maxRetries?: number;
  
  /**
   * Delay between retries in milliseconds (default: 1000)
   */
  retryDelay?: number;
  
  /**
   * Function to determine if an error should be retried
   * Returns true if the error is transient and should be retried
   */
  shouldRetry?: (error: Error) => boolean;
  
  /**
   * AbortSignal for cancellation
   */
  signal?: AbortSignal;
  
  /**
   * Operation name for logging
   */
  operationName?: string;
  
  /**
   * Whether to log errors (default: true)
   */
  logErrors?: boolean;
};

/**
 * Default retry predicate - retries on network errors and timeouts
 */
const defaultShouldRetry = (error: Error): boolean => {
  const message = error.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("fetch") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("enotfound")
  );
};

/**
 * Execute an async operation with retry logic and cancellation support
 * 
 * @param operation - The async operation to execute
 * @param options - Operation options (retry, cancellation, etc.)
 * @returns Promise that resolves with the operation result
 */
export async function executeWithRetry<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  options: AsyncOperationOptions = {}
): Promise<T> {
  const {
    maxRetries = 0,
    retryDelay = 1000,
    shouldRetry = defaultShouldRetry,
    signal,
    operationName = "Operation",
    logErrors = true,
  } = options;

  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    // Check for cancellation before each attempt
    if (signal?.aborted) {
      throw new Error(`${operationName} was cancelled`);
    }

    try {
      const result = await operation(signal);
      
      // Log success if we retried
      if (attempt > 0) {
        logger.log(`[AsyncOperation] ${operationName} succeeded after ${attempt} retry(ies)`);
      }
      
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check for cancellation
      if (signal?.aborted) {
        throw new Error(`${operationName} was cancelled`);
      }
      
      // Log error
      if (logErrors) {
        logger.error(`[AsyncOperation] ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}):`, {
          error: lastError.message,
          attempt: attempt + 1,
          maxRetries,
        });
      }
      
      // Check if we should retry
      const canRetry = attempt < maxRetries && shouldRetry(lastError);
      
      if (!canRetry) {
        // Don't retry - throw the error
        throw lastError;
      }
      
      // Wait before retrying
      attempt++;
      if (attempt <= maxRetries) {
        logger.log(`[AsyncOperation] Retrying ${operationName} in ${retryDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        
        // Wait with cancellation support
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error(`${operationName} was cancelled`));
            return;
          }
          
          const timeoutId = setTimeout(() => {
            if (signal?.aborted) {
              reject(new Error(`${operationName} was cancelled`));
            } else {
              resolve();
            }
          }, retryDelay);
          
          // Clean up timeout if cancelled
          signal?.addEventListener("abort", () => {
            clearTimeout(timeoutId);
            reject(new Error(`${operationName} was cancelled`));
          });
        });
      }
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error(`${operationName} failed after ${maxRetries + 1} attempts`);
}

/**
 * Create a loading state manager for a single operation
 */
export function createLoadingState(): {
  state: LoadingState;
  setLoading: (loading: boolean) => void;
  setError: (error: Error | null) => void;
  reset: () => void;
} {
  let state: LoadingState = {
    isLoading: false,
    error: null,
  };

  const setLoading = (loading: boolean) => {
    state = { ...state, isLoading: loading };
  };

  const setError = (error: Error | null) => {
    state = { ...state, error, isLoading: false };
  };

  const reset = () => {
    state = { isLoading: false, error: null };
  };

  return {
    get state() {
      return state;
    },
    setLoading,
    setError,
    reset,
  };
}

/**
 * Create an AbortController that can be cancelled
 */
export function createCancellableOperation(): {
  controller: AbortController;
  cancel: () => void;
  isCancelled: () => boolean;
} {
  const controller = new AbortController();

  return {
    controller,
    cancel: () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    },
    isCancelled: () => controller.signal.aborted,
  };
}

/**
 * Wrap an async operation with standard error handling
 * 
 * @param operation - The async operation
 * @param options - Operation options
 * @returns Promise with standardized error handling
 */
export async function withErrorHandling<T>(
  operation: () => Promise<T>,
  options: {
    operationName?: string;
    onError?: (error: Error) => void;
    showToast?: boolean;
  } = {}
): Promise<T | null> {
  const { operationName = "Operation", onError, showToast = false } = options;

  try {
    return await operation();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    
    logger.error(`[AsyncOperation] ${operationName} failed:`, {
      error: err.message,
      stack: err.stack,
    });

    if (onError) {
      onError(err);
    }

    if (showToast) {
      // Import toast dynamically to avoid circular dependencies
      import("sonner").then(({ toast }) => {
        toast.error(`${operationName} failed: ${err.message}`);
      });
    }

    return null;
  }
}

/**
 * Check if an operation should be retried based on error type
 */
export function isRetryableError(error: Error): boolean {
  return defaultShouldRetry(error);
}

/**
 * Create a delay that respects cancellation
 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Operation was cancelled"));
      return;
    }

    const timeoutId = setTimeout(() => {
      if (signal?.aborted) {
        reject(new Error("Operation was cancelled"));
      } else {
        resolve();
      }
    }, ms);

    signal?.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      reject(new Error("Operation was cancelled"));
    });
  });
}
