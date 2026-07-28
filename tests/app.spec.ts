import { expect, test } from "@playwright/test";

/**
 * Phase 5 — UI stays at smoke coverage.
 * Do not expand Playwright into shadcn/layout pixel assertions; dense logic
 * is covered by Vitest (lib/context/hooks) and Rust llvm-cov gates.
 */
test.describe("AuroraBook", () => {
  test("renders the library screen header and add-book action", async ({
    page,
  }) => {
    await page.goto("/");

    // Browser-only smoke: Tauri IPC fails, library still loads empty state.
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
