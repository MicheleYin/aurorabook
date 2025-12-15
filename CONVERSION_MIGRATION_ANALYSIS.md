# Conversion Feature Migration Analysis: React → Leptos

## Overview
This document compares the React conversion implementation (`src/hooks/useBookConversion.ts`) with the Leptos implementation (`src-frontend/src/hooks/use_conversion.rs`) to identify missing features.

## Missing Features in Leptos Implementation

### 1. **Chapter Cache Clearing** ❌
**React Implementation:**
- When a chapter is completed, React calls `clearChapterCache(source_path, completedChapter.href)` to clear the cache for that specific chapter
- This ensures the chapter is reloaded with updated HTML containing audio sync spans
- Falls back to `clearBookCache(source_path)` if chapter index is out of bounds

**Leptos Status:** 
- ❌ **MISSING** - No chapter cache clearing when chapters are completed
- The Leptos implementation updates the library state but doesn't clear the chapter cache

**Impact:** Users viewing a chapter during conversion won't see the updated chapter HTML with audio sync spans until they manually reload.

**Location:** `src/hooks/useBookConversion.ts:128` (React) vs `src-frontend/src/hooks/use_conversion.rs:275` (Leptos)

---

### 2. **Chapter-Updated Custom Event** ❌
**React Implementation:**
- Emits a `chapter-updated` custom event when a chapter is completed
- Event includes: `bookId`, `sourcePath`, `chapterId`, `chapterHref`, `chapterIndex`
- The reader component listens for this event and reloads the chapter if it's currently being viewed

**Leptos Status:**
- ❌ **MISSING** - No custom event emission
- No mechanism for the reader to know when a chapter has been updated

**Impact:** If a user is reading a chapter while it's being converted, they won't see the updated version with audio sync spans until they manually navigate away and back.

**Location:** `src/hooks/useBookConversion.ts:214-223` (React) vs `src-frontend/src/hooks/use_conversion.rs` (Leptos - missing)

**Reader Integration:** `src/components/reader/ReaderWrapper.tsx:354-414` listens for this event in React

---

### 3. **AbortController Support** ❌
**React Implementation:**
- Uses `AbortController` and `AbortSignal` for cancellation
- `conversionAbortControllerRef` tracks the current conversion
- When cancelling, immediately aborts the signal for responsive UI
- `convertEpubToAudiobook` accepts a `signal` parameter and checks for cancellation

**Leptos Status:**
- ❌ **MISSING** - No AbortController support
- Cancellation only happens via backend command, no frontend signal abort

**Impact:** Cancellation may feel less responsive as it only happens when the backend responds, not immediately on the frontend.

**Location:** 
- React: `src/hooks/useBookConversion.ts:29, 359-360, 529-531`
- React: `src/lib/audiobook-converter.ts:36, 52-54, 70-72, 90-92, 111-113, 118-120`
- Leptos: `src-frontend/src/hooks/use_conversion.rs` (missing)

---

### 4. **Incomplete Book Field Merging** ⚠️
**React Implementation:**
- `mergeBookAudioFields` merges: `chapters`, `fileSizeBytes`, `audioTracks`, `audioSyncMap`, `conversionStatus`, `completedChapters`, `voiceId`, `totalWords`, `wordsProcessed`
- Preserves all other fields from the current book

**Leptos Status:**
- ⚠️ **PARTIAL** - Only merges: `audio_tracks`, `audio_state`, `audio_sync_map`, `voice_id`, `conversion_status`
- Missing: `chapters`, `file_size_bytes`, `completed_chapters`, `total_words`, `words_processed`

**Impact:** 
- Updated chapter HTML won't be available in the library state
- File size changes won't be reflected
- Progress tracking fields won't be updated

**Location:**
- React: `src/lib/book-utils.ts:11-28`
- Leptos: `src-frontend/src/hooks/use_conversion.rs:278-290, 353-363`

---

### 5. **Book Cache Clearing After Conversion** ❌
**React Implementation:**
- Calls `clearBookCache(book.sourcePath)` after conversion completes
- Ensures fresh data is loaded from backend

**Leptos Status:**
- ❌ **MISSING** - No book cache clearing

**Impact:** May show stale cached data instead of fresh data from backend.

**Location:** `src/hooks/useBookConversion.ts:426` (React) vs `src-frontend/src/hooks/use_conversion.rs:137` (Leptos - missing)

---

### 6. **Update Book State Before Conversion** ❌
**React Implementation:**
- `performConversion` has an `updateBookStateBeforeConversion` option
- When enabled, immediately updates the book's `voiceId` and `conversionStatus` to "started" before conversion begins
- This makes the state available for resuming conversions

**Leptos Status:**
- ❌ **MISSING** - No pre-conversion state update

**Impact:** Book state may not reflect that conversion has started until after the first progress update.

**Location:** `src/hooks/useBookConversion.ts:383-397` (React) vs `src-frontend/src/hooks/use_conversion.rs:117-134` (Leptos - missing)

---

### 7. **Chapter Index Handling** ⚠️
**React Implementation:**
- Properly handles chapter index conversion (1-based from event to 0-based for array access)
- Finds the completed chapter by index and clears its cache specifically
- Has fallback logic if chapter index is out of bounds

**Leptos Status:**
- ⚠️ **PARTIAL** - Receives chapter completion events but doesn't use the chapter index to find and clear specific chapter cache

**Location:** `src/hooks/useBookConversion.ts:103-147` (React) vs `src-frontend/src/hooks/use_conversion.rs:247-319` (Leptos)

---

### 8. **Library Ref for Event Handlers** ⚠️
**React Implementation:**
- Uses `libraryRef` to access the latest library state in event handlers
- Prevents stale closure issues
- Tries to find book in current library state first before fetching from backend

**Leptos Status:**
- ⚠️ **PARTIAL** - Uses context signals but may have closure issues in async callbacks

**Location:** `src/hooks/useBookConversion.ts:34-39, 76-88, 263-275` (React) vs `src-frontend/src/hooks/use_conversion.rs:206-207, 223-228` (Leptos)

---

### 9. **Cancellation Toast Notification** ⚠️
**React Implementation:**
- Shows "Conversion cancelled" toast when `conversion-cancelled` event is received
- Only clears cancelling state after receiving the event from backend

**Leptos Status:**
- ⚠️ **PARTIAL** - Clears state but doesn't show toast notification

**Location:** `src/hooks/useBookConversion.ts:323-325` (React) vs `src-frontend/src/hooks/use_conversion.rs:326-384` (Leptos)

---

### 10. **Pending Book for Conversion (Library List)** ❓
**React Implementation:**
- Has `pendingBookForConversion` state for books selected from library list
- Has `showConvertDialog` state
- Used when user clicks convert from library list (not detail dialog)

**Leptos Status:**
- ❓ **UNCLEAR** - Need to verify if library list has conversion support
- ConvertToAudiobookDialog exists but may only be used in detail dialog

**Location:** `src/hooks/useBookConversion.ts:22-23` (React) vs `src-frontend/src/components/app/library_panel.rs` (Leptos - need to check)

---

### 11. **Resume Conversion Logic** ✅
**React Implementation:**
- `handleConvertBookFromDetail` checks if book already has audio tracks and conversion status
- Allows resuming if `conversionStatus === "started"`
- Uses stored `voiceId` from book for resuming

**Leptos Status:**
- ✅ **IMPLEMENTED** - Resume logic exists in book detail dialog
- Checks `conversion_status == "started"` and uses stored `voice_id` from book
- Shows "Resume Conversion" button when appropriate

**Location:** 
- React: `src/hooks/useBookConversion.ts:501-522`
- Leptos: `src-frontend/src/components/library/book_detail_dialog.rs:497-536`

---

### 12. **Progress Event Listener Cleanup** ⚠️
**React Implementation:**
- Sets up progress event listener in `convertEpubToAudiobook` function
- Properly cleans up listener in `finally` block
- Listener is scoped to the conversion call

**Leptos Status:**
- ⚠️ **DIFFERENT APPROACH** - Sets up global event listeners in `ConversionProvider`
- May receive progress for wrong book if multiple conversions happen
- No per-conversion listener cleanup

**Location:**
- React: `src/lib/audiobook-converter.ts:68-86, 128-130`
- Leptos: `src-frontend/src/hooks/use_conversion.rs:212-244`

---

## Summary

### Critical Missing Features (High Priority)
1. ❌ **Chapter cache clearing on chapter completion** - Users won't see updated chapter HTML with audio sync spans
2. ❌ **Chapter-updated custom event emission** - Reader won't know to reload updated chapters
3. ❌ **AbortController support for responsive cancellation** - Cancellation feels less responsive
4. ❌ **Book cache clearing after conversion** - May show stale cached data

### Important Missing Features (Medium Priority)
5. ⚠️ **Incomplete book field merging** - Missing: `chapters`, `fileSizeBytes`, `completedChapters`, `totalWords`, `wordsProcessed`
6. ❌ **Update book state before conversion starts** - State not immediately available for resuming
7. ⚠️ **Chapter index handling** - Doesn't use chapter index to find and clear specific chapter cache
8. ⚠️ **Cancellation toast notification** - No user feedback when cancellation completes

### Nice-to-Have / Verification Needed
9. ❓ **Pending book conversion from library list** - Need to verify if library list supports conversion
10. ⚠️ **Progress event listener architecture** - Global listeners vs per-call (may receive progress for wrong book)

---

## Recommendations

1. **Implement chapter cache clearing** - Critical for real-time chapter updates
2. **Emit chapter-updated events** - Essential for reader component integration
3. **Add AbortController support** - Improves cancellation responsiveness
4. **Complete book field merging** - Ensures all updated data is available
5. **Clear book cache after conversion** - Ensures fresh data
6. **Add cancellation toast** - Better user feedback
7. **Review progress event listener architecture** - Consider per-call listeners vs global

