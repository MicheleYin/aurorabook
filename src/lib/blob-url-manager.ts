/**
 * Centralized Blob URL Manager
 * Prevents memory leaks by tracking and revoking blob URLs
 */

class BlobURLManager {
  private urls = new Map<string, Set<string>>(); // bookId -> Set of blob URLs
  private urlToBookId = new Map<string, string>(); // blob URL -> bookId (for reverse lookup)
  private currentAudioTrack = new Map<string, string>(); // bookId -> current audio track blob URL
  private urlToType = new Map<string, "audio" | "image" | "other">(); // Track blob URL type
  private activeAudioUrls = new Set<string>(); // Blob URLs currently in use by audio elements
  private pendingRevocations = new Map<string, number>(); // URL -> timeout ID for delayed revocation

  /**
   * Register a blob URL for a specific book
   * @param bookId - The book ID
   * @param url - The blob URL
   * @param type - Type of blob (audio, image, other)
   * @param revokePrevious - If true and type is "audio", revokes previous audio track for this book
   * 
   * IDEMPOTENT: Safe to call multiple times with the same URL - won't create duplicates
   */
  register(bookId: string, url: string, type: "audio" | "image" | "other" = "other", revokePrevious: boolean = true): void {
    if (!url.startsWith("blob:")) {
      return; // Not a blob URL, ignore
    }

    // IDEMPOTENT: If already registered, skip (prevents duplicates)
    if (this.urlToBookId.has(url)) {
      const existingBookId = this.urlToBookId.get(url);
      if (existingBookId === bookId) {
        // Already registered for this book, just update current audio track if needed
        if (type === "audio" && revokePrevious) {
          this.currentAudioTrack.set(bookId, url);
        }
        return;
      } else {
        // URL registered for different book - this shouldn't happen, log warning
        console.warn(`[BlobURLManager] Blob URL already registered for different book`, {
          url,
          existingBookId,
          newBookId: bookId,
        });
        return;
      }
    }

    // If this is an audio track and we should revoke previous, do it
    // BUT: Delay revocation if the previous URL is still active (being used by audio element)
    if (type === "audio" && revokePrevious) {
      const previousAudioUrl = this.currentAudioTrack.get(bookId);
      if (previousAudioUrl && previousAudioUrl !== url) {
        // Mark new URL as active
        this.activeAudioUrls.add(url);
        
        // Check if previous URL is still active
        if (this.activeAudioUrls.has(previousAudioUrl)) {
          // Previous URL is still in use - delay revocation
          console.log(`[BlobURLManager] Previous audio track still in use, delaying revocation for book ${bookId}`, {
            previous: previousAudioUrl,
            new: url,
          });
          this.scheduleDelayedRevocation(previousAudioUrl, 5000); // 5 second delay
        } else {
          // Previous URL not in use - safe to revoke immediately
          console.log(`[BlobURLManager] Revoking previous audio track blob for book ${bookId}`, {
            previous: previousAudioUrl,
            new: url,
          });
          this.revoke(previousAudioUrl);
        }
      } else {
        // New track - mark as active
        this.activeAudioUrls.add(url);
      }
      this.currentAudioTrack.set(bookId, url);
    }

    // Track URL for this book
    if (!this.urls.has(bookId)) {
      this.urls.set(bookId, new Set());
    }
    this.urls.get(bookId)!.add(url);
    this.urlToBookId.set(url, bookId);
    this.urlToType.set(url, type);
  }

  /**
   * Schedule delayed revocation for a blob URL
   * Used when the URL might still be in use by an audio element
   */
  private scheduleDelayedRevocation(url: string, delayMs: number): void {
    // Cancel any existing pending revocation for this URL
    const existingTimeout = this.pendingRevocations.get(url);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeoutId = window.setTimeout(() => {
      this.pendingRevocations.delete(url);
      
      // Only revoke if URL is no longer active
      if (!this.activeAudioUrls.has(url)) {
        console.log(`[BlobURLManager] Executing delayed revocation for ${url}`);
        this.revoke(url);
      } else {
        console.log(`[BlobURLManager] Skipping revocation - URL still active: ${url}`);
      }
    }, delayMs);

    this.pendingRevocations.set(url, timeoutId);
  }

  /**
   * Mark a blob URL as actively in use by an audio element
   * Call this when setting audio.src to prevent premature revocation
   */
  markAudioUrlActive(url: string): void {
    if (url.startsWith("blob:")) {
      this.activeAudioUrls.add(url);
      // Cancel any pending revocation
      const timeoutId = this.pendingRevocations.get(url);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.pendingRevocations.delete(url);
        console.log(`[BlobURLManager] Cancelled pending revocation for active URL: ${url}`);
      }
    }
  }

  /**
   * Mark a blob URL as no longer in use
   * Call this when audio element is done with the URL (e.g., src changed, element removed)
   */
  markAudioUrlInactive(url: string): void {
    if (url.startsWith("blob:")) {
      this.activeAudioUrls.delete(url);
      // Schedule delayed revocation (give it a moment in case it's being reused)
      this.scheduleDelayedRevocation(url, 2000); // 2 second delay
    }
  }

  /**
   * Revoke a specific blob URL
   */
  revoke(url: string): void {
    if (!url.startsWith("blob:")) {
      return; // Not a blob URL, ignore
    }

    // Cancel any pending revocation
    const timeoutId = this.pendingRevocations.get(url);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pendingRevocations.delete(url);
    }

    // Remove from active set
    this.activeAudioUrls.delete(url);

    const bookId = this.urlToBookId.get(url);
    if (bookId) {
      const bookUrls = this.urls.get(bookId);
      if (bookUrls) {
        bookUrls.delete(url);
        if (bookUrls.size === 0) {
          this.urls.delete(bookId);
        }
      }
      this.urlToBookId.delete(url);
      
      // If this was the current audio track, clear it
      if (this.currentAudioTrack.get(bookId) === url) {
        this.currentAudioTrack.delete(bookId);
      }
    }
    
    this.urlToType.delete(url);

    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      // URL may have already been revoked, ignore
      console.warn("[BlobURLManager] Failed to revoke blob URL:", error);
    }
  }

  /**
   * Revoke all blob URLs for a specific book
   */
  revokeForBook(bookId: string): void {
    const bookUrls = this.urls.get(bookId);
    if (!bookUrls) {
      return; // No URLs for this book
    }

    // Create a copy of the set to avoid modification during iteration
    const urlsToRevoke = Array.from(bookUrls);
    urlsToRevoke.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
        this.urlToBookId.delete(url);
        this.urlToType.delete(url);
      } catch (error) {
        console.warn("[BlobURLManager] Failed to revoke blob URL:", error);
      }
    });

    this.urls.delete(bookId);
    this.currentAudioTrack.delete(bookId);
  }

  /**
   * Revoke all blob URLs
   */
  revokeAll(): void {
    // Create a copy of all URLs to avoid modification during iteration
    const allUrls = Array.from(this.urlToBookId.keys());
    allUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        console.warn("[BlobURLManager] Failed to revoke blob URL:", error);
      }
    });

    this.urls.clear();
    this.urlToBookId.clear();
  }

  /**
   * Check if a blob URL is registered
   */
  has(url: string): boolean {
    return this.urlToBookId.has(url);
  }

  /**
   * Get all blob URLs for a book
   */
  getUrlsForBook(bookId: string): string[] {
    const bookUrls = this.urls.get(bookId);
    return bookUrls ? Array.from(bookUrls) : [];
  }

  /**
   * Get count of blob URLs for a book
   */
  getCountForBook(bookId: string): number {
    const bookUrls = this.urls.get(bookId);
    return bookUrls ? bookUrls.size : 0;
  }

  /**
   * Get total count of all blob URLs
   */
  getTotalCount(): number {
    return this.urlToBookId.size;
  }

  /**
   * Get statistics about blob URLs
   */
  getStats(): {
    total: number;
    byBook: Record<string, number>;
    byType: Record<string, number>;
    currentAudioTracks: Record<string, string>;
  } {
    const byBook: Record<string, number> = {};
    const byType: Record<string, number> = {};
    
    this.urls.forEach((urls, bookId) => {
      byBook[bookId] = urls.size;
    });
    
    this.urlToType.forEach((type) => {
      byType[type] = (byType[type] || 0) + 1;
    });
    
    const currentAudioTracks: Record<string, string> = {};
    this.currentAudioTrack.forEach((url, bookId) => {
      currentAudioTracks[bookId] = url;
    });

    return {
      total: this.urlToBookId.size,
      byBook,
      byType,
      currentAudioTracks,
    };
  }

  /**
   * Log statistics
   */
  logStats(): void {
    const stats = this.getStats();
    console.log('[BlobURLManager] Statistics:', {
      total: stats.total,
      byBook: stats.byBook,
      byType: stats.byType,
      currentAudioTracks: Object.keys(stats.currentAudioTracks).length,
      bookCount: Object.keys(stats.byBook).length,
    });
  }
}

// Export singleton instance
export const blobURLManager = new BlobURLManager();
