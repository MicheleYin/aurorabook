import { expect, test } from "@playwright/test";

/**
 * Smoke coverage against the Vite app with mocked Tauri IPC
 * (`VITE_E2E_MOCK=1` via playwright.config.ts).
 * Dense logic stays in Vitest; native WebView E2E lives under e2e-tauri/.
 */
test.describe("AuroraBook", () => {
  test("renders the library screen header and add-book action", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Library" }),
    ).toBeVisible({ timeout: 30_000 });

    await expect(
      page.getByRole("button", { name: /Add Book/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("tab", { name: "Settings" }),
    ).toBeVisible();
  });
});
