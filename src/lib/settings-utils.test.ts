import { describe, expect, it } from "vitest";

import { normalizeTtsSynthesisQuality } from "./settings-utils";

describe("normalizeTtsSynthesisQuality", () => {
  it("keeps known presets", () => {
    expect(normalizeTtsSynthesisQuality("fastest")).toBe("fastest");
    expect(normalizeTtsSynthesisQuality("balanced")).toBe("balanced");
    expect(normalizeTtsSynthesisQuality("quality")).toBe("quality");
  });

  it("defaults unknown values to balanced", () => {
    expect(normalizeTtsSynthesisQuality(undefined)).toBe("balanced");
    expect(normalizeTtsSynthesisQuality("max")).toBe("balanced");
    expect(normalizeTtsSynthesisQuality(12)).toBe("balanced");
  });
});
