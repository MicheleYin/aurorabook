/**
 * Shared debounce and throttle utilities
 */

export type DebounceOptions = {
  delay: number;
  immediate?: boolean;
};

/**
 * Creates a debounced function that delays execution until after wait time
 */
export function createDebounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): {
  call: (...args: Parameters<T>) => void;
  cancel: () => void;
  flush: () => void;
} {
  let timeoutId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  const cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  const flush = () => {
    if (lastArgs !== null && timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };

  const call = (...args: Parameters<T>) => {
    lastArgs = args;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      const argsToCall = lastArgs;
      lastArgs = null;
      if (argsToCall !== null) {
        fn(...argsToCall);
      }
    }, delay);
  };

  return { call, cancel, flush };
}

/**
 * Creates a throttled function that limits execution frequency
 */
export function createThrottle<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): {
  call: (...args: Parameters<T>) => void;
  cancel: () => void;
} {
  let lastCallTime = 0;
  let timeoutId: number | null = null;
  let lastArgs: Parameters<T> | null = null;

  const cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };

  const call = (...args: Parameters<T>) => {
    lastArgs = args;
    const now = Date.now();
    const timeSinceLastCall = now - lastCallTime;

    if (timeSinceLastCall >= delay) {
      lastCallTime = now;
      fn(...args);
      lastArgs = null;
    } else if (timeoutId === null) {
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        lastCallTime = Date.now();
        const argsToCall = lastArgs;
        lastArgs = null;
        if (argsToCall !== null) {
          fn(...argsToCall);
        }
      }, delay - timeSinceLastCall);
    }
  };

  return { call, cancel };
}

