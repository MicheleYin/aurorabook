import { useEffect, useRef, useState } from "react";

/**
 * Hook to animate a number from its current value to a target value
 * @param targetValue - The target number to animate to
 * @param duration - Animation duration in milliseconds (default: 500)
 * @param easing - Easing function (default: easeOut)
 * @returns The current animated value
 */
export function useAnimatedNumber(
  targetValue: number,
  duration: number = 500,
  easing: (t: number) => number = easeOut
): number {
  const [animatedValue, setAnimatedValue] = useState(targetValue);
  const animationFrameRef = useRef<number | null>(null);
  const animatedValueRef = useRef(targetValue);
  const previousTargetRef = useRef(targetValue);

  // Keep ref in sync with state
  useEffect(() => {
    animatedValueRef.current = animatedValue;
  }, [animatedValue]);

  useEffect(() => {
    // If the value hasn't changed, don't animate
    if (previousTargetRef.current === targetValue) {
      return;
    }

    // Cancel any ongoing animation
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // If target changes significantly (e.g., reset), update immediately
    const currentValue = animatedValueRef.current;
    if (Math.abs(targetValue - currentValue) > 50) {
      setAnimatedValue(targetValue);
      previousTargetRef.current = targetValue;
      return;
    }

    const startValue = currentValue;
    const difference = targetValue - startValue;
    const startTime = performance.now();
    previousTargetRef.current = targetValue;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easing(progress);
      const newValue = startValue + difference * easedProgress;

      setAnimatedValue(newValue);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Ensure we end exactly at the target value
        setAnimatedValue(targetValue);
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [targetValue, duration, easing]);

  return Math.round(animatedValue);
}

/**
 * Easing function: easeOut
 */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Easing function: easeInOut
 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

