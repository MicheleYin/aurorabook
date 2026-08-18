import { describe, expect, it } from "vitest";

import type { AudioSyncSegment } from "../types/book";
import {
  clampScrollTopForElement,
  clampWordCues,
  estimateWordTimings,
  filterSegmentsForTrack,
  findSegmentAtTime,
  findWordAtTime,
  getProseContainer,
  isElementFullyVisible,
  isFollowScrollPaused,
  hasNonCollapsedTextSelection,
  placeWordCuesOnTrack,
  resolvePlaybackMarker,
  scrollTopToRevealRect,
  shouldRunSyncPass,
} from "./audio-sync-utils";

function seg(
  partial: Partial<AudioSyncSegment> & Pick<AudioSyncSegment, "clipBegin" | "clipEnd">
): AudioSyncSegment {
  return {
    textElementId: "w1",
    chapterHref: "ch1.xhtml",
    audioTrackHref: "audio/01.mp3",
    ...partial,
  };
}

describe("filterSegmentsForTrack", () => {
  it("keeps only matching track hrefs", () => {
    const segments = [
      seg({ audioTrackHref: "a.mp3", clipBegin: 0, clipEnd: 1 }),
      seg({ audioTrackHref: "b.mp3", clipBegin: 0, clipEnd: 1 }),
    ];
    expect(filterSegmentsForTrack(segments, "a.mp3")).toHaveLength(1);
  });
});

describe("findSegmentAtTime", () => {
  const segments = [
    seg({ clipBegin: 0, clipEnd: 1, textElementId: "a" }),
    seg({ clipBegin: 1, clipEnd: 2, textElementId: "b" }),
  ];

  it("uses half-open clip windows and includes the last clipEnd", () => {
    expect(findSegmentAtTime(segments, 0)?.textElementId).toBe("a");
    expect(findSegmentAtTime(segments, 0.999)?.textElementId).toBe("a");
    expect(findSegmentAtTime(segments, 1)?.textElementId).toBe("b");
    expect(findSegmentAtTime(segments, 1.5)?.textElementId).toBe("b");
    expect(findSegmentAtTime(segments, 2)?.textElementId).toBe("b");
  });

  it("returns undefined when outside clips", () => {
    expect(findSegmentAtTime(segments, 2.1)).toBeUndefined();
  });

  it("handles large backward and forward jumps via binary search", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      seg({
        clipBegin: i,
        clipEnd: i + 1,
        textElementId: `s${i}`,
      })
    );
    expect(findSegmentAtTime(many, 0)?.textElementId).toBe("s0");
    expect(findSegmentAtTime(many, 49.2)?.textElementId).toBe("s49");
    expect(findSegmentAtTime(many, 12)?.textElementId).toBe("s12");
  });
});

describe("shouldRunSyncPass", () => {
  it("skips tiny time deltas", () => {
    expect(shouldRunSyncPass(1.05, 1.0)).toBe(false);
    expect(shouldRunSyncPass(1.1, 1.0)).toBe(true);
  });
});

describe("isElementFullyVisible", () => {
  it("accounts for top and bottom chrome offsets", () => {
    const container = { top: 0, bottom: 500, left: 0, right: 300 };
    const visible = { top: 80, bottom: 120, left: 10, right: 100 };
    expect(
      isElementFullyVisible(visible, container, {
        topOffset: 60,
        bottomOffset: 80,
      })
    ).toBe(true);

    const clippedByHeader = { top: 40, bottom: 80, left: 10, right: 100 };
    expect(
      isElementFullyVisible(clippedByHeader, container, {
        topOffset: 60,
        bottomOffset: 80,
      })
    ).toBe(false);
  });
});

describe("clampScrollTopForElement", () => {
  it("clamps target scroll within content bounds", () => {
    expect(
      clampScrollTopForElement(200, 0, 400, 1000, {
        topOffset: 50,
        bottomOffset: 0,
      })
    ).toBe(142);

    expect(
      clampScrollTopForElement(0, 0, 400, 1000, {
        topOffset: 50,
        bottomOffset: 0,
      })
    ).toBe(0);

    expect(
      clampScrollTopForElement(900, 0, 400, 1000, {
        topOffset: 0,
        bottomOffset: 100,
      })
    ).toBe(700);
  });
});

describe("scrollTopToRevealRect", () => {
  it("moves scrollTop by the viewport gap to the element", () => {
    expect(
      scrollTopToRevealRect(100, 520, 0, 400, 2000, {
        topOffset: 40,
        bottomOffset: 0,
      })
    ).toBe(572);
  });
});

describe("isFollowScrollPaused", () => {
  it("pauses until the resume window elapses", () => {
    expect(isFollowScrollPaused(1000, 2000, 1800)).toBe(true);
    expect(isFollowScrollPaused(1000, 2800, 1800)).toBe(false);
    expect(isFollowScrollPaused(null, 2800, 1800)).toBe(false);
  });
});

describe("hasNonCollapsedTextSelection", () => {
  it("is false when the caret is collapsed", () => {
    expect(hasNonCollapsedTextSelection()).toBe(false);
  });
});

describe("getProseContainer", () => {
  it("returns .prose when no shadow host", () => {
    const root = document.createElement("div");
    const prose = document.createElement("div");
    prose.className = "prose";
    root.appendChild(prose);
    expect(getProseContainer(root)).toBe(prose);
  });

  it("pierces shadow DOM when present", () => {
    const root = document.createElement("div");
    const host = document.createElement("div");
    host.setAttribute("data-reader-chapter-shadow-host", "");
    const shadow = host.attachShadow({ mode: "open" });
    const content = document.createElement("div");
    content.setAttribute("data-reader-chapter-content", "");
    shadow.appendChild(content);
    root.appendChild(host);
    expect(getProseContainer(root)).toBe(content);
  });
});

describe("findWordAtTime", () => {
  const words = [
    { word: "one", startSec: 0, endSec: 0.4 },
    { word: "two", startSec: 0.4, endSec: 1.2 },
    { word: "three", startSec: 1.2, endSec: 2 },
  ];

  it("returns the word covering the current time", () => {
    expect(findWordAtTime(words, 0)).toBe(0);
    expect(findWordAtTime(words, 0.4)).toBe(1);
    expect(findWordAtTime(words, 1.9)).toBe(2);
    expect(findWordAtTime(words, 2)).toBe(2);
  });

  it("clamps before the first word and after the last word", () => {
    expect(findWordAtTime(words, -0.2)).toBe(0);
    expect(findWordAtTime(words, 2.5)).toBe(2);
  });
});

describe("estimateWordTimings", () => {
  it("gives longer words more of the clip", () => {
    const cues = estimateWordTimings("a extraordinary", 0, 2);
    expect(cues).toHaveLength(2);
    const short = cues[0].endSec - cues[0].startSec;
    const long = cues[1].endSec - cues[1].startSec;
    expect(long).toBeGreaterThan(short * 2);
  });

  it("never places a word outside the sentence clip", () => {
    const cues = estimateWordTimings(
      "Hi, there, yes, no, ok, wait, sure, fine, go, now.",
      1,
      1.2
    );
    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      expect(cue.startSec).toBeGreaterThanOrEqual(1);
      expect(cue.endSec).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(cue.endSec).toBeGreaterThanOrEqual(cue.startSec);
    }
    expect(cues[cues.length - 1].endSec).toBeCloseTo(1.2, 6);
  });

  it("keeps late-chapter estimates inside the sentence clip on the track", () => {
    const cues = estimateWordTimings("Hello world extra", 480.25, 482.1);
    expect(cues).toHaveLength(3);
    for (const cue of cues) {
      expect(cue.startSec).toBeGreaterThanOrEqual(480.25);
      expect(cue.endSec).toBeLessThanOrEqual(482.1 + 1e-9);
    }
    expect(cues[0].startSec).toBeCloseTo(480.25, 6);
    expect(cues[cues.length - 1].endSec).toBeCloseTo(482.1, 6);
  });
});

describe("clampWordCues", () => {
  it("pulls overshooting words back inside the clip", () => {
    const clamped = clampWordCues(
      [
        { word: "one", startSec: -0.2, endSec: 0.4 },
        { word: "two", startSec: 0.4, endSec: 1.8 },
      ],
      0,
      1
    );
    expect(clamped[0].startSec).toBeGreaterThanOrEqual(0);
    expect(clamped[1].endSec).toBeCloseTo(1, 6);
    for (const cue of clamped) {
      expect(cue.startSec).toBeGreaterThanOrEqual(0);
      expect(cue.endSec).toBeLessThanOrEqual(1);
    }
  });
});

describe("placeWordCuesOnTrack", () => {
  it("offsets sentence-relative words by track position and fits them to PCM duration", () => {
    const placed = placeWordCuesOnTrack(
      [
        { word: "one", startSec: 0, endSec: 0.4 },
        { word: "two", startSec: 0.4, endSec: 0.7 },
      ],
      12.5,
      1.2
    );
    expect(placed[0].startSec).toBeGreaterThanOrEqual(12.5);
    expect(placed[placed.length - 1].endSec).toBeCloseTo(13.7, 6);
    const firstSpan = placed[0].endSec - placed[0].startSec;
    const secondSpan = placed[1].endSec - placed[1].startSec;
    expect(firstSpan / 0.4).toBeCloseTo(secondSpan / 0.3, 1);
    for (const cue of placed) {
      expect(cue.startSec).toBeGreaterThanOrEqual(12.5);
      expect(cue.endSec).toBeLessThanOrEqual(13.7 + 1e-9);
    }
  });
});

describe("resolvePlaybackMarker", () => {
  const segments = [
    seg({
      clipBegin: 0,
      clipEnd: 2,
      textElementId: "f000001",
      words: [
        { word: "Hello", startSec: 0, endSec: 0.8 },
        { word: "world", startSec: 0.8, endSec: 2 },
      ],
    }),
    seg({
      clipBegin: 2,
      clipEnd: 4,
      textElementId: "f000002",
      words: [{ word: "Next", startSec: 2, endSec: 4 }],
    }),
  ];

  it("resolves the same marker for play-through and a scrub jump", () => {
    const played = resolvePlaybackMarker({ time: 2.5, segments });
    const scrubbed = resolvePlaybackMarker({ time: 2.5, segments });
    expect(played).toEqual(scrubbed);
    expect(played?.sentenceId).toBe("f000002");
    expect(played?.wordIndex).toBe(0);
  });

  it("prefers a live marker when the track is live", () => {
    const marker = resolvePlaybackMarker({
      time: 1.1,
      segments,
      isLiveTrack: true,
      liveMarker: {
        textElementId: "f000009",
        chapterHref: "ch1.xhtml",
        clipBegin: 1,
        clipEnd: 3,
        currentWordIndex: 2,
        sentenceText: "Live sentence here",
      },
    });
    expect(marker?.sentenceId).toBe("f000009");
    expect(typeof marker?.wordIndex).toBe("number");
  });

  it("computes the live word from clock time, not a stale IPC index", () => {
    const marker = resolvePlaybackMarker({
      time: 1.6,
      segments,
      isLiveTrack: true,
      liveMarker: {
        textElementId: "f000009",
        chapterHref: "ch1.xhtml",
        clipBegin: 1,
        clipEnd: 3,
        currentWordIndex: 0,
        sentenceText: "Hello world extra",
        wordAlignments: [
          { word: "Hello", startSec: 0, endSec: 0.4 },
          { word: "world", startSec: 0.4, endSec: 1.0 },
          { word: "extra", startSec: 1.0, endSec: 2.0 },
        ],
      },
    });
    expect(marker?.sentenceId).toBe("f000009");
    expect(marker?.wordIndex).toBe(1);
    expect(marker?.words?.[0].startSec).toBeCloseTo(1, 6);
    expect(marker?.words?.[marker.words.length - 1].endSec).toBeCloseTo(3, 6);
  });

  it("fits persisted sentence words onto the SMIL clip instead of leaving a short last word", () => {
    const marker = resolvePlaybackMarker({
      time: 1.8,
      segments: [
        seg({
          clipBegin: 0,
          clipEnd: 2,
          textElementId: "f000001",
          words: [
            { word: "Hello", startSec: 0, endSec: 0.5 },
            { word: "world", startSec: 0.5, endSec: 1.2 },
          ],
        }),
      ],
    });
    expect(marker?.sentenceId).toBe("f000001");
    expect(marker?.wordIndex).toBe(1);
    expect(marker?.words?.[marker.words.length - 1].endSec).toBeCloseTo(2, 6);
    const firstSpan = (marker?.words?.[0].endSec ?? 0) - (marker?.words?.[0].startSec ?? 0);
    const secondSpan = (marker?.words?.[1].endSec ?? 0) - (marker?.words?.[1].startSec ?? 0);
    expect(firstSpan / 0.5).toBeCloseTo(secondSpan / 0.7, 1);
  });

  it("returns null when there is no matching map or live marker", () => {
    expect(resolvePlaybackMarker({ time: 99, segments: [] })).toBeNull();
  });
});
