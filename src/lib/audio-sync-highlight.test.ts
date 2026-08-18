import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyHighlight,
  emptyHighlightState,
  unwrapSentenceWords,
  wrapSentenceWords,
} from "./audio-sync-highlight";
import {
  HIGHLIGHT_CLASS,
  HIGHLIGHT_WORD_CLASS,
} from "./audio-sync-utils";

describe("wrapSentenceWords / unwrapSentenceWords", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("wraps whitespace tokens and unwraps them again", () => {
    const sentence = document.createElement("span");
    sentence.id = "f000001";
    sentence.innerHTML = "Hello <em>world</em>";
    document.body.appendChild(sentence);

    expect(wrapSentenceWords(sentence)).toBe(2);
    expect(sentence.querySelector('[data-sync-word="0"]')?.textContent).toBe(
      "Hello"
    );
    expect(sentence.querySelector('[data-sync-word="1"]')?.textContent).toBe(
      "world"
    );

    unwrapSentenceWords(sentence);
    expect(sentence.querySelector("[data-sync-word]")).toBeNull();
    expect(sentence.textContent).toBe("Hello world");
  });

  it("wraps only the consecutive sentence tokens inside a longer paragraph", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Once upon a time Hello world extra words";
    document.body.appendChild(paragraph);

    expect(
      wrapSentenceWords(paragraph, [{ word: "Hello" }, { word: "world" }])
    ).toBe(2);
    expect(paragraph.querySelector('[data-sync-word="0"]')?.textContent).toBe(
      "Hello"
    );
    expect(paragraph.querySelector('[data-sync-word="1"]')?.textContent).toBe(
      "world"
    );
    expect(paragraph.querySelectorAll("[data-sync-word]")).toHaveLength(2);
  });

  it("does not wrap while a live text selection is inside the node", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "Hello world extra words";
    document.body.appendChild(paragraph);

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(wrapSentenceWords(paragraph)).toBe(0);
    expect(paragraph.querySelector("[data-sync-word]")).toBeNull();
    expect(paragraph.textContent).toBe("Hello world extra words");
    expect(selection?.toString()).toContain("Hello world");
  });
});

describe("applyHighlight", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("updates the word class inside the same sentence", () => {
    const sentence = document.createElement("span");
    sentence.id = "f000001";
    sentence.textContent = "one two";
    document.body.appendChild(sentence);
    const scrollToElement = vi.fn();

    const first = applyHighlight(
      {
        time: 0.1,
        sentenceId: "f000001",
        wordIndex: 0,
        words: [
          { word: "one", startSec: 0, endSec: 0.5 },
          { word: "two", startSec: 0.5, endSec: 1 },
        ],
      },
      sentence,
      emptyHighlightState(),
      { allowScroll: true, scrollToElement }
    );

    expect(sentence.classList.contains(HIGHLIGHT_CLASS)).toBe(true);
    expect(
      sentence
        .querySelector('[data-sync-word="0"]')
        ?.classList.contains(HIGHLIGHT_WORD_CLASS)
    ).toBe(true);
    expect(scrollToElement).toHaveBeenCalledTimes(1);

    applyHighlight(
      {
        time: 0.7,
        sentenceId: "f000001",
        wordIndex: 1,
        words: [
          { word: "one", startSec: 0, endSec: 0.5 },
          { word: "two", startSec: 0.5, endSec: 1 },
        ],
      },
      sentence,
      first,
      { allowScroll: false, scrollToElement }
    );

    expect(
      sentence
        .querySelector('[data-sync-word="0"]')
        ?.classList.contains(HIGHLIGHT_WORD_CLASS)
    ).toBe(false);
    expect(
      sentence
        .querySelector('[data-sync-word="1"]')
        ?.classList.contains(HIGHLIGHT_WORD_CLASS)
    ).toBe(true);
    expect(scrollToElement).toHaveBeenCalledTimes(1);
  });

  it("highlights a word even when wrap count does not match alignment count", () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "alpha beta gamma delta";
    document.body.appendChild(paragraph);
    const scrollToElement = vi.fn();

    applyHighlight(
      {
        time: 0.6,
        sentenceId: "f000001",
        wordIndex: 1,
        words: [
          { word: "nope", startSec: 0, endSec: 0.5 },
          { word: "nope", startSec: 0.5, endSec: 1 },
        ],
      },
      paragraph,
      emptyHighlightState(),
      { allowScroll: false, scrollToElement }
    );

    expect(
      paragraph
        .querySelector('[data-sync-word="1"]')
        ?.classList.contains(HIGHLIGHT_WORD_CLASS)
    ).toBe(true);
  });

  it("does not wrap or scroll while freezeForSelection is set", () => {
    const sentence = document.createElement("span");
    sentence.id = "f000001";
    sentence.textContent = "one two";
    document.body.appendChild(sentence);
    const scrollToElement = vi.fn();

    applyHighlight(
      {
        time: 0.1,
        sentenceId: "f000001",
        wordIndex: 0,
        words: [
          { word: "one", startSec: 0, endSec: 0.5 },
          { word: "two", startSec: 0.5, endSec: 1 },
        ],
      },
      sentence,
      emptyHighlightState(),
      { allowScroll: true, scrollToElement, freezeForSelection: true }
    );

    expect(sentence.querySelector("[data-sync-word]")).toBeNull();
    expect(scrollToElement).not.toHaveBeenCalled();
  });
});
