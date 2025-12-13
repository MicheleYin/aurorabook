# Audio Player Track Change and Play/Pause Timing Issues

## Overview

This document analyzes the timing and loading issues that occur when audio track changes interact with chapter loading and play/pause operations.

## Key Components

### 1. Track Change Flow

**Location**: `ReaderAudioPlayer.tsx:1199-1258` (`playTrackAt`)

**Current Flow**:
1. `trackChangeInProgressRef.current = true` is set synchronously
2. Playing state is preserved (`isPlayingRef.current = true` if was playing)
3. `isAutoAdvancingRef.current = true` is set if was playing
4. `setCurrentIndex(nextIndex)` triggers track change
5. Track URL loading happens asynchronously in `useAudioTrackLoading`
6. `setupAudioSource` is called when track URL is available
7. `trackChangeInProgressRef.current = false` is cleared in multiple event handlers

**Issues**:
- The flag is cleared in multiple places (`canplay`, `canplaythrough`, `loadeddata`, `playing` events)
- There's a race condition: flag might be cleared before audio is actually ready to play
- Chapter loading (if triggered) happens asynchronously and can interfere

### 2. Chapter Loading During Track Changes

**Location**: `useAudioPlayerProgress.ts:92-150` (`handleAudioTrackChange`)

**Current Flow**:
1. `audioSync.markTrackChange(trackHref)` is called synchronously
2. Progress is saved (async)
3. If `autoScrollEnabled`, chapter change is triggered (async)
4. Chapter loading happens asynchronously
5. Track URL loading happens in parallel

**Issues**:
- Chapter loading and track loading happen in parallel but aren't coordinated
- If chapter loads before track URL is ready, `setupAudioSource` might be called with wrong chapter context
- The `trackChangeInProgressRef` flag in audio player doesn't account for chapter loading time

### 3. Play/Pause During Track Changes

**Location**: `ReaderAudioPlayer.tsx:1075-1197` (`togglePlayback`)

**Current Flow**:
1. Checks `trackChangeInProgressRef.current` at start
2. If track URL not loaded, loads it (async)
3. Sets audio source if needed
4. Waits for `canplay` event
5. Checks `trackChangeInProgressRef.current` again before playing
6. Calls `audio.play()`

**Issues**:
- There's a window between when `trackChangeInProgressRef` is cleared and when audio is actually ready
- If user clicks play/pause during track change, the check at line 1082 might pass, but the check at line 1177 might also pass even though track isn't fully ready
- The flag might be cleared by `setupAudioSource` event handlers before `togglePlayback` completes

### 4. Track URL Loading

**Location**: `useAudioTrackLoading.ts:48-201`

**Current Flow**:
1. Effect runs when `currentTrack` changes
2. Checks if track URL is already loaded
3. If not, marks as loading and calls `ensureAudioTrackLoaded` (async)
4. Updates refs when loaded
5. Preloads next track

**Issues**:
- Loading happens in a `useEffect` that depends on `currentTrack?.id`
- There's a delay between `setCurrentIndex` and when the effect runs
- The `isTrackLoading` state might not accurately reflect loading state during rapid track changes

## Specific Race Conditions

### Race Condition 1: Track Change Flag Cleared Too Early

**Scenario**:
1. User clicks next track
2. `trackChangeInProgressRef.current = true`
3. `setCurrentIndex` is called
4. Track URL loading starts
5. `setupAudioSource` is called when URL is ready
6. `canplay` event fires → `trackChangeInProgressRef.current = false` is set
7. User clicks play/pause
8. `togglePlayback` checks flag at line 1177 → flag is false, so it proceeds
9. But audio might not be fully ready yet

**Fix**: Don't clear `trackChangeInProgressRef` until audio is actually playing (or explicitly ready)

### Race Condition 2: Chapter Loading During Track Change

**Scenario**:
1. Track change triggers chapter change
2. Chapter loading starts (async)
3. Track URL loading starts (async)
4. Track URL loads first → `setupAudioSource` is called
5. Chapter is still loading → wrong chapter context
6. Chapter loads → triggers reload or state update
7. Audio state gets confused

**Fix**: Wait for chapter to load before setting up audio source, or coordinate both operations

### Race Condition 3: Play/Pause During Track URL Loading

**Scenario**:
1. User clicks next track
2. `trackChangeInProgressRef.current = true`
3. Track URL loading starts
4. User clicks play before track URL is loaded
5. `togglePlayback` checks flag at line 1082 → blocked
6. Track URL loads
7. `setupAudioSource` clears flag
8. User clicks play again
9. But there might be a brief moment where flag is cleared but audio isn't ready

**Fix**: Ensure flag is only cleared when audio is actually ready to play

### Race Condition 4: Multiple Track Changes in Quick Succession

**Scenario**:
1. User clicks next track rapidly (multiple times)
2. Multiple `playTrackAt` calls queue up
3. Each sets `trackChangeInProgressRef.current = true`
4. Multiple track URL loads start
5. First track loads → `setupAudioSource` clears flag
6. But second track change is still in progress
7. State gets confused

**Fix**: Cancel previous track changes when new one is initiated, or queue track changes

## Recommendations

### 1. Improve Track Change Flag Management

**Location**: `useAudioPlaybackControl.ts:182-320`

**Change**: Only clear `trackChangeInProgressRef` when audio is actually playing, not just when it's ready:

```typescript
// Clear track change flag when playback actually starts
const handlePlaying = () => {
  if (trackChangeInProgressRef.current) {
    logger.log("[Audio Player] Playback started - clearing track change flag", {
      trackId: track.id,
    });
    trackChangeInProgressRef.current = false;
  }
  // ... rest of handler
};
```

### 2. Coordinate Chapter and Track Loading

**Location**: `useAudioPlayerProgress.ts:92-150`

**Change**: Wait for chapter to load before proceeding with track setup:

```typescript
const handleAudioTrackChange = useCallback(async (trackHref: string) => {
  // ... existing code ...
  
  // Handle chapter change if needed
  if (autoScrollEnabled && onTrackChangeChapterChange) {
    // ... find matching chapter ...
    if (matchingChapter && matchingChapter.id !== activeChapter?.id) {
      // Wait for chapter to load before continuing
      await onTrackChangeChapterChange(matchingChapter.id, {
        scrollPosition: "top",
        isManualSelection: false,
      });
      // Add a small delay to ensure chapter is fully loaded in DOM
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Now safe to proceed with track change
}, [/* deps */]);
```

### 3. Add Track Change Queue

**Location**: `ReaderAudioPlayer.tsx:1199-1258`

**Change**: Cancel previous track changes when new one is initiated:

```typescript
const playTrackAt = useCallback((nextIndex: number) => {
  // Cancel any pending track changes
  if (trackChangeInProgressRef.current) {
    logger.log("[Audio Player] Cancelling previous track change");
    // Clear any pending operations
  }
  
  // ... rest of function
}, [/* deps */]);
```

### 4. Improve Play/Pause Safety Checks

**Location**: `ReaderAudioPlayer.tsx:1075-1197`

**Change**: Add additional checks to ensure audio is ready:

```typescript
const togglePlayback = useCallback(async () => {
  // ... existing checks ...
  
  // Additional check: ensure audio source is set and ready
  if (audio.src !== trackUrl || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
    logger.log("[Audio Player] Audio not ready, waiting...");
    // Wait for audio to be ready
    await new Promise<void>((resolve) => {
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && audio.src === trackUrl) {
        resolve();
      } else {
        const checkReady = () => {
          if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && audio.src === trackUrl) {
            audio.removeEventListener("canplay", checkReady);
            audio.removeEventListener("canplaythrough", checkReady);
            resolve();
          }
        };
        audio.addEventListener("canplay", checkReady);
        audio.addEventListener("canplaythrough", checkReady);
        // Timeout after 5 seconds
        setTimeout(() => {
          audio.removeEventListener("canplay", checkReady);
          audio.removeEventListener("canplaythrough", checkReady);
          resolve();
        }, 5000);
      }
    });
  }
  
  // ... rest of function
}, [/* deps */]);
```

### 5. Add Track Change State Machine

Consider implementing a state machine for track changes:
- `IDLE`: No track change in progress
- `LOADING_URL`: Track URL is being loaded
- `LOADING_CHAPTER`: Chapter is being loaded (if needed)
- `SETTING_UP`: Audio source is being set up
- `READY`: Track is ready to play

This would make the state more explicit and easier to reason about.

## Testing Scenarios

1. **Rapid track changes**: Click next/previous rapidly and verify no state corruption
2. **Play during track change**: Click play while track is changing
3. **Pause during track change**: Click pause while track is changing
4. **Chapter change during track change**: Verify chapter loads correctly when track change triggers it
5. **Track URL loading timeout**: Verify graceful handling when track URL fails to load
6. **Auto-advance**: Verify smooth transition when track ends and auto-advances

## Related Files

- `src/components/reader/ReaderAudioPlayer.tsx` - Main audio player component
- `src/hooks/reader/useAudioPlaybackControl.ts` - Playback control logic
- `src/hooks/reader/useAudioTrackLoading.ts` - Track URL loading
- `src/hooks/reader/useAudioPlayerProgress.ts` - Audio-text sync and chapter changes
- `src/hooks/reader/.ts` - Audio element event handlers
- `src/components/reader/ReaderWrapper.tsx` - Chapter loading coordination

