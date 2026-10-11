import { describe, expect, it, vi } from "vitest";

import {
  dictionaryCardLayout,
  isDictionaryCardTarget,
  MAX_DICTIONARY_QUERY_CHARS,
  normalizeDictionaryQuery,
  snapshotReaderSelection,
} from "./reader-dictionary";

describe("normalizeDictionaryQuery", () => {
  it("accepts a single word and strips wrapping punctuation", () => {
    expect(normalizeDictionaryQuery("  “aurora.” ")).toBe("aurora");
  });

  it("rejects empty, overlong, or paragraph-sized selections", () => {
    expect(normalizeDictionaryQuery("   ")).toBeNull();
    expect(normalizeDictionaryQuery("one two three four five")).toBeNull();
    expect(
      normalizeDictionaryQuery("a".repeat(MAX_DICTIONARY_QUERY_CHARS + 1))
    ).toBeNull();
  });
});

describe("snapshotReaderSelection", () => {
  it("returns null when the selection is outside the reader root", () => {
    const root = document.createElement("div");
    const outside = document.createElement("p");
    outside.textContent = "outside";
    document.body.append(root, outside);

    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(snapshotReaderSelection(root)).toBeNull();
    outside.remove();
    root.remove();
  });

  it("accepts a selection inside the reader shadow root", () => {
    const host = document.createElement("div");
    const content = host.attachShadow({ mode: "open" });
    const paragraph = document.createElement("p");
    paragraph.textContent = "aurora";
    content.appendChild(paragraph);
    document.body.appendChild(host);

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({
        top: 10,
        left: 10,
        width: 40,
        height: 18,
        bottom: 28,
        right: 50,
      }),
    });
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => "aurora",
    } as Selection;
    const getSelection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue(selection);

    expect(host.shadowRoot?.contains(range.commonAncestorContainer)).toBe(true);
    expect(snapshotReaderSelection(host)?.query).toBe("aurora");

    getSelection.mockRestore();
    host.remove();
  });
});

describe("dictionaryCardLayout", () => {
  it("places the card below the selection when there is room", () => {
    const layout = dictionaryCardLayout(
      { top: 80, left: 100, width: 40, height: 18, bottom: 98, right: 140 },
      { width: 800, height: 600 }
    );
    expect(layout.top).toBe(108);
    expect(layout.bottom).toBeUndefined();
    expect(layout.width).toBeLessThanOrEqual(360);
  });

  it("places the card above the selection near the bottom of the viewport", () => {
    const layout = dictionaryCardLayout(
      { top: 520, left: 100, width: 40, height: 18, bottom: 538, right: 140 },
      { width: 800, height: 560 }
    );
    expect(layout.top).toBeUndefined();
    expect(layout.bottom).toBe(50);
  });
});

describe("isDictionaryCardTarget", () => {
  it("detects events that originate on the dictionary card", () => {
    const card = document.createElement("div");
    card.setAttribute("data-reader-dictionary-card", "");
    const child = document.createElement("p");
    card.appendChild(child);

    expect(isDictionaryCardTarget(child)).toBe(true);
    expect(isDictionaryCardTarget(document.createElement("div"))).toBe(false);
    expect(isDictionaryCardTarget(null)).toBe(false);
  });
});
