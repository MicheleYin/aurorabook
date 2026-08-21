/**
 * Native Tauri smoke — runs only when the WDIO Tauri service can launch the
 * app binary (see ../README.md).
 */
describe("AuroraBook (native Tauri)", () => {
  it("shows the Library chrome", async () => {
    const heading = await $("h1");
    await heading.waitForDisplayed({ timeout: 60_000 });
    await expect(heading).toHaveText("Library");

    const addBook = await $("button*=Add Book");
    await expect(addBook).toBeDisplayed();
  });
});
