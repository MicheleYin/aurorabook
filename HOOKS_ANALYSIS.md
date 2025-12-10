# Hooks Analysis: Merge Opportunities

## Executive Summary

After analyzing all hooks in the `/src/hooks` directory, I've identified several opportunities to merge hooks with overlapping concerns. This document outlines the findings and recommendations.

## High Priority Merges

### 1. **Persistence Hooks** ⭐⭐⭐
**Hooks to merge:**
- `usePersistentSettings` (`src/hooks/usePersistentSettings.ts`)
- `usePersistentReaderPreferences` (`src/hooks/usePersistentReaderPreferences.ts`)

**Rationale:**
- Both hooks have nearly identical implementations
- Both use the same Tauri store pattern
- Both handle hydration, persistence, and updates the same way
- Only difference is the store path, key, version, and default values

**Recommendation:**
Create a generic `usePersistentState<T>` hook that accepts:
- Store path
- Store key
- Version
- Default value
- Type parameter for the state shape

**Benefits:**
- Reduces code duplication (~200 lines → ~100 lines)
- Single source of truth for persistence logic
- Easier to maintain and test
- Can be reused for future persistent state needs

**Migration:**
```typescript
// Before
const { settings, updateSettings, isHydrated } = usePersistentSettings();
const { preferences, updatePreferences, isHydrated } = usePersistentReaderPreferences();

// After
const { settings, updateSettings, isHydrated } = usePersistentState<AppSettings>({
  storePath: "settings.store.json",
  storeKey: "settings",
  version: 1,
  defaultValue: DEFAULT_SETTINGS,
});

const { preferences, updatePreferences, isHydrated } = usePersistentState<ReaderPreferences>({
  storePath: "reader-preferences.store.json",
  storeKey: "readerPreferences",
  version: 1,
  defaultValue: DEFAULT_READER_PREFERENCES,
});
```

---

### 2. **Scroll Management Hooks** ⭐⭐
**Hooks to merge:**
- `useScrollOperations` (`src/hooks/reader/useScrollOperations.ts`)
- `useScrollTracking` (`src/hooks/reader/useScrollTracking.ts`)
- `useProgressRestoration` (`src/hooks/reader/useProgressRestoration.ts`)

**Rationale:**
- All three hooks deal with scroll-related functionality
- `useScrollOperations` provides scroll actions (top, bottom, element)
- `useScrollTracking` tracks scroll state (isScrolling)
- `useProgressRestoration` restores scroll position
- They're often used together in the same component (`ReaderWrapper`)

**Recommendation:**
Merge into a single `useScrollManagement` hook that provides:
- Scroll operations (scrollToTop, scrollToBottom, scrollToElement)
- Scroll state tracking (isScrolling)
- Progress restoration (restoreProgress, reset, markRestored, getState)

**Benefits:**
- Single hook for all scroll concerns
- Better cohesion - scroll operations and state are together
- Easier to use - one hook instead of three
- Can share common scroll metric calculations

**Note:** Keep restoration logic separate if it's too complex, but at minimum merge `useScrollOperations` and `useScrollTracking`.

---

### 3. **Resource Loading Hooks** ⭐⭐
**Hooks to merge:**
- `useChapterLoader` (`src/hooks/reader/useChapterLoader.ts`)
- `useAudioTrackLoader` (`src/hooks/reader/useAudioTrackLoader.ts`)

**Rationale:**
- Both hooks follow the same pattern:
  - Cache management (Map-based)
  - Loading with caching
  - Cache clearing
  - Similar API structure
- Both are used in the reader context
- Both load resources for the same domain (book content)

**Recommendation:**
Create a generic `useResourceLoader<T>` hook that handles:
- Generic caching pattern
- Loading with cache check
- Cache management (clear, get, isLoaded)

Then create thin wrappers:
- `useChapterLoader` → uses `useResourceLoader<Chapter>`
- `useAudioTrackLoader` → uses `useResourceLoader<AudioTrack>`

**Benefits:**
- Reduces duplication (~200 lines → ~150 lines)
- Consistent caching behavior
- Easier to add new resource types
- Single place to optimize cache logic

**Alternative:** If the loading logic is too different, keep separate but extract common cache utilities.

---

## Medium Priority Merges

### 4. **Progress Management Hooks** ⭐
**Hooks to consider:**
- `useChapterProgress` (`src/hooks/library/useChapterProgress.ts`)
- `useProgressSaving` (`src/hooks/useProgressSaving.ts`)

**Rationale:**
- `useChapterProgress` tracks scroll metrics and creates progress snapshots
- `useProgressSaving` saves progress before navigation
- They're related but serve different purposes

**Recommendation:**
**Keep separate** - they have distinct responsibilities:
- `useChapterProgress`: Tracks and emits progress snapshots
- `useProgressSaving`: Orchestrates saving before navigation

However, `useProgressSaving` is very thin (36 lines) and could be inlined into components that use it, or merged into `useChapterProgress` as an optional feature.

---

### 5. **Audio State Hooks** ⭐
**Hooks to consider:**
- `useAudioStateManagement` (`src/hooks/library/useAudioStateManagement.ts`)
- `useAudioStateSync` (`src/hooks/library/useAudioStateSync.ts`)

**Rationale:**
- `useAudioStateManagement`: Manages audio state updates with debouncing (backend sync)
- `useAudioStateSync`: Syncs audio state (track index, restoration time) for player

**Recommendation:**
**Keep separate** - they serve different purposes:
- `useAudioStateManagement`: Backend persistence layer
- `useAudioStateSync`: Player state management

However, the naming could be clearer:
- `useAudioStateManagement` → `useAudioStatePersistence` or `useAudioStateBackendSync`
- `useAudioStateSync` → `useAudioPlayerState` or `useAudioTrackState`

---

## Low Priority / Keep Separate

### 6. **Audio-Text Sync Hooks**
- `useAudioTextSync` - Handles audio-to-text synchronization and highlighting
- `useHighlighting` - Manages highlighting animations

**Recommendation:** Keep separate - `useHighlighting` is a pure UI animation hook, while `useAudioTextSync` handles business logic. However, `useAudioTextSync` could call `useHighlighting` internally instead of managing highlighting state itself.

---

### 7. **Chapter Management Hooks**
- `useChapterLoader` - Loads chapters
- `useChapterTransitions` - Manages transition animations
- `useChapterLoadedCallback` - Calls callback when chapter is loaded

**Recommendation:** Keep separate - they have distinct concerns (loading, animations, callbacks).

---

### 8. **Navigation Hooks**
- `useFragmentNavigation` - Handles fragment navigation
- `useLinkHandling` - Handles link clicks

**Recommendation:** Consider merging - both handle navigation within chapters. Could become `useChapterNavigation` with both fragment and link handling.

---

## Summary of Recommendations

### High Priority (Do First)
1. ✅ **Merge persistence hooks** → `usePersistentState<T>`
2. ✅ **Merge scroll hooks** → `useScrollManagement`

### Medium Priority (Consider)
3. ⚠️ **Merge resource loaders** → `useResourceLoader<T>` (or extract common utilities)
4. ⚠️ **Inline or merge** `useProgressSaving` into `useChapterProgress`

### Low Priority (Nice to Have)
5. 🔄 **Refactor** `useAudioTextSync` to use `useHighlighting` internally
6. 🔄 **Merge** `useFragmentNavigation` and `useLinkHandling` → `useChapterNavigation`

### Keep Separate
- `useBookConversion` - Complex, domain-specific
- `useAppNavigation` - App-level navigation
- `useLibrary` - Context wrapper
- `useChapterProgress` vs `useProgressManagement` - Different layers (UI vs backend)
- `useAudioStateManagement` vs `useAudioStateSync` - Different concerns (persistence vs player state)

---

## Implementation Priority

1. **Phase 1:** Merge persistence hooks (highest impact, lowest risk)
2. **Phase 2:** Merge scroll hooks (good cohesion, medium risk)
3. **Phase 3:** Consider resource loader abstraction (if patterns align)
4. **Phase 4:** Refactor audio-text sync to use highlighting hook

---

## Metrics

**Current State:**
- Total hooks: ~30
- Lines of code: ~3,500+
- Duplication: ~400 lines (persistence + scroll + loaders)

**After Merges:**
- Estimated reduction: ~300-400 lines
- Better cohesion: Related functionality grouped together
- Easier maintenance: Single source of truth for common patterns
