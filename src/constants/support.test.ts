import { describe, expect, it } from "vitest";

import { SHOW_LOGS, SUPPORT_EMAIL } from "./support";

describe("support constants", () => {
  it("exposes a default support email", () => {
    expect(SUPPORT_EMAIL).toMatch(/@/);
  });

  it("exposes a boolean SHOW_LOGS flag", () => {
    expect(typeof SHOW_LOGS).toBe("boolean");
  });
});
