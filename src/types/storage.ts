export interface BookStorageUsage {
  bookId: string;
  title: string;
  bytes: number;
}

export interface StorageIssue {
  kind: string;
  bookId: string | null;
  title: string | null;
  relativePath: string;
  bytes: number;
  removable: boolean;
}

export interface StorageReport {
  totalBytes: number;
  databaseBytes: number;
  books: BookStorageUsage[];
  issues: StorageIssue[];
}

export interface StorageCleanupResult {
  removedDirectories: number;
  removedBytes: number;
}

export interface BookDeletionResult {
  bytesRemoved: number;
  cleanupWarnings: string[];
}
