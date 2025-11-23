import { test, expect } from "@playwright/test";

test.describe("Whisperleaf Reader", () => {
  test("renders the home screen header and library call-to-action", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Whisperleaf Reader" }),
    ).toBeVisible();

    await expect(
      page.getByText(/Import any EPUB, browse its chapters/i),
    ).toBeVisible();

    await expect(page.getByRole("button", { name: /Add ebook/i })).toBeVisible();
  });
});

