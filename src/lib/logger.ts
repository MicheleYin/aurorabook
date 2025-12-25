/**
 * Logger utility that is disabled in production
 * Uses console methods in development, no-op in production
 */

const isProduction = import.meta.env.PROD;

interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
}

const noop = () => {
  // No-op function for production
};

export const logger: Logger = isProduction
  ? {
      log: noop,
      error: noop,
      warn: noop,
      debug: noop,
      info: noop,
    }
  : {
      log: (...args: unknown[]) => console.log(...args),
      error: (...args: unknown[]) => console.error(...args),
      warn: (...args: unknown[]) => console.warn(...args),
      debug: (...args: unknown[]) => console.debug(...args),
      info: (...args: unknown[]) => console.info(...args),
    };
