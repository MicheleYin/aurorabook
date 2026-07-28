import { describe, expect, it } from "vitest";

import type { AudioSyncSegment } from "../types/book";
import {
  clampScrollTopForElement,
  filterSegmentsForTrack,
  findSegmentAtTime,
  getProseContainer,
  isElementFullyVisible,
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

  it("finds inclusive clip bounds", () => {
    expect(findSegmentAtTime(segments, 0)?.textElementId).toBe("a");
    expect(findSegmentAtTime(segments, 1)?.textElementId).toBe("a");
    expect(findSegmentAtTime(segments, 1.5)?.textElementId).toBe("b");
  });

  it("returns undefined when outside clips", () => {
    expect(findSegmentAtTime(segments, 2.1)).toBeUndefined();
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
