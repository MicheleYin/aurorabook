# Audio Hooks vs Chapter Hooks - Analysis

## Overview

Both `src/hooks/audio` and `src/hooks/chapter` follow similar architectural patterns but handle different domains:
- **Audio hooks**: Manage audio playback, track loading, and audio-text synchronization
- **Chapter hooks**: Manage chapter loading, progress tracking, and scroll state

## Directory Structure Comparison

### Audio Hooks (`src/hooks/audio/`)
1. `useAudioPlayerManager.ts` - Unified manager (255 lines)
2. `useAudioPlayerProgress.ts` - Progress coordination (185 lines)
3. `useAudioPlayerState.ts` - State management (287 lines)
4. `useAudioStatePersistence.ts` - Backend persistence (172 lines)
5. `useAudioTextSync.ts` - Audio-text synchronization (609 lines)
6. `useAudioTrackLoader.ts` - Track loading/caching (144 lines)

**Total: 6 files, ~1,652 lines**

### Chapter Hooks (`src/hooks/chapter/`)
1. `useChapterManager.ts` - Unified manager (200 lines)
2. `useChapterProgress.ts` - Progress tracking (356 lines)
3. `useChapterState.ts` - State management (430 lines)
4. `useChapterStatePersistence.ts` - Backend persistence (355 lines)
5. `useChapterLoader.ts` - Chapter loading/caching (135 lines)
6. `useChapterLoadedCallback.ts` - Loaded callback (135 lines)
7. `useChapterTransitions.ts` - Transition animations (60 lines)

**Total: 7 files, ~1,671 lines**

## Key Differences

### 1. **Manager Hooks**

#### `useAudioPlayerManager` vs `useChapterManager`

**Similarities:**
- Both consolidate multiple concerns into a single hook
- Both use coordinator for operations
- Both provide cached resources (tracks/chapters)
- Both handle progress updates

**Differences:**

| Feature | Audio Manager | Chapter Manager |
|---------|--------------|-----------------|
| **State Management** | Uses `useAudioPlayerState` | Uses `useChapterState` |
| **Resource Loading** | Uses `useAudioTrackLoader` | Uses `useChapterLoader` |
| **Synchronization** | Includes `useAudioTextSync` for highlighting | No equivalent (handled separately) |
| **Track Changes** | Handles track changes with chapter navigation | Handles chapter changes only |
| **Progress Type** | `AudioProgressSnapshot` (time-based) | `ChapterProgressSnapshot` (scroll-based) |

**Audio Manager Specific Features:**
- `changeAudioTrack()` - Changes audio track and optionally navigates to matching chapter
- `handleAudioProgress()` - Updates text highlighting based on audio time
- `saveAudioTimestamp()` / `restoreAudioTimestamp()` - Audio-specific persistence
- `highlightedElementId` - Current highlighted text element

**Chapter Manager Specific Features:**
- `changeChapter()` - Changes chapter with scroll position options
- `handleChapterProgress()` - Handles scroll-based progress
- `saveChapterProgress()` / `restoreChapterProgress()` - Chapter-specific persistence
- No highlighting (handled by audio sync)

### 2. **Progress Hooks**

#### `useAudioPlayerProgress` vs `useChapterProgress`

**Similarities:**
- Both coordinate progress updates
- Both handle resource changes (track/chapter)
- Both save progress before changes
- Both use coordinator for operations

**Differences:**

| Aspect | Audio Progress | Chapter Progress |
|--------|---------------|------------------|
| **Progress Type** | Time-based (seconds) | Scroll-based (pixels, percent) |
| **Synchronization** | Integrates `useAudioTextSync` | No text sync |
| **Chapter Navigation** | Can trigger chapter changes when track changes | Handles chapter changes directly |
| **Virtualization** | No virtualization support | Supports virtualized content with segment indices |
| **Scroll Operations** | No scroll operations | `scrollToTop()`, `scrollToBottom()`, `scrollToElementId()` |
| **Metrics** | No metrics calculation | `getCurrentScrollMetrics()`, `getCurrentProgressSnapshot()` |

**Audio Progress Specific:**
- `handleAudioProgress()` - Updates highlighting based on audio time
- `handleAudioTrackChange()` - Changes track and optionally navigates chapter
- `highlightedElementId` - Current highlighted element

**Chapter Progress Specific:**
- `getCurrentScrollMetrics()` - Calculates scroll position (supports virtualization)
- `getCurrentProgressSnapshot()` - Creates progress snapshot
- `scrollToTop()` / `scrollToBottom()` / `scrollToElementId()` - Scroll operations
- `isScrolling` state - Tracks scroll state
- `handleScroll()` / `handleScrollEnd()` - Scroll event handlers

### 3. **State Hooks**

#### `useAudioPlayerState` vs `useChapterState`

**Similarities:**
- Both manage index (track/chapter index)
- Both handle restoration from library state
- Both detect progress echoes to avoid loops
- Both use explicit initialization (no useEffects)
- Both check coordinator for cancelled operations

**Differences:**

| Aspect | Audio State | Chapter State |
|--------|------------|---------------|
| **Restoration Type** | Time (seconds) | Scroll position + element index |
| **State Properties** | `restoreTime`, `currentIndex` | `restoreScrollTop`, `restoreElementIndex`, `currentIndex` |
| **Progress Echo** | Time-based tolerance (0.5s) | Percent-based tolerance (1%) |
| **Initialization** | Explicit check in render | Uses `useEffect` for initialization |
| **Library Source** | `book.audioState` | `book.progress` |
| **Restoration Callback** | `onTrackLoaded(audioElement)` | `onChapterLoaded(contentElement, scrollToElement)` |

**Audio State Specific:**
- Restores audio playback time
- Tracks current track index
- `emitProgress()` - Emits time-based progress
- `onTrackLoaded()` - Applies restoration when audio element loads

**Chapter State Specific:**
- Restores scroll position and element index
- Tracks current chapter index
- `emitProgress()` - Emits scroll-based progress
- `onChapterLoaded()` - Applies restoration when chapter content loads
- Supports element index restoration (for virtualized content)

### 4. **Persistence Hooks**

#### `useAudioStatePersistence` vs `useChapterStatePersistence`

**Similarities:**
- Both debounce backend updates (150ms vs 200ms)
- Both update local state immediately
- Both use coordinator for saves
- Both flush pending updates on navigation/close

**Differences:**

| Aspect | Audio Persistence | Chapter Persistence |
|--------|------------------|---------------------|
| **Debounce Time** | 150ms | 200ms |
| **Data Type** | `audioState` (time, track info) | `progress` (scroll, percent, element) |
| **Progress Calculation** | Simple time tracking | Complex percent calculation (chapter + book progress) |
| **Last Chapter Handling** | No special handling | Sets to 100% when last chapter near completion |
| **Update Method** | `updateBookAudioState()` | `updateBookProgress()` + `handleChapterProgress()` |
| **Backend Service** | `updateBookAudioState()` | `updateBookProgress()` |

**Audio Persistence Specific:**
- Updates `book.audioState` with:
  - `currentTrackId`, `currentTrackHref`, `currentTrackIndex`
  - `currentTimeSeconds`
  - `updatedAt`

**Chapter Persistence Specific:**
- Updates `book.progress` with:
  - `currentChapterId`, `currentChapterHref`, `currentChapterIndex`
  - `currentChapterScrollTop`, `currentChapterElementIndex`
  - `chapterProgressPercent`, `bookProgressPercent`
  - `updatedAt`
- Calculates overall book progress from chapter progress
- Handles last chapter completion (95% → 100%)

### 5. **Loader Hooks**

#### `useAudioTrackLoader` vs `useChapterLoader`

**Similarities:**
- Both use `useResourceLoader` internally
- Both cache loaded resources
- Both check coordinator for cancelled operations
- Both track cache version for updates
- Both provide `loadedTracks`/`loadedChapters` Map

**Differences:**

| Aspect | Audio Track Loader | Chapter Loader |
|--------|-------------------|----------------|
| **Resource Type** | `AudioTrack` | `Chapter` |
| **Load Check** | `!!track.url` | `!!chapter.contentHtml` |
| **Load Function** | `loadEpubAudioBlob()` | `ensureChapterLoaded()` |
| **Blob URLs** | Manages Blob URL cleanup | No blob URLs |
| **Backward Compatibility** | No legacy state | `loadedChapter` / `setLoadedChapter` for compatibility |
| **Loading State** | No `isLoading` exposed | Exposes `isLoading` |

**Audio Track Loader Specific:**
- Creates Blob URLs for audio files
- Cleans up Blob URLs on unmount
- Uses coordinator's `loadAudioTrack()` as primary method
- Falls back to direct loading if coordinator unavailable

**Chapter Loader Specific:**
- Loads chapter HTML content
- Uses coordinator's `changeChapter()` for coordination
- Maintains backward compatibility with `loadedChapter` state
- Exposes `isLoading` state

### 6. **Unique Hooks**

#### Audio Hooks Only

**`useAudioTextSync`** (609 lines - largest hook)
- **Purpose**: Synchronizes audio playback with text highlighting
- **Features**:
  - Updates text highlighting based on audio time
  - Handles chapter navigation when audio moves to different chapter
  - Calculates header/player offsets dynamically
  - Caches DOM queries for performance
  - Throttles scrolling and chapter changes
  - Detects track/chapter changes to prevent interference
  - Supports element index for fast lookups
- **Complexity**: Most complex hook due to DOM manipulation and synchronization logic

#### Chapter Hooks Only

**`useChapterLoadedCallback`** (135 lines)
- **Purpose**: Calls callback when chapter content is in DOM
- **Features**:
  - Waits for chapter content element to appear
  - Checks coordinator for cancelled operations
  - Uses requestAnimationFrame + polling
  - Max 20 attempts (1 second timeout)
- **Use Case**: Ensures chapter is fully loaded before operations

**`useChapterTransitions`** (60 lines)
- **Purpose**: Manages chapter transition animations
- **Features**:
  - Determines transition direction (left/right/fade)
  - Based on chapter index comparison
  - 300ms animation duration
- **Use Case**: Visual feedback during chapter changes

## Architectural Patterns

### Common Patterns

1. **Manager Pattern**
   - Both have unified manager hooks that consolidate multiple concerns
   - Managers coordinate between state, loading, and persistence hooks

2. **State Management Pattern**
   - Both use state hooks that read from library
   - Both handle restoration and echo detection
   - Both use refs to avoid stale closures

3. **Persistence Pattern**
   - Both debounce backend updates
   - Both update local state immediately
   - Both use coordinator for saves

4. **Loader Pattern**
   - Both use generic `useResourceLoader`
   - Both cache resources in Maps
   - Both check coordinator for cancellation

### Audio-Specific Patterns

1. **Synchronization Pattern**
   - `useAudioTextSync` bridges audio and text domains
   - Handles complex DOM queries and scrolling
   - Manages race conditions between track/chapter changes

2. **Time-Based Progress**
   - Progress is measured in seconds
   - Restoration restores playback time
   - Simpler than scroll-based progress

### Chapter-Specific Patterns

1. **Scroll-Based Progress**
   - Progress measured in pixels, percent, and element indices
   - Supports virtualized content with segment indices
   - More complex calculation (chapter + book progress)

2. **Transition Management**
   - Visual feedback for chapter changes
   - Direction-based animations

3. **Loaded Callback**
   - Ensures DOM readiness before operations
   - Prevents race conditions

## Integration Points

### How They Work Together

1. **Audio triggers chapter changes**
   - `useAudioPlayerProgress.handleAudioTrackChange()` can trigger `onTrackChangeChapterChange()`
   - `useAudioTextSync.updateHighlight()` can trigger `onChapterChange()` when audio moves to different chapter

2. **Chapter changes affect audio**
   - Chapter changes may require loading new audio tracks
   - Progress saving coordinates between both systems

3. **Coordinator coordination**
   - Both use `ReaderCoordinator` for operation management
   - Prevents race conditions and cancelled operations

## Code Complexity Comparison

| Metric | Audio Hooks | Chapter Hooks |
|--------|-------------|---------------|
| **Total Files** | 6 | 7 |
| **Total Lines** | ~1,652 | ~1,671 |
| **Largest File** | `useAudioTextSync.ts` (609 lines) | `useChapterState.ts` (430 lines) |
| **Most Complex** | `useAudioTextSync` (DOM + sync logic) | `useChapterState` (restoration logic) |
| **Average File Size** | ~275 lines | ~239 lines |

## Recommendations

### Similarities to Leverage
1. Both follow same architectural patterns - could extract common abstractions
2. Both use coordinator - good for consistency
3. Both have manager hooks - good consolidation pattern

### Differences to Understand
1. Audio has text sync complexity - understand before modifying
2. Chapter has virtualization support - important for performance
3. Progress types are fundamentally different - time vs scroll

### Potential Improvements
1. Extract common manager pattern into base hook
2. Unify persistence patterns (both debounce, both use coordinator)
3. Consider shared progress snapshot type (if possible)
4. Extract common loader patterns
