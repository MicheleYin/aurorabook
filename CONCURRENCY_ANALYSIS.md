# Concurrency Analysis: Chapter Changing vs Audio Track Changing

## Overview

This document analyzes the concurrency bugs that occur when changing audio tracks while audio is playing. The main issue is that multiple asynchronous operations can trigger chapter changes simultaneously, leading to race conditions.

## Flow Diagrams

### Track Change Flow

```
User clicks track change
    ↓
ReaderAudioPlayer.playTrackAt()
    ├─ Sets isAutoAdvancingRef = true
    ├─ Sets isPlayingRef = true
    └─ Calls setCurrentIndex(nextIndex)
        ↓
    useEffect triggers (line 839)
        ↓
    setupAudioSource() (line 655)
        ├─ Calls onTrackChanged(track.id) (line 689)
        └─ Calls onTrackChange(track.href) (line 695) [SYNCHRONOUS]
            ↓
        TWO HANDLERS CALLED:
        1. handleAudioTrackChange() [ASYNC] (useAudioPlayerProgress.ts:88)
            ├─ audioSync.markTrackChange(trackHref) (line 96)
            ├─ await onSaveProgress() (line 100)
            └─ await preloadNextAudioTrack() (line 106)
        
        2. handleTrackChange() [SYNCHRONOUS] (App.tsx:322)
            └─ handleSelectChapter() (line 362) [ASYNC]
                └─ handleChapterChange() (ReaderWrapper.tsx:306)
                    ├─ await saveProgress() (line 320)
                    └─ await ensureChapterLoaded() (line 358)
```

### Audio Progress Update Flow (Continuous)

```
Audio playing → timeupdate events
    ↓
handleAudioProgress() (useAudioPlayerProgress.ts:66)
    ↓
audioSync.updateHighlight() (useAudioTextSync.ts:138)
    ├─ Checks if chapter should change (line 222)
    ├─ Checks isTrackChanging (line 240)
    └─ If mismatch && !isTrackChanging:
        └─ onChapterChange() (line 290)
            └─ handleAudioSyncChapterChange() (ReaderWrapper.tsx:489)
                └─ handleChapterChange() (line 506)
```

## Identified Race Conditions

### Race Condition 1: Track Change Marking vs Chapter Change

**Problem:**
- `onTrackChange(track.href)` is called synchronously in `setupAudioSource()` (line 695)
- This triggers `handleTrackChange()` in App.tsx which calls `handleSelectChapter()` synchronously
- Meanwhile, `handleAudioTrackChange()` is async and calls `markTrackChange()` (line 96)
- If `updateHighlight()` is called between `onTrackChange()` and `markTrackChange()`, it won't see the track change flag and might trigger another chapter change

**Timeline:**
```
T0: playTrackAt() called
T1: setupAudioSource() calls onTrackChange() [SYNC]
T2: handleTrackChange() starts handleSelectChapter() [ASYNC]
T3: handleAudioTrackChange() starts [ASYNC]
T4: Audio progress update fires → handleAudioProgress()
T5: updateHighlight() checks isTrackChanging → FALSE (not marked yet!)
T6: updateHighlight() triggers chapter change
T7: markTrackChange() finally executes
```

**Location:**
- `ReaderAudioPlayer.tsx:695` - `onTrackChange` called before track change is marked
- `useAudioTextSync.ts:240` - Check happens before track change is marked

### Race Condition 2: Multiple Chapter Change Triggers

**Problem:**
- `handleTrackChange()` in App.tsx triggers a chapter change via `handleSelectChapter()`
- `updateHighlight()` might also detect a mismatch and trigger a chapter change
- Both can execute simultaneously, causing:
  - Duplicate chapter loads
  - Progress saved multiple times
  - UI flickering/jumping between chapters

**Timeline:**
```
T0: Track change initiated
T1: handleTrackChange() → handleSelectChapter(chapterA)
T2: Audio progress update → updateHighlight() detects mismatch
T3: updateHighlight() → onChapterChange(chapterA) [same chapter!]
T4: Both chapter changes execute in parallel
T5: Race condition: which one completes first?
```

**Location:**
- `App.tsx:362` - `handleTrackChange` calls `handleSelectChapter`
- `useAudioTextSync.ts:290` - `updateHighlight` calls `onChapterChange`

### Race Condition 3: Progress Saving During Track Change

**Problem:**
- `handleAudioTrackChange()` saves progress (line 100)
- `handleTrackChange()` → `handleChapterChange()` also saves progress (line 320)
- Both save progress for the same chapter, potentially with different timestamps
- The second save might overwrite the first with stale data

**Timeline:**
```
T0: Track change initiated
T1: handleAudioTrackChange() starts saving progress [ASYNC]
T2: handleTrackChange() → handleChapterChange() starts saving progress [ASYNC]
T3: Both save operations execute
T4: Last one to complete overwrites the other
```

**Location:**
- `useAudioPlayerProgress.ts:100` - `onSaveProgress` in track change handler
- `ReaderWrapper.tsx:320` - `saveProgress` in chapter change handler

### Race Condition 4: Track Change Grace Period Timing

**Problem:**
- Grace period is 2 seconds (TRACK_CHANGE_GRACE_PERIOD_MS)
- Track change might complete faster than 2 seconds
- If `updateHighlight()` is called after track change completes but within grace period, it will be blocked
- If called after grace period expires, it might trigger an unnecessary chapter change

**Location:**
- `useAudioTextSync.ts:31` - `TRACK_CHANGE_GRACE_PERIOD_MS = 2000`
- `useAudioTextSync.ts:220` - Grace period check

### Race Condition 5: Stale Chapter Reference in updateHighlight

**Problem:**
- `updateHighlight()` receives `chapter` parameter which might be stale
- If chapter changes while `updateHighlight()` is executing, it might use old chapter data
- The `lastChapterIdRef` check (line 184) helps but doesn't prevent all cases

**Location:**
- `useAudioTextSync.ts:138` - `updateHighlight` callback
- `useAudioTextSync.ts:184` - Chapter ID change detection

## Root Causes

1. **Synchronous vs Asynchronous Execution**: `onTrackChange` is called synchronously, but `markTrackChange` happens asynchronously, creating a window where track changes aren't marked.

2. **Multiple Entry Points**: Both `handleTrackChange` and `updateHighlight` can trigger chapter changes, leading to duplicate operations.

3. **No Coordination**: There's no mechanism to prevent `updateHighlight` from triggering chapter changes when a track-change-initiated chapter change is already in progress.

4. **Progress Saving Duplication**: Multiple handlers save progress independently without coordination.

5. **Timing Windows**: The grace period and async operations create timing windows where race conditions can occur.

## Recommended Fixes

### Fix 1: Mark Track Change Before Calling onTrackChange

**Location:** `ReaderAudioPlayer.tsx:655-696`

Mark the track change BEFORE calling `onTrackChange` to ensure the flag is set before any handlers execute.

```typescript
// In setupAudioSource, before calling onTrackChange:
if (onTrackChange && !isRestoringRef.current) {
  // Mark track change FIRST (if we have access to audioSync)
  // Then call onTrackChange
  onTrackChange(track.href);
}
```

**Issue:** `setupAudioSource` doesn't have direct access to `audioSync`. Need to pass it or use a different approach.

### Fix 2: Coordinate Chapter Changes

**Location:** `useAudioTextSync.ts:240-247`

Add a flag to track when a chapter change is in progress from a track change, and prevent `updateHighlight` from triggering additional changes.

```typescript
const chapterChangeInProgressRef = useRef<string | null>(null);

// In updateHighlight, before triggering chapter change:
if (chapterChangeInProgressRef.current === matchingChapter.id) {
  // Chapter change already in progress for this chapter
  return;
}
```

### Fix 3: Debounce/Throttle Track Change Chapter Changes

**Location:** `App.tsx:322-372`

Add throttling to `handleTrackChange` to prevent rapid chapter changes.

### Fix 4: Unify Progress Saving

**Location:** Multiple locations

Ensure progress is saved only once per track/chapter change, not multiple times.

### Fix 5: Make Track Change Marking Synchronous

**Location:** `useAudioPlayerProgress.ts:88-108`

Make `markTrackChange` happen synchronously before any async operations, or pass a flag to indicate track change is starting.

## Testing Scenarios

1. **Rapid Track Changes**: Change tracks quickly while audio is playing
2. **Track Change During Progress Update**: Change track right when a progress update fires
3. **Chapter Change During Track Change**: Manually change chapter while track change is in progress
4. **Multiple Track Changes**: Queue multiple track changes quickly
5. **Track Change with Slow Network**: Simulate slow chapter loading during track change

