import { describe, expect, it } from "vitest";

import {
  anim,
  ANIMATION_DURATION,
  animPatterns,
  dialogSectionStagger,
  enterExit,
  fade,
  hoverLift,
  hoverScale,
  scale,
  slide,
  staggerDelay,
  viewTransition,
} from "./animations";

describe("animations", () => {
  it("builds transition classes for different properties and durations", () => {
    expect(anim()).toBe("transition-all duration-200");
    expect(anim("fast", "colors", "ease-out")).toBe(
      "transition-colors duration-150 ease-out"
    );
    expect(anim("slower", "height")).toBe(
      "transition-[height,max-height] duration-500"
    );
  });

  it("creates fade, slide, and scale animation classes", () => {
    expect(fade("in", "medium")).toBe(
      `animate-in fade-in-0 duration-${ANIMATION_DURATION.medium}`
    );
    expect(fade("out", "slow")).toBe(
      `animate-out fade-out-0 duration-${ANIMATION_DURATION.slow}`
    );
    expect(slide("left", 8)).toBe("animate-in slide-in-from-right-8");
    expect(slide("right", 16)).toBe("animate-in slide-in-from-left-16");
    expect(scale("in", 90)).toBe("animate-in zoom-in-90");
    expect(scale("out", 105)).toBe("animate-out zoom-out-105");
  });

  it("creates hover helpers", () => {
    expect(hoverLift()).toBe("hover:-translate-y-0.5 hover:shadow-md");
    expect(hoverLift(2, "lg")).toBe("hover:-translate-y-2 hover:shadow-lg");
    expect(hoverScale(1.02)).toBe("hover:scale-[1.02]");
    expect(hoverScale(1.05)).toBe("hover:scale-[1.05]");
    expect(hoverScale(1.1)).toBe("hover:scale-[1.1]");
  });

  it("creates enter and exit variants for each animation type", () => {
    expect(enterExit(true, "fade")).toBe(fade("in"));
    expect(enterExit(true, "slideUp")).toBe(slide("up"));
    expect(enterExit(true, "slideDown")).toBe(slide("down"));
    expect(enterExit(true, "scale")).toBe(scale("in"));
    expect(enterExit(true, "slideUpFade")).toBe(
      "animate-in slide-in-from-bottom-2 animate-in fade-in-0 duration-200"
    );
    expect(enterExit(true, "scaleFade")).toBe(
      "animate-in zoom-in-95 animate-in fade-in-0 duration-200"
    );

    expect(enterExit(false, "fade")).toBe(fade("out"));
    expect(enterExit(false, "slideUp")).toBe("animate-out slide-out-to-top");
    expect(enterExit(false, "slideDown")).toBe(
      "animate-out slide-out-to-bottom"
    );
    expect(enterExit(false, "scale")).toBe(scale("out"));
    expect(enterExit(false, "slideUpFade")).toBe(
      "animate-out slide-out-to-top animate-out fade-out-0 duration-200"
    );
    expect(enterExit(false, "scaleFade")).toBe(
      "animate-out zoom-out-95 animate-out fade-out-0 duration-200"
    );
  });

  it("chooses the correct view transition direction", () => {
    expect(viewTransition(null, "library")).toBe(fade("in", "medium"));
    expect(viewTransition("library", "reader")).toBe(
      animPatterns.viewSlideLeft
    );
    expect(viewTransition("settings", "reader")).toBe(
      animPatterns.viewSlideRight
    );
    expect(viewTransition("reader", "reader")).toBe(
      animPatterns.viewSlideRight
    );
  });

  it("creates stagger helpers", () => {
    expect(staggerDelay(3)).toBe("[animation-delay:150ms]");
    expect(staggerDelay(2, 75)).toBe("[animation-delay:150ms]");
    expect(dialogSectionStagger(2)).toBe(
      `${animPatterns.dialogSection} [animation-delay:80ms]`
    );
  });
});
