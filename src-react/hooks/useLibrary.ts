/**
 * Library hook - now a thin wrapper around LibraryContext
 * 
 * This hook provides access to library state and operations through React Context.
 * The actual implementation is split across multiple modules in the library/ directory.
 */

import { useLibraryContext } from "./library/LibraryContext";
import type { LibraryContextValue } from "./library/types";

export type UseLibraryReturn = LibraryContextValue;

/**
 * Hook to access library state and operations.
 * Must be used within a LibraryProvider.
 */
export function useLibrary(): UseLibraryReturn {
  return useLibraryContext();
}
