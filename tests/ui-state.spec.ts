import { expect, test } from "@playwright/test";

import {
  openBook,
  waitForAudioRestored,
  waitForLibrary,
} from "./helpers/e2e";

test.describe("UI state correctness (mock Tauri IPC)", () => {
  test("1. open book restores saved audio time", async ({ page }) => {
    await page.goto("/");
    await waitForLibrary(page);
    await openBook(page, "book-e2e-001");

    await expect(page.getByText(/engines hummed/i)).toBeVisible({
      timeout: 15_000,
    });
    await waitForAudioRestored(page, 12);
    await expect(page.getByTestId("audio-current-time")).toHaveText("0:12", {
      timeout: 10_000,
    });
  });

  test("2. open book restores saved chapter and element", async ({ page }) => {
    await page.goto("/");
    await waitForLibrary(page);
    await openBook(page, "book-e2e-001");

    await expect(page.getByTestId("reader-scroll-container")).toBeVisible({
      timeout: 15_000,
    });
    const paragraph = page.locator("#p1");
    await expect(paragraph).toBeVisible();
    await expect(paragraph).toContainText(/engines hummed/i);

    await expect
      .poll(async () =>
        paragraph.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top >= 0 && rect.top < window.innerHeight;
        }),
      )
      .toBe(true);
  });

  test("3. loading indicators for library, chapter, and audio", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as unknown as {
          __AURORA_E2E_BOOT__?: Record<string, number>;
        }
      ).__AURORA_E2E_BOOT__ = {
        libraryMs: 1500,
        chapterMs: 1500,
        audioMs: 1500,
      };
    });

    await page.goto("/");
    await expect(page.getByTestId("library-loading")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Loading library...")).toBeVisible();
    await waitForLibrary(page);

    const openPromise = openBook(page, "book-e2e-001");
    await expect(page.getByTestId("reader-loading")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Loading chapter...")).toBeVisible();
    await openPromise;

    const player = page.getByTestId("floating-audio-player");
    await expect(player).toBeVisible({ timeout: 20_000 });
    const loadingAttr = await player.getAttribute("data-loading-audio");
    if (loadingAttr === "true") {
      await expect(page.getByTestId("audio-loading-spinner")).toBeVisible();
      await expect(page.getByTestId("audio-play-pause")).toBeDisabled();
    }
    await expect(player).toHaveAttribute("data-loading-audio", "false", {
      timeout: 20_000,
    });
    await expect(page.getByTestId("audio-play-pause")).toBeEnabled();
  });

  test("4. close player persists audio; reopen restores it", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForLibrary(page);
    await openBook(page, "book-e2e-001");
    await waitForAudioRestored(page, 12);

    await page.getByTestId("floating-audio-element").evaluate((el) => {
      const audio = el as HTMLAudioElement;
      audio.currentTime = 18;
      audio.dispatchEvent(new Event("timeupdate"));
    });

    await page.getByTestId("audio-close").click();
    await expect(page.getByTestId("floating-audio-player")).toHaveCount(0);

    const saves = await page.evaluate(() => {
      const api = (
        window as unknown as {
          __AURORA_E2E__?: {
            getAudioStateSaves: () => Array<{
              bookId?: string;
              audioState?: { currentTimeSeconds?: number };
            }>;
          };
        }
      ).__AURORA_E2E__;
      return api?.getAudioStateSaves() ?? [];
    });
    expect(
      saves.some(
        (s) =>
          s.bookId === "book-e2e-001" &&
          typeof s.audioState?.currentTimeSeconds === "number" &&
          Math.abs((s.audioState.currentTimeSeconds ?? 0) - 18) < 1,
      ),
    ).toBe(true);

    await page.getByRole("tab", { name: "Library" }).click();
    await openBook(page, "book-e2e-001");
    await waitForAudioRestored(page, 18);
  });

  test("4b. tab switch persists chapter progress", async ({ page }) => {
    await page.goto("/");
    await waitForLibrary(page);
    await openBook(page, "book-e2e-001");
    await expect(page.getByText(/engines hummed/i)).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("tab", { name: "Library" }).click();
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();

    const progressSaves = await page.evaluate(() => {
      const api = (
        window as unknown as {
          __AURORA_E2E__?: { getProgressSaves: () => unknown[] };
        }
      ).__AURORA_E2E__;
      return api?.getProgressSaves() ?? [];
    });
    expect(progressSaves.length).toBeGreaterThan(0);

    await openBook(page, "book-e2e-001");
    await expect(page.locator("#p1")).toBeVisible();
  });

  test("5. switching books does not corrupt prior audioState", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as unknown as {
          __AURORA_E2E_BOOT__?: { seedTwoBooks?: boolean };
        }
      ).__AURORA_E2E_BOOT__ = { seedTwoBooks: true };
    });

    await page.goto("/");
    await waitForLibrary(page);
    await expect(page.getByText("The Mocked Voyage")).toBeVisible();
    await expect(page.getByText("Second Expedition")).toBeVisible();

    await openBook(page, "book-e2e-001");
    await waitForAudioRestored(page, 12);

    await page.getByRole("tab", { name: "Library" }).click();
    await openBook(page, "book-e2e-002");
    await waitForAudioRestored(page, 7);
    await expect(page.getByText(/second expedition cleared/i)).toBeVisible({
      timeout: 15_000,
    });

    const libraryAfterB = await page.evaluate(() => {
      const api = (
        window as unknown as {
          __AURORA_E2E__?: {
            getLibrary: () => Array<{
              id: string;
              audioState?: { currentTimeSeconds?: number };
            }>;
          };
        }
      ).__AURORA_E2E__;
      return api?.getLibrary() ?? [];
    });
    const bookA = libraryAfterB.find((b) => b.id === "book-e2e-001");
    expect(bookA?.audioState?.currentTimeSeconds).toBeCloseTo(12, 0);

    await page.getByRole("tab", { name: "Library" }).click();
    await openBook(page, "book-e2e-001");
    await waitForAudioRestored(page, 12);
  });

  test("7. conversion progress UI appears on the library card", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as unknown as {
          __AURORA_E2E_BOOT__?: Record<string, unknown>;
        }
      ).__AURORA_E2E_BOOT__ = {
        convertHangMs: 60_000,
        patchFirstBook: {
          conversionStatus: "notStarted",
          completedChapters: [],
          audioTracks: [],
          wordsProcessed: 0,
        },
      };
    });

    await page.goto("/");
    await waitForLibrary(page);

    await page.getByTestId("library-book-book-e2e-001").click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Convert to Audiobook" }).click();
    await page.getByRole("button", { name: "Start" }).click();

    await page.evaluate(() => {
      const api = (
        window as unknown as {
          __AURORA_E2E__?: { emit: (e: string, p: unknown) => void };
        }
      ).__AURORA_E2E__;
      api?.emit("conversion-progress", {
        currentChapter: 1,
        totalChapters: 2,
        wordsProcessed: 40,
        totalWords: 320,
        wordsInCurrentChapter: 40,
        currentStep: "tts",
        message: "Synthesizing chapter 1",
      });
    });

    await page.keyboard.press("Escape");
    const progress = page.getByTestId(
      "library-conversion-progress-book-e2e-001",
    );
    await expect(progress).toBeVisible({ timeout: 15_000 });
    await expect(progress.getByText(/Synthesizing chapter 1/i)).toBeVisible();
  });
});
