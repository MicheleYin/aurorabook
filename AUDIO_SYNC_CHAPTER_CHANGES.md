# How Audio Sync Changes Chapters When Track Differs

This document explains how the audio synchronization system automatically changes the displayed chapter when the currently playing audio track corresponds to a different chapter than what's currently shown.

## Overview

The system has **two main mechanisms** that detect and handle chapter mismatches:

1. **Real-time Progress Updates** - Continuously checks if the audio segment matches the displayed chapter
2. **Track Change Events** - Responds when the audio player switches to a different track

Both mechanisms only work when **auto-scroll (sync) is enabled**.

---

## Mechanism 1: Real-time Progress Updates

### Flow Diagram

```
Audio Player Progress Update
    ↓
handleAudioProgress() [useAudioPlayerProgress.ts]
    ↓
audioSync.updateHighlight() [useAudioTextSync.ts]
    ↓
findCurrentAudioSegment() [lib/epub.ts]
    ↓
Compare segment.chapterHref vs current chapter.href
    ↓
If MISMATCH && autoScrollEnabled:
    ├─ Find matching chapter in book.chapters
    ├─ Throttle check (500ms minimum between changes)
    └─ Call onChapterChange(matchingChapter.id, elementId)
```

### Key Code Location: `src/hooks/reader/useAudioTextSync.ts`

**Lines 78-170**: The `updateHighlight` function

```typescript
const updateHighlight = useCallback((
  book: Book,
  chapter: Chapter | undefined,
  trackHref: string,
  currentTime: number
) => {
  // 1. Find the current audio segment
  const segment = findCurrentAudioSegment(
    book.audioSyncMap,
    trackHref,
    currentTime
  );

  // 2. Compare chapter hrefs
  const chapterHref = chapter.href.split("#")[0];
  if (segment.chapterHref !== chapterHref) {
    console.log("[Audio Sync] Segment chapter mismatch", {
      segmentChapterHref: segment.chapterHref,
      currentChapterHref: chapterHref,
      autoScrollEnabled,
    });
    
    // 3. If auto-scroll enabled, navigate to correct chapter
    if (autoScrollEnabled && onChapterChange) {
      // Throttle to avoid rapid switching (500ms minimum)
      const timeSinceLastChange = Date.now() - lastChapterChangeTimeRef.current;
      if (timeSinceLastChange >= chapterChangeThrottleMs) {
        // 4. Find matching chapter
        const matchingChapter = book.chapters.find((ch) => {
          const chHref = ch.href.split("#")[0];
          return (
            chHref === segment.chapterHref ||
            chHref === segment.chapterHref.replace(/^OEBPS\//, "") ||
            chHref === `OEBPS/${segment.chapterHref}` ||
            `OEBPS/${chHref}` === segment.chapterHref ||
            chHref.endsWith(segment.chapterHref) ||
            segment.chapterHref.endsWith(chHref)
          );
        });

        // 5. Navigate if found and different
        if (matchingChapter && matchingChapter.id !== chapter.id) {
          onChapterChange(matchingChapter.id, segment.textElementId);
        }
      }
    }
  }
}, [autoScrollEnabled, onChapterChange, ...]);
```

### How It Works

1. **Called continuously** during audio playback via `handleAudioProgress` (every timeupdate event)
2. **Finds current segment** using `findCurrentAudioSegment()` which:
   - Takes the current track href and time
   - Searches `audioSyncMap.segments` for a matching segment
   - Returns the segment with `chapterHref`, `textElementId`, and time range
3. **Compares chapter hrefs**:
   - Current chapter: `chapter.href.split("#")[0]` (removes fragment)
   - Segment chapter: `segment.chapterHref`
4. **If mismatch detected**:
   - Only proceeds if `autoScrollEnabled === true`
   - Throttles changes (500ms minimum between chapter switches)
   - Finds the matching chapter using flexible href matching (handles OEBPS prefix variations)
   - Calls `onChapterChange()` with the new chapter ID and element ID to scroll to

### Path Normalization

The system handles various path formats:
- `OEBPS/chapter_1.xhtml` vs `chapter_1.xhtml`
- Case-insensitive matching
- Fragment identifier removal (`#section` removed)

---

## Mechanism 2: Track Change Events

### Flow Diagram

```
Audio Player Track Change
    ↓
setupAudioSource() [ReaderAudioPlayer.tsx]
    ↓
onTrackChange(track.href) callback
    ↓
handleTrackChange() [App.tsx]
    ↓
findChaptersForAudioTrack() [lib/epub.ts]
    ↓
If autoScrollEnabled && chapter mismatch:
    └─ handleSelectChapter(matchingChapter.id)
```

### Key Code Location: `src/App.tsx`

**Lines 290-336**: The `handleTrackChange` function

```typescript
const handleTrackChange = useCallback((trackHref: string) => {
  // Only change chapters if auto-scroll (sync) is enabled
  if (!autoScrollEnabled || !activeBook) {
    return; // Ignore if sync disabled
  }

  // Find chapters that use this audio track
  const chapterHrefs = findChaptersForAudioTrack(
    activeBook.audioSyncMap, 
    trackHref
  );
  
  if (chapterHrefs.length === 0) {
    return; // No chapters use this track
  }

  // Find the first matching chapter
  const normalizedChapterHrefs = chapterHrefs.map(href => href.split("#")[0]);
  
  const matchingChapter = activeBook.chapters.find((chapter) => {
    const chapterBaseHref = chapter.href.split("#")[0];
    return normalizedChapterHrefs.some(normalizedHref => {
      return chapterBaseHref === normalizedHref ||
             chapterBaseHref === normalizedHref.replace(/^OEBPS\//, "") ||
             chapterBaseHref === `OEBPS/${normalizedHref}` ||
             `OEBPS/${chapterBaseHref}` === normalizedHref;
    });
  });

  // Change chapter if different
  if (matchingChapter && matchingChapter.id !== activeChapterId) {
    handleSelectChapter(matchingChapter.id, {
      scrollPosition: "top",
      isManualSelection: false,
    });
  }
}, [autoScrollEnabled, activeBook, activeChapterId, handleSelectChapter]);
```

### How It Works

1. **Triggered when** the audio player loads a new track (in `ReaderAudioPlayer.tsx` line 650)
2. **Finds chapters** that use the track by searching `audioSyncMap.segments`
3. **Matches chapter** using the same flexible href matching as Mechanism 1
4. **Changes chapter** if:
   - Auto-scroll is enabled
   - A matching chapter is found
   - The matching chapter is different from the current one

### When Track Changes Occur

- User manually selects a different track
- Audio automatically advances to the next track (end of current track)
- Audio restoration after page reload

**Note**: Track changes during audio restoration are ignored (line 649 in `ReaderAudioPlayer.tsx`) to prevent disrupting restored state.

---

## Key Data Structures

### AudioSyncSegment
```typescript
type AudioSyncSegment = {
  textElementId: string;      // DOM element ID to highlight
  chapterHref: string;        // Which chapter this segment belongs to
  audioTrackHref: string;     // Which audio track contains this segment
  clipBegin: number;          // Start time in seconds
  clipEnd: number;            // End time in seconds
};
```

### AudioSyncMap
```typescript
type AudioSyncMap = {
  segments: AudioSyncSegment[];  // All sync segments for the book
};
```

---

## Important Behaviors

### Auto-Scroll Must Be Enabled

Both mechanisms **only work when `autoScrollEnabled === true`**. This allows users to:
- Manually navigate chapters without audio forcing changes
- Disable sync if they want to read ahead/behind the audio

### Throttling

- **Chapter changes**: 500ms minimum between switches (prevents rapid flickering)
- **Scroll updates**: 100ms minimum (for smooth scrolling)

### Path Matching Flexibility

The system handles multiple path formats:
- `OEBPS/chapter_1.xhtml` ↔ `chapter_1.xhtml`
- Case-insensitive
- Fragment removal (`#section` ignored)
- End-with matching (for partial paths)

### Element Scrolling

When changing chapters, the system:
1. Stores the `textElementId` from the segment
2. Loads the new chapter at the top
3. Scrolls to the specific element after chapter loads

---

## Example Scenario

**Situation**: User is viewing Chapter 3, but audio is playing Chapter 5 content

1. **Audio progress update** fires (every ~100ms during playback)
2. `updateHighlight()` finds the current segment
3. Segment has `chapterHref = "OEBPS/chapter_5.xhtml"`
4. Current chapter has `href = "OEBPS/chapter_3.xhtml"`
5. **Mismatch detected** → `segment.chapterHref !== chapterHref`
6. If `autoScrollEnabled === true`:
   - Finds Chapter 5 in `book.chapters`
   - Checks throttle (500ms since last change)
   - Calls `onChapterChange("chapter-5-id", "f123")`
7. Chapter 5 loads, scrolls to element `f123`, highlighting updates

---

## Related Files

- `src/hooks/reader/useAudioTextSync.ts` - Core sync logic
- `src/hooks/reader/useAudioPlayerProgress.ts` - Progress update handler
- `src/App.tsx` - Track change handler
- `src/lib/epub.ts` - Segment finding utilities
- `src/components/reader/ReaderAudioPlayer.tsx` - Audio player component
- `src/components/reader/ReaderWrapper.tsx` - Chapter change handler

