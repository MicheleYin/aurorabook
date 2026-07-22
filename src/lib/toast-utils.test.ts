import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));

import {
  dismissLoadingToast,
  showLoadingToast,
  updateLoadingToastToError,
  updateLoadingToastToSuccess,
} from "./toast-utils";

describe("toast-utils", () => {
  beforeEach(() => {
    // Clear any tracked toast from prior tests, then reset mocks.
    dismissLoadingToast();
    vi.clearAllMocks();
  });

  it("shows a loading toast and tracks its id", () => {
    const id = showLoadingToast("Working…");
    expect(id).toBe("loading");
    expect(toast.loading).toHaveBeenCalledWith("Working…", { id: "loading" });
  });

  it("dismisses a previous loading toast when the id changes", () => {
    showLoadingToast("First", "first");
    showLoadingToast("Second", "second");
    expect(toast.dismiss).toHaveBeenCalledWith("first");
    expect(toast.loading).toHaveBeenLastCalledWith("Second", { id: "second" });
  });

  it("updates a loading toast to success and clears tracking", () => {
    showLoadingToast("Working…", "job");
    updateLoadingToastToSuccess("Done", "job");
    expect(toast.success).toHaveBeenCalledWith("Done", { id: "job" });

    vi.clearAllMocks();
    dismissLoadingToast();
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it("updates a loading toast to error", () => {
    showLoadingToast("Working…", "job");
    updateLoadingToastToError("Failed", "job");
    expect(toast.error).toHaveBeenCalledWith("Failed", { id: "job" });
  });
});
