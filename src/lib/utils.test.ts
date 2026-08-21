import { describe, expect, it } from "vitest";

import { cn, formatTime } from "./utils";

describe("cn", () => {
  it("merges class names and resolves Tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", undefined, "font-medium")).toBe(
      "text-sm font-medium"
    );
  });
});

describe("formatTime", () => {
  it("formats seconds under one hour as m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(599)).toBe("9:59");
  });

  it("formats seconds over one hour as h:mm:ss", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
  });
});
