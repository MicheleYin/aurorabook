# useEffect Analysis - TTS Tauri Codebase

This document provides a comprehensive analysis of all `useEffect` hooks in the codebase, explaining their purpose, logic, and dependencies.

## Overview

The codebase follows a philosophy of **minimizing useEffect usage** in favor of explicit callbacks and derived state. Many hooks explicitly state "No useEffects" in their comments. However, there are still several strategic uses of `useEffect` for:

1. **Event listener setup/cleanup** (Tauri events, DOM events)
2. **State synchronization** (keeping refs in sync, hydrating from storage)
3. **Side effects that must run after render** (theme application, animations)
4. **Lifecycle management** (component mount/unmount)

---

## File-by-File Analysis

### 1. `src/App.tsx`

#### 1.1 Auto-scroll Setting Hydration (lines 101-105)
```typescript
useEffect(() => {
  if (isSettingsHydrated && settings.autoScrollEnabled !== undefined) {
    setAutoScrollEnabled(settings.autoScrollEnabled);
  }
}, [isSettingsHydrated, settings.autoScrollEnabled]);
```

**Purpose:** Hydrates the `autoScrollEnabled` state from persistent settings when settings are loaded.

**Logic:**
- Waits for settings to be hydrated (`isSettingsHydrated`)
- Only updates if `autoScrollEnabled` is defined (not undefined)
- Syncs local state with persisted settings

**Why useEffect:** Settings are loaded asynchronously, so we need to wait for hydration before applying them.

---

#### 1.2 Theme Application (lines 109-126)
```typescript
useEffect(() => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.toggle("dark", resolvedUiTheme === "dark");

  if (uiTheme !== "system") {
    return;
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => {
    const systemResolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    root.classList.toggle("dark", systemResolved === "dark");
  };
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}, [uiTheme, resolvedUiTheme]);
```

**Purpose:** Applies theme classes to the document root and listens for system theme changes.

**Logic:**
- Applies dark/light class based on `resolvedUiTheme`
- If theme is "system", sets up a media query listener for system preference changes
- Cleans up listener on unmount or theme change

**Why useEffect:** Direct DOM manipulation must happen after render. Media query listeners need cleanup.

---

#### 1.3 Auto-open Audio Player (lines 351-355)
```typescript
useEffect(() => {
  if (activeView === "reader" && hasAudioTracks) {
    setIsAudioPlayerOpen(true);
  }
}, [activeView, hasAudioTracks]);
```

**Purpose:** Automatically opens the audio player when switching to reader view with audio tracks.

**Logic:**
- When view changes to "reader" AND book has audio tracks, open the player
- Simple conditional state update

**Why useEffect:** Side effect that should happen when view changes, not during render.

---

### 2. `src/components/reader/ReaderWrapper.tsx`

#### 2.1 Audio Progress Sync (lines 516-531)
```typescript
useEffect(() => {
  if (currentAudioProgress) {
    // Compare by value, not reference, to avoid unnecessary updates
    const lastProgress = lastProgressRef.current;
    const isNewProgress = 
      !lastProgress ||
      lastProgress.trackHref !== currentAudioProgress.trackHref ||
      lastProgress.currentTimeSeconds !== currentAudioProgress.currentTimeSeconds ||
      lastProgress.updatedAt !== currentAudioProgress.updatedAt;
    
    if (isNewProgress) {
      lastProgressRef.current = currentAudioProgress;
      handleAudioProgressRef.current(currentAudioProgress);
    }
  }
}, [currentAudioProgress]);
```

**Purpose:** Syncs audio progress updates from App.tsx to the reader's audio sync system.

**Logic:**
- Compares progress by value (not reference) to avoid unnecessary updates
- Only calls handler if progress actually changed (track, time, or timestamp)
- Uses ref for handler to avoid stale closures

**Why useEffect:** Progress comes from parent as prop, needs to be forwarded to child hook. Value comparison prevents unnecessary work.

---

### 3. `src/hooks/useBookConversion.ts`

#### 3.1 Library Ref Sync (lines 37-39)
```typescript
useEffect(() => {
  libraryRef.current = library;
}, [library]);
```

**Purpose:** Keeps a ref in sync with the library state for use in event listeners.

**Logic:**
- Simple ref update whenever library changes
- Used in event listeners that need latest library state without re-running setup

**Why useEffect:** Event listeners are set up once but need access to latest library state. Ref avoids stale closures.

---

#### 3.2 Tauri Event Listeners (lines 42-228)
```typescript
useEffect(() => {
  // Only set up listener once
  if (listenerSetupRef.current) {
    return;
  }
  
  let unlistenChapter: (() => void) | null = null;
  let unlistenCancelled: (() => void) | null = null;

  const setupListeners = async () => {
    // Listen for chapter completion events
    unlistenChapter = await listen<{...}>("chapter-completed", async (event) => {
      // Refresh book when chapter completes
      // Merge audio fields to preserve state
    });
    
    // Listen for conversion cancellation events
    unlistenCancelled = await listen<{...}>("conversion-cancelled", async (event) => {
      // Refresh book when conversion is cancelled
      // Clear cancelling state
    });
    
    listenerSetupRef.current = true;
  };

  void setupListeners();

  return () => {
    if (unlistenChapter) unlistenChapter();
    if (unlistenCancelled) unlistenCancelled();
    listenerSetupRef.current = false;
  };
}, []); // Empty dependency array - only set up once
```

**Purpose:** Sets up Tauri event listeners for book conversion progress and cancellation.

**Logic:**
- Sets up listeners only once (guarded by `listenerSetupRef.current`)
- Listens for "chapter-completed" events to refresh book data
- Listens for "conversion-cancelled" events to update UI
- Uses `libraryRef.current` to access latest library state in listeners
- Cleans up listeners on unmount

**Why useEffect:** Event listeners must be set up once and cleaned up. Async setup requires useEffect.

---

### 4. `src/hooks/usePersistentState.ts`

#### 4.1 State Persistence (lines 81-84)
```typescript
useEffect(() => {
  if (!isHydrated) return;
  void persistState(state);
}, [isHydrated, persistState, state]);
```

**Purpose:** Persists state to Tauri store whenever state changes (after hydration).

**Logic:**
- Only persists after initial hydration (prevents overwriting with default values)
- Persists whenever state changes
- Uses `void` to handle async without blocking

**Why useEffect:** Side effect (writing to storage) should happen after state changes, not during render.

---

#### 4.2 State Hydration (lines 86-113)
```typescript
useEffect(() => {
  let cancelled = false;

  const hydrateState = async () => {
    try {
      const store = await ensureStore();
      const payload = await store?.get<PersistedPayload<T>>(storeKey);
      if (payload?.version === version && payload.value) {
        const merged = { ...defaultValue, ...payload.value };
        if (!cancelled) {
          setState(merged);
        }
      }
    } catch (error) {
      console.warn(`${logPrefix}: failed to load store.`, error);
    } finally {
      if (!cancelled) {
        setIsHydrated(true);
      }
    }
  };

  void hydrateState();

  return () => {
    cancelled = true;
  };
}, [ensureStore, storeKey, version, defaultValue, logPrefix]);
```

**Purpose:** Loads persisted state from Tauri store on mount.

**Logic:**
- Loads store asynchronously
- Validates version matches
- Merges persisted value with defaults
- Uses cancellation flag to prevent state updates if component unmounts
- Sets `isHydrated` flag when done

**Why useEffect:** Async data loading on mount. Needs cleanup to prevent state updates after unmount.

---

### 5. `src/contexts/AppContext.tsx`

#### 5.1 Auto-select First Book (lines 246-271)
```typescript
useEffect(() => {
  if (!library.length) {
    setActiveBookId(undefined);
    setActiveChapterId(undefined);
    manualSelectionRef.current = null;
    return;
  }

  // Only auto-select if no book is currently selected or the selected book doesn't exist
  if (!activeBookId || !library.some((book) => book.id === activeBookId)) {
    // Don't auto-select if there's a pending manual selection
    if (manualSelectionRef.current) {
      return;
    }
    const firstBook = library[0];
    setActiveBookId(firstBook.id);
    const fallbackChapterId = getValidChapterId(firstBook);
    setActiveChapterId(fallbackChapterId);
    if (fallbackChapterId) {
      updateBookProgress(firstBook.id, { chapterId: fallbackChapterId });
    }
  } else {
    // Validate existing selection when library changes
    validateActiveSelection();
  }
}, [library, activeBookId, getValidChapterId, updateBookProgress, validateActiveSelection]);
```

**Purpose:** Automatically selects the first book when library loads or when selected book is deleted.

**Logic:**
- Clears selection if library is empty
- Auto-selects first book if no book is selected or selected book doesn't exist
- Respects manual selections (checks `manualSelectionRef`)
- Validates existing selection when library changes
- Updates progress when auto-selecting

**Why useEffect:** Side effect that should happen when library changes, not during render. Needs to check conditions before updating state.

---

### 6. `src/components/ReaderPanel.tsx`

#### 6.1 Reset Immersive on Book/Chapter Change (lines 66-77)
```typescript
useEffect(() => {
  const bookChanged = previousBookIdRef.current !== activeBook?.id;
  const chapterChanged = previousChapterIdRef.current !== activeChapter?.id;

  if (bookChanged || chapterChanged) {
    handleBookOrChapterChange();
  }

  previousBookIdRef.current = activeBook?.id;
  previousChapterIdRef.current = activeChapter?.id;
}, [activeBook?.id, activeChapter?.id, handleBookOrChapterChange]);
```

**Purpose:** Resets immersive mode when book or chapter changes.

**Logic:**
- Tracks previous book/chapter IDs in refs
- Detects changes by comparing current vs previous
- Calls handler when change detected
- Updates refs for next comparison

**Why useEffect:** Side effect (resetting UI state) should happen when book/chapter changes, not during render.

---

#### 6.2 Chrome Visibility Notification (lines 82-87)
```typescript
useEffect(() => {
  onChromeVisibilityChange?.(chromeVisible);
  return () => {
    onChromeVisibilityChange?.(true);
  };
}, [chromeVisible, onChromeVisibilityChange]);
```

**Purpose:** Notifies parent component when chrome visibility changes.

**Logic:**
- Calls callback whenever `chromeVisible` changes
- On unmount, resets to visible (cleanup)

**Why useEffect:** Side effect (calling parent callback) should happen when state changes. Cleanup ensures parent state is reset.

---

#### 6.3 Audio Reopen Button Animation (lines 112-127)
```typescript
useEffect(() => {
  if (showAudioReopen) {
    setShouldRenderAudioReopen(true);
    // Small delay to trigger enter animation
    const timer = setTimeout(() => {
      setIsAudioReopenVisible(true);
    }, 10);
    return () => {
      clearTimeout(timer);
      setIsAudioReopenVisible(false);
      setShouldRenderAudioReopen(false);
    };
  } else {
    setIsAudioReopenVisible(false);
    // Delay unmount to allow exit animation
    const timer = setTimeout(() => {
      setShouldRenderAudioReopen(false);
    }, 300);
    return () => clearTimeout(timer);
  }
}, [showAudioReopen]);
```

**Purpose:** Manages animation state for audio player reopen button.

**Logic:**
- When button should show: render it, then trigger visible state after 10ms (for enter animation)
- When button should hide: hide immediately, then unmount after 300ms (for exit animation)
- Cleans up timers

**Why useEffect:** Animation timing requires delays that can't be done during render.

---

### 7. `src/components/ThemeSwitcher.tsx`

#### 7.1 Theme Transition Animation (lines 25-35)
```typescript
useEffect(() => {
  if (previousValue !== value) {
    setIsTransitioning(true);
    const timer = setTimeout(() => {
      setIsTransitioning(false);
      setPreviousValue(value);
    }, 150);
    return () => clearTimeout(timer);
  }
}, [value, previousValue]);
```

**Purpose:** Manages transition animation when theme changes.

**Logic:**
- Detects theme value change
- Sets transitioning state to true
- After 150ms, clears transitioning and updates previous value
- Cleans up timer

**Why useEffect:** Animation timing requires setTimeout, which is a side effect.

---

### 8. `src/hooks/library/LibraryContext.tsx`

#### 8.1 Library Hydration (lines 59-75)
```typescript
useEffect(() => {
  let cancelled = false;

  const hydrateLibrary = async () => {
    try {
      await refreshLibrary();
      if (!cancelled) {
        // Library is now loaded
      }
    } catch (error) {
      logger.error("Failed to hydrate library:", error);
    }
  };

  void hydrateLibrary();

  return () => {
    cancelled = true;
  };
}, [refreshLibrary]);
```

**Purpose:** Loads library from backend on mount.

**Logic:**
- Calls `refreshLibrary()` to load books from backend
- Uses cancellation flag to prevent state updates after unmount
- Cleans up on unmount

**Why useEffect:** Async data loading on mount. Needs cleanup to prevent updates after unmount.

---

### 9. `src/components/library/LibraryList.tsx` & `LibraryGrid.tsx`

#### 9.1 Exit Animation Management (lines 38-60)
```typescript
useEffect(() => {
  const currentBookIds = new Set(books.map(b => b.id));
  const previousBookIds = new Set(previousBooksRef.current.map(b => b.id));

  // Find books that are leaving
  const leavingIds = Array.from(previousBookIds).filter(id => !currentBookIds.has(id));

  if (leavingIds.length > 0) {
    // Mark as exiting for animation
    setExitingBookIds(prev => new Set([...prev, ...leavingIds]));
    
    // Remove from exiting after animation completes
    const timer = setTimeout(() => {
      setExitingBookIds(prev => {
        const next = new Set(prev);
        leavingIds.forEach(id => next.delete(id));
        return next;
      });
    }, 300); // Match animation duration
    
    return () => clearTimeout(timer);
  }

  previousBooksRef.current = books;
}, [books]);
```

**Purpose:** Manages exit animations when books are removed from library.

**Logic:**
- Compares current books with previous to find removed books
- Marks removed books as "exiting" for animation
- After 300ms (animation duration), removes from exiting set
- Updates previous ref for next comparison

**Why useEffect:** Animation timing requires setTimeout. Side effect that should happen when books array changes.

---

### 10. `src/components/library/ConvertToAudiobookDialog.tsx`

#### 10.1 Voice Selection Sync (lines 33-37)
```typescript
useEffect(() => {
  if (open) {
    setSelectedVoice(settings.ttsVoiceId);
  }
}, [open, settings.ttsVoiceId]);
```

**Purpose:** Syncs selected voice with settings when dialog opens.

**Logic:**
- When dialog opens, updates selected voice from settings
- Ensures dialog always shows current default voice

**Why useEffect:** Side effect that should happen when dialog opens, not during render.

---

### 11. `src/hooks/useETA.ts`

#### 11.1 ETA Calculation Reset (lines 70-95)
```typescript
useEffect(() => {
  // Reset state when inactive or invalid
  if (
    !isActive ||
    !startTimeRef?.current ||
    progressPercent <= 0 ||
    progressPercent >= 100
  ) {
    setETA(null);
    setRemainingTime(null);
    lastProgressRef.current = progressPercent;
    lastUpdateTimeRef.current = null;
    return;
  }

  // Calculate time delta
  const now = Date.now();
  const timeDelta = lastUpdateTimeRef.current
    ? now - lastUpdateTimeRef.current
    : null;

  // Update ETA if progress changed
  if (lastProgressRef.current !== progressPercent && timeDelta !== null && timeDelta > 0) {
    // Calculate ETA using exponential decay
    // ... calculation logic ...
  }

  // Update refs
  lastProgressRef.current = progressPercent;
  lastUpdateTimeRef.current = now;
}, [isActive, progressPercent, startTimeRef]);
```

**Purpose:** Calculates ETA (Estimated Time to Arrival) for conversions using exponential decay.

**Logic:**
- Resets ETA when inactive or progress is invalid
- Calculates time delta between updates
- Uses exponential decay to smooth ETA estimates
- Updates refs for next calculation

**Why useEffect:** Calculation should happen when progress changes, not during render. Uses refs to track previous values.

---

### 12. `src/hooks/usePrevious.ts`

#### 12.1 Previous Value Tracking (lines 9-11)
```typescript
useEffect(() => {
  ref.current = value;
}, [value]);
```

**Purpose:** Generic hook to track previous value of any variable.

**Logic:**
- Stores current value in ref
- Ref persists across renders without causing re-renders
- Returns previous value (from ref)

**Why useEffect:** Must update ref after render to capture "previous" value for next render.

---

### 13. `src/hooks/use-animated-number.ts`

#### 13.1 Ref Sync (lines 21-23)
```typescript
useEffect(() => {
  animatedValueRef.current = animatedValue;
}, [animatedValue]);
```

**Purpose:** Keeps ref in sync with animated value state.

**Logic:**
- Simple ref update whenever animated value changes
- Used by animation frame callback to access current value

**Why useEffect:** Ref must be updated after state changes, not during render.

---

#### 13.2 Number Animation (lines 25-65)
```typescript
useEffect(() => {
  // If the value hasn't changed, don't animate
  if (previousTargetRef.current === targetValue) {
    return;
  }

  previousTargetRef.current = targetValue;

  // Cancel any ongoing animation
  if (animationFrameRef.current !== null) {
    cancelAnimationFrame(animationFrameRef.current);
  }

  const startValue = animatedValueRef.current;
  const endValue = targetValue;
  const startTime = performance.now();

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    
    const currentValue = startValue + (endValue - startValue) * eased;
    animatedValueRef.current = currentValue;
    setAnimatedValue(currentValue);

    if (progress < 1) {
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      animationFrameRef.current = null;
    }
  };

  animationFrameRef.current = requestAnimationFrame(animate);

  return () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  };
}, [targetValue, duration]);
```

**Purpose:** Animates a number from current value to target value over time.

**Logic:**
- Skips animation if target hasn't changed
- Cancels any ongoing animation
- Uses `requestAnimationFrame` for smooth animation
- Applies easing function for natural motion
- Updates state each frame
- Cleans up animation on unmount or target change

**Why useEffect:** Animation requires `requestAnimationFrame` which is a side effect. Must clean up on unmount.

---

## Patterns and Philosophy

### ✅ When useEffect is Used

1. **Event Listeners**: Tauri events, DOM events, media queries
2. **Async Data Loading**: Hydrating from storage, fetching from backend
3. **DOM Manipulation**: Theme classes, scroll positions
4. **Animation Timing**: Delays, requestAnimationFrame
5. **Ref Synchronization**: Keeping refs in sync with state for callbacks
6. **Lifecycle Cleanup**: Cleaning up listeners, timers, animations

### ❌ When useEffect is Avoided

1. **Derived State**: Use `useMemo` or compute during render
2. **Event Handlers**: Use callbacks directly
3. **State Updates Based on Props**: Use render-time checks or callbacks
4. **Synchronous Operations**: Do during render

### Key Design Principles

1. **Explicit over Implicit**: Prefer callbacks that are called explicitly over effects that run automatically
2. **Render-time Checks**: Many components use render-time checks with refs instead of useEffect
3. **Callback-based Architecture**: Most hooks expose callbacks rather than running effects automatically
4. **Minimal Side Effects**: Only use useEffect when side effects are truly necessary

---

## Summary Statistics

- **Total useEffect calls**: ~20-25 across the codebase
- **Primary use cases**:
  - Event listener setup: 3
  - State hydration/persistence: 4
  - Animation management: 5
  - Ref synchronization: 3
  - Auto-selection/validation: 2
  - Theme/DOM manipulation: 2
  - Other side effects: 3-5

The codebase demonstrates a thoughtful approach to React hooks, minimizing useEffect in favor of more explicit, callback-based patterns while still using it appropriately for true side effects.
