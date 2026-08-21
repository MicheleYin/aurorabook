import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const HOST = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${HOST}:${PORT}`;

/**
 * Playwright drives the Vite frontend with `VITE_E2E_MOCK=1`, which aliases
 * `@tauri-apps/*` to in-process IPC mocks seeded from `tests/fixtures/ipc/`.
 *
 * That is the CI-friendly "browser E2E" layer. True native WebView testing
 * uses WebdriverIO + `@wdio/tauri-service` under `e2e-tauri/`.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `VITE_E2E_MOCK=1 bun run dev -- --host ${HOST} --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_E2E_MOCK: "1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
