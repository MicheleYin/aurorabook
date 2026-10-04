import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { invoke } from "../../test/tauri-mocks";
import type { StorageReport } from "../../types/storage";
import { StorageSection } from "./StorageSection";

const report: StorageReport = {
  totalBytes: 4096,
  databaseBytes: 1024,
  books: [{ bookId: "book-1", title: "A Sample Book", bytes: 2048 }],
  issues: [
    {
      kind: "orphanedBookDirectory",
      bookId: null,
      title: null,
      relativePath: "Library/removed-book",
      bytes: 512,
      removable: true,
    },
  ],
};

describe("StorageSection", () => {
  beforeEach(() => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "get_storage_report") return report;
      if (command === "cleanup_orphaned_storage") {
        return { removedDirectories: 1, removedBytes: 512 };
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });
  });

  it("shows app usage and requires confirmation before orphan cleanup", async () => {
    render(<StorageSection />);

    expect(await screen.findByTestId("storage-total-size")).toHaveTextContent(
      "4 KB"
    );
    expect(screen.getByText("A Sample Book")).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("storage-cleanup-button"));
    expect(invoke).not.toHaveBeenCalledWith("cleanup_orphaned_storage");

    fireEvent.click(await screen.findByTestId("storage-confirm-cleanup-button"));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cleanup_orphaned_storage");
    });
    expect(invoke).toHaveBeenCalledWith("get_storage_report");
  });
});