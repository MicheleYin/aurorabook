/**
 * useBookConversion hook
 *
 * Provides access to conversion state and functions.
 * The actual state is managed in ConversionStateContext.
 * This hook is kept for backward compatibility and to provide
 * a clean API for components.
 */

import { useConversionState } from "../context/ConversionStateContext";

export function useBookConversion() {
  const {
    isConverting,
    convertingBookId,
    conversionProgress,
    eta,
    convertBook,
    cancelConversion,
    registerCallbacks,
  } = useConversionState();

  return {
    convertBook,
    cancelConversion,
    isConverting,
    convertingBookId,
    conversionProgress,
    eta,
    registerCallbacks,
  };
}
