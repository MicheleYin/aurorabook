import { useEffect, useState } from "react";

/**
 * Hook to detect if the current viewport is mobile (below 640px)
 * Uses Tailwind's `sm` breakpoint (640px) as the threshold
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 640;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };

    // Use matchMedia for better performance
    const mediaQuery = window.matchMedia("(max-width: 639px)");

    // Set initial value
    setIsMobile(mediaQuery.matches);

    // Listen for changes
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    // Modern browsers support addEventListener
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
      window.addEventListener("resize", handleResize);
      return () => {
        mediaQuery.removeListener(handleChange);
        window.removeEventListener("resize", handleResize);
      };
    }
  }, []);

  return isMobile;
}
