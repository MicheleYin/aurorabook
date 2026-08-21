import { expect, test } from "@playwright/test";

/**
 * Browser E2E with mocked Tauri IPC (`VITE_E2E_MOCK=1`).
 * Exercises library → reader against wire-format book fixtures.
 * Native WebView ↔ Rust coverage lives under `e2e-tauri/` (WebdriverIO).
 */
test.describe("Library → Reader (mock Tauri IPC)", () => {
  test("lists seeded book and opens the reader", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Library" }),
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText("The Mocked Voyage")).toBeVisible();
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expect(page.getByText("1 book")).toBeVisible();

    const bookCard = page.getByTestId("library-book-book-e2e-001");
    await expect(bookCard).toBeVisible();
    await bookCard.getByRole("button", { name: "Open" }).click();

    // Reader tab becomes available once a book is open.
    const readerTab = page.getByRole("tab", { name: "Reader" });
    await expect(readerTab).toBeEnabled({ timeout: 15_000 });
    await expect(readerTab).toHaveAttribute("data-state", "active");

    // Chapter HTML from the IPC fixture should render in the reader.
    await expect(page.getByText(/engines hummed/i)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("settings tab remains reachable", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Library" }),
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "data-state",
      "active",
    );
  });
});
