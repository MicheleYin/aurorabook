import { expect, type Page } from "@playwright/test";

export type AuroraE2E = {
  reset: () => void;
  seedTwoBooks: () => void;
  setDelays: (options: {
    libraryMs?: number;
    chapterMs?: number;
    audioMs?: number;
    convertHangMs?: number;
  }) => void;
  emit: (event: string, payload: unknown) => void;
  getLibrary: () => unknown[];
  getAudioStateSaves: () => Array<{
    bookId?: string;
    audioState?: { currentTimeSeconds?: number; currentTrackId?: string };
  }>;
  getProgressSaves: () => unknown[];
  patchBook: (bookId: string, patch: Record<string, unknown>) => unknown;
};

export async function getE2E(page: Page): Promise<AuroraE2E> {
  return page.evaluate(() => {
    const api = (
      window as unknown as { __AURORA_E2E__?: AuroraE2E }
    ).__AURORA_E2E__;
    if (!api) {
      throw new Error("__AURORA_E2E__ not available — is VITE_E2E_MOCK=1 set?");
    }
    return api;
  });
}

export async function waitForLibrary(page: Page) {
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible({
    timeout: 30_000,
  });
}

export async function openBook(page: Page, bookId: string) {
  const bookCard = page.getByTestId(`library-book-${bookId}`);
  await expect(bookCard).toBeVisible({ timeout: 15_000 });
  // Floating player can cover the Open button after a prior book was opened.
  await page.getByTestId("audio-close").click({ timeout: 2_000 }).catch(() => undefined);
  await bookCard.getByRole("button", { name: "Open" }).click({ force: true });
  await expect(page.getByRole("tab", { name: "Reader" })).toHaveAttribute(
    "data-state",
    "active",
    { timeout: 15_000 },
  );
}

export async function waitForAudioRestored(
  page: Page,
  expectedSeconds: number,
) {
  const player = page.getByTestId("floating-audio-player");
  await expect(player).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      async () =>
        page.getByTestId("floating-audio-element").evaluate((el) => {
          const audio = el as HTMLAudioElement;
          return {
            currentTime: audio.currentTime,
            readyState: audio.readyState,
            duration: audio.duration,
          };
        }),
      { timeout: 20_000 },
    )
    .toMatchObject({
      currentTime: expect.closeTo(expectedSeconds, 0.75),
    });
}
