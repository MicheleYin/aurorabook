/**
 * Public support contact and debug UI flags.
 * Override at build/dev time with Vite env vars (see `.env.example`).
 */
export const SUPPORT_EMAIL =
  (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() ||
  "michele.yin.games@gmail.com";

/** When true, the Settings → General logs section is visible. */
export const SHOW_LOGS =
  import.meta.env.VITE_SHOW_LOGS === "1" ||
  import.meta.env.VITE_SHOW_LOGS === "true";
