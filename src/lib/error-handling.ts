/**
 * Error handling utilities for consistent error management across the application
 */

import { logger } from './logger';
import { toast } from 'sonner';

/**
 * Handle async errors with consistent logging and user feedback
 * 
 * @param error - The error that occurred
 * @param context - Context string for logging (e.g., component/function name)
 * @param userMessage - Optional user-friendly message to show in toast
 * @param options - Additional options for error handling
 */
export function handleAsyncError(
  error: unknown,
  context: string,
  userMessage?: string,
  options?: {
    logLevel?: 'error' | 'warn' | 'debug';
    showToast?: boolean;
  }
): void {
  const { logLevel = 'error', showToast = true } = options || {};
  
  // Log the error with context
  const logContext = `[${context}]`;
  if (logLevel === 'error') {
    logger.error(logContext, error);
  } else if (logLevel === 'warn') {
    logger.warn(logContext, error);
  } else {
    logger.debug(logContext, error);
  }
  
  // Show user-friendly toast if enabled
  if (showToast) {
    const message = userMessage || getDefaultErrorMessage(error);
    toast.error(message, {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get a default error message based on error type
 */
function getDefaultErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Provide more specific messages for common error types
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return 'Network error occurred';
    }
    if (error.message.includes('permission') || error.message.includes('access')) {
      return 'Permission denied';
    }
    if (error.message.includes('not found')) {
      return 'Resource not found';
    }
    return 'An error occurred';
  }
  return 'An unexpected error occurred';
}

/**
 * Wrap an async function with error handling
 * 
 * @param fn - The async function to wrap
 * @param context - Context string for logging
 * @param userMessage - Optional user-friendly message
 * @returns The wrapped function that handles errors
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: string,
  userMessage?: string
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleAsyncError(error, context, userMessage);
      throw error; // Re-throw to allow caller to handle if needed
    }
  }) as T;
}

/**
 * Safely execute an async operation, returning null on error instead of throwing
 * Useful for operations that shouldn't block the UI
 * 
 * @param operation - The async operation to execute
 * @param context - Context string for logging
 * @param userMessage - Optional user-friendly message
 * @returns The result of the operation, or null if an error occurred
 */
export async function safeAsync<T>(
  operation: () => Promise<T>,
  context: string,
  userMessage?: string
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    handleAsyncError(error, context, userMessage, { showToast: false });
    return null;
  }
}

