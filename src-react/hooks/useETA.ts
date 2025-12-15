/**
 * Hook for calculating ETA (Estimated Time to Arrival) using exponentially decaying average
 * This provides smoother, more stable estimates by giving more weight to recent measurements
 * while still considering historical data.
 */

import { useEffect, useRef, useState } from "react";

type UseETAParams = {
  /** Current progress as a percentage (0-100) */
  progressPercent: number;
  /** Reference to the start time timestamp (in milliseconds) */
  startTimeRef?: React.MutableRefObject<number | null>;
  /** Whether the process is active */
  isActive?: boolean;
  /** Smoothing factor (alpha) between 0 and 1. Higher = more responsive, Lower = more stable. Default: 0.3 */
  smoothingFactor?: number;
  /** Update interval in milliseconds. Default: 1000 (1 second) */
  updateInterval?: number;
};

/**
 * Formats milliseconds into a human-readable ETA string
 */
function formatETA(remainingMs: number): string {
  if (remainingMs <= 0) {
    return "";
  }

  const seconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Custom hook for calculating ETA using exponentially weighted moving average (EWMA)
 * 
 * The exponentially decaying average formula:
 *   new_average = alpha * new_value + (1 - alpha) * old_average
 * 
 * Where alpha is the smoothing factor. A smaller alpha (e.g., 0.1-0.3) gives more
 * weight to historical data (smoother, more stable), while a larger alpha (e.g., 0.5-0.9)
 * gives more weight to recent data (more responsive, but more volatile).
 */
export function useETA({
  progressPercent,
  startTimeRef,
  isActive = true,
  smoothingFactor = 0.3,
  updateInterval = 1000,
}: UseETAParams): string | null {
  const [eta, setEta] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Store the exponentially weighted average of remaining time
  const smoothedRemainingRef = useRef<number | null>(null);
  // Track the last progress to detect changes
  const lastProgressRef = useRef<number>(progressPercent);
  // Track the last update time to calculate time deltas
  const lastUpdateTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // Reset state when inactive or invalid
    if (
      !isActive ||
      !startTimeRef?.current ||
      progressPercent <= 0 ||
      progressPercent >= 100
    ) {
      setEta(null);
      smoothedRemainingRef.current = null;
      lastProgressRef.current = progressPercent;
      lastUpdateTimeRef.current = null;
      
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const updateETA = () => {
      const now = Date.now();
      const elapsed = now - startTimeRef.current!;
      const progressDecimal = progressPercent / 100;

      if (progressDecimal > 0 && progressDecimal < 1) {
        // Calculate current instantaneous estimate
        const estimatedTotal = elapsed / progressDecimal;
        const instantaneousRemaining = estimatedTotal - elapsed;

        if (instantaneousRemaining > 0) {
          // Apply exponentially weighted moving average
          if (smoothedRemainingRef.current === null) {
            // First measurement: use it directly
            smoothedRemainingRef.current = instantaneousRemaining;
          } else {
            // Update with exponentially decaying average
            // new_average = alpha * new_value + (1 - alpha) * old_average
            smoothedRemainingRef.current =
              smoothingFactor * instantaneousRemaining +
              (1 - smoothingFactor) * smoothedRemainingRef.current;
          }

          // Format and set ETA
          const formatted = formatETA(smoothedRemainingRef.current);
          setEta(formatted);
        } else {
          setEta(null);
          smoothedRemainingRef.current = null;
        }
      } else {
        setEta(null);
        smoothedRemainingRef.current = null;
      }

      lastProgressRef.current = progressPercent;
      lastUpdateTimeRef.current = now;
    };

    // Update ETA immediately
    updateETA();

    // Update ETA at regular intervals
    intervalRef.current = setInterval(updateETA, updateInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive, startTimeRef, progressPercent, smoothingFactor, updateInterval]);

  return eta;
}

