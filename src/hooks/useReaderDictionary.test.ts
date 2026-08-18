import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { invoke } from "../test/tauri-mocks";
import { useReaderDictionary } from "./useReaderDictionary";

function selectText(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  Object.defineProperty(range, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 40,
      y: 80,
      top: 80,
      left: 40,
      width: 48,
      height: 18,
      bottom: 98,
      right: 88,
      toJSON: () => ({}),
    }),
  });
}

describe("useReaderDictionary", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({
      term: "aurora",
      definition: "the dawn",
    });
    window.getSelection()?.removeAllRanges();
  });

  it("looks up the selected word and exposes a card state", async () => {
    const root = document.createElement("div");
    const word = document.createElement("span");
    word.textContent = "aurora";
    root.appendChild(word);
    document.body.appendChild(root);
    const contentRef = { current: root };

    const { result } = renderHook(() => useReaderDictionary(contentRef));

    selectText(word);
    await act(async () => {
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });

    await waitFor(() => {
      expect(result.current.dictionary?.loading).toBe(false);
    });

    expect(invoke).toHaveBeenCalledWith("lookup_dictionary", { term: "aurora" });
    expect(result.current.dictionary?.term).toBe("aurora");
    expect(result.current.dictionary?.definition).toBe("the dawn");
    expect(result.current.consumeChromeToggleSuppression()).toBe(false);

    root.remove();
  });

  it("suppresses the next chrome toggle after a lookup is dismissed", async () => {
    const root = document.createElement("div");
    const word = document.createElement("span");
    word.textContent = "aurora";
    root.appendChild(word);
    document.body.appendChild(root);
    const contentRef = { current: root };

    const { result } = renderHook(() => useReaderDictionary(contentRef));

    selectText(word);
    await act(async () => {
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });

    window.getSelection()?.removeAllRanges();
    await act(async () => {
      document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await waitFor(() => {
      expect(result.current.isOpen).toBe(false);
    });

    expect(result.current.consumeChromeToggleSuppression()).toBe(true);
    expect(result.current.consumeChromeToggleSuppression()).toBe(false);

    root.remove();
  });
});
