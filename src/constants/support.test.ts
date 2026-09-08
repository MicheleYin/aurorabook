import { describe, expect, it } from "vitest";

import { SHOW_LOGS, SUPPORT_EMAIL } from "./support";

describe("support constants", () => {
  it("exposes a support email string", () => {
    expect(typeof SUPPORT_EMAIL).toBe("string");
    expect(SUPPORT_EMAIL.trim().length).toBeGreaterThan(0);
  });

  it("exposes a boolean SHOW_LOGS flag", () => {
    expect(typeof SHOW_LOGS).toBe("boolean");
  });
});
