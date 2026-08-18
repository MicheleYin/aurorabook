import type { PlaybackMarker } from "./audio-sync-utils";
import {
  AUDIO_WORD_CLASS,
  HIGHLIGHT_ACTIVE_CLASS,
  HIGHLIGHT_CLASS,
  HIGHLIGHT_ENTER_CLASS,
  HIGHLIGHT_EXIT_CLASS,
  HIGHLIGHT_WORD_CLASS,
} from "./audio-sync-utils";

const WRAPPED_ATTR = "data-sync-words-wrapped";

export interface HighlightApplyOptions {
  allowScroll: boolean;
  scrollToElement: (element: HTMLElement) => void;
}

export interface HighlightState {
  sentenceId: string | null;
  wordIndex: number | null;
  sentenceEl: HTMLElement | null;
}

export function emptyHighlightState(): HighlightState {
  return { sentenceId: null, wordIndex: null, sentenceEl: null };
}

export function wrapSentenceWords(
  sentenceEl: HTMLElement,
  expectedWords?: Array<{ word: string }>
): number {
  const expected =
    expectedWords && expectedWords.length > 0 ? expectedWords : undefined;

  if (sentenceEl.getAttribute(WRAPPED_ATTR) === "1") {
    const count = sentenceEl.querySelectorAll(`[data-sync-word]`).length;
    if (!expected || count === expected.length) {
      return count;
    }
    unwrapSentenceWords(sentenceEl);
  }

  const walker = document.createTreeWalker(sentenceEl, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest("[data-sync-word]")) continue;
    textNodes.push(node);
  }

  const tokens = collectWordTokens(textNodes);
  const matchStart = expected ? findConsecutiveTokenRun(tokens, expected) : -1;
  const state: WrapWalkState = {
    globalToken: 0,
    matchStart,
    matchCount: expected?.length ?? 0,
    wrapped: 0,
  };

  for (const node of textNodes) {
    wrapTextNodeWords(node, state);
  }

  sentenceEl.setAttribute(WRAPPED_ATTR, "1");
  return state.wrapped;
}

interface WrapWalkState {
  globalToken: number;
  matchStart: number;
  matchCount: number;
  wrapped: number;
}

function collectWordTokens(textNodes: Text[]): string[] {
  const tokens: string[] = [];
  for (const node of textNodes) {
    const parts = (node.textContent ?? "").split(/(\s+)/);
    for (const part of parts) {
      if (!part || /^\s+$/.test(part)) continue;
      tokens.push(part);
    }
  }
  return tokens;
}

function normalizeSyncToken(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function tokensMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeSyncToken(left);
  const normalizedRight = normalizeSyncToken(right);
  if (normalizedLeft && normalizedRight) {
    return normalizedLeft === normalizedRight;
  }
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function findConsecutiveTokenRun(
  tokens: string[],
  expected: Array<{ word: string }>
): number {
  if (expected.length === 0 || tokens.length < expected.length) {
    return -1;
  }
  for (let start = 0; start <= tokens.length - expected.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (!tokensMatch(tokens[start + offset], expected[offset].word)) {
        matched = false;
        break;
      }
    }
    if (matched) return start;
  }
  return -1;
}

function wrapTextNodeWords(node: Text, state: WrapWalkState): void {
  const text = node.textContent ?? "";
  const parts = text.split(/(\s+)/);
  if (parts.length === 1 && !parts[0].trim()) return;

  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      fragment.appendChild(document.createTextNode(part));
      continue;
    }

    const shouldWrap =
      state.matchStart < 0 ||
      (state.globalToken >= state.matchStart &&
        state.globalToken < state.matchStart + state.matchCount);
    if (shouldWrap) {
      const span = document.createElement("span");
      span.className = AUDIO_WORD_CLASS;
      const wordIndex =
        state.matchStart < 0
          ? state.wrapped
          : state.globalToken - state.matchStart;
      span.dataset.syncWord = String(wordIndex);
      span.textContent = part;
      fragment.appendChild(span);
      state.wrapped += 1;
    } else {
      fragment.appendChild(document.createTextNode(part));
    }
    state.globalToken += 1;
  }
  node.parentNode?.replaceChild(fragment, node);
}

export function unwrapSentenceWords(sentenceEl: HTMLElement): void {
  const words = Array.from(
    sentenceEl.querySelectorAll<HTMLElement>("[data-sync-word]")
  );
  for (const wordEl of words) {
    const parent = wordEl.parentNode;
    if (!parent) continue;
    while (wordEl.firstChild) {
      parent.insertBefore(wordEl.firstChild, wordEl);
    }
    wordEl.remove();
    if (parent instanceof HTMLElement) {
      parent.normalize();
    }
  }
  sentenceEl.removeAttribute(WRAPPED_ATTR);
}

export function clearSentenceHighlight(element: HTMLElement): void {
  element.classList.remove(
    HIGHLIGHT_CLASS,
    HIGHLIGHT_ENTER_CLASS,
    HIGHLIGHT_ACTIVE_CLASS,
    HIGHLIGHT_EXIT_CLASS
  );
}

export function clearWordHighlights(sentenceEl: HTMLElement): void {
  sentenceEl
    .querySelectorAll(`.${HIGHLIGHT_WORD_CLASS}`)
    .forEach((el) => el.classList.remove(HIGHLIGHT_WORD_CLASS));
}

export function removeAllAudioHighlights(root: ParentNode = document): void {
  root.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => {
    el.classList.remove(
      HIGHLIGHT_CLASS,
      HIGHLIGHT_ENTER_CLASS,
      HIGHLIGHT_ACTIVE_CLASS,
      HIGHLIGHT_EXIT_CLASS
    );
  });
  root.querySelectorAll(`.${HIGHLIGHT_WORD_CLASS}`).forEach((el) => {
    el.classList.remove(HIGHLIGHT_WORD_CLASS);
  });
}

/**
 * Paint sentence + word highlight to match `marker`. Idempotent for the same
 * sentence/word pair. Autoscroll is gated by `allowScroll`.
 */
export function applyHighlight(
  marker: PlaybackMarker,
  sentenceEl: HTMLElement,
  state: HighlightState,
  options: HighlightApplyOptions
): HighlightState {
  const sentenceChanged = state.sentenceId !== marker.sentenceId;
  const nextState: HighlightState = {
    sentenceId: marker.sentenceId,
    wordIndex:
      typeof marker.wordIndex === "number" ? marker.wordIndex : null,
    sentenceEl,
  };

  if (sentenceChanged) {
    if (state.sentenceEl && state.sentenceEl !== sentenceEl) {
      clearWordHighlights(state.sentenceEl);
      unwrapSentenceWords(state.sentenceEl);
      state.sentenceEl.classList.remove(HIGHLIGHT_ACTIVE_CLASS);
      state.sentenceEl.classList.add(HIGHLIGHT_EXIT_CLASS);
      const previous = state.sentenceEl;
      window.setTimeout(() => {
        clearSentenceHighlight(previous);
      }, 500);
    }

    sentenceEl.classList.add(HIGHLIGHT_CLASS, HIGHLIGHT_ENTER_CLASS);
    window.setTimeout(() => {
      sentenceEl.classList.remove(HIGHLIGHT_ENTER_CLASS);
      sentenceEl.classList.add(HIGHLIGHT_ACTIVE_CLASS);
    }, 100);
  } else if (!sentenceEl.classList.contains(HIGHLIGHT_CLASS)) {
    sentenceEl.classList.add(HIGHLIGHT_CLASS, HIGHLIGHT_ACTIVE_CLASS);
  }

  const expectedWords = marker.words;
  const wrappedCount = wrapSentenceWords(sentenceEl, expectedWords);
  if (typeof marker.wordIndex === "number" && wrappedCount > 0) {
    const wordIndex = Math.min(
      Math.max(0, marker.wordIndex),
      wrappedCount - 1
    );
    const current = sentenceEl.querySelector(
      `.${HIGHLIGHT_WORD_CLASS}`
    ) as HTMLElement | null;
    const next = sentenceEl.querySelector(
      `[data-sync-word="${wordIndex}"]`
    ) as HTMLElement | null;
    if (current !== next) {
      current?.classList.remove(HIGHLIGHT_WORD_CLASS);
      next?.classList.add(HIGHLIGHT_WORD_CLASS);
    }
  } else {
    clearWordHighlights(sentenceEl);
  }

  if (options.allowScroll) {
    options.scrollToElement(sentenceEl);
  }

  return nextState;
}
