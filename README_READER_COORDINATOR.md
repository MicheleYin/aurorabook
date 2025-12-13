# Reader Coordinator Context

## Overview

The `ReaderCoordinatorContext` centralizes and coordinates all async operations for chapters and audio tracks. It provides locks, loading states, and cancellation for all operations to prevent race conditions and ensure proper sequencing.

## Features

- **Operation Locks**: Prevents conflicting operations from running simultaneously
- **Loading States**: Tracks loading state for each operation type
- **Cancellation**: Operations can be cancelled if superseded by newer operations
- **State Management**: All operations are tracked and can be queried

## Operation Types

### Chapter Operations
- `changeChapter`: Change to a different chapter
- `restoreChapter`: Restore chapter content
- `restoreChapterProgress`: Restore chapter scroll position (with optional auto-scroll)
- `saveChapter`: Save chapter state
- `saveChapterProgress`: Save chapter scroll progress

### Audio Track Operations
- `loadAudioTrack`: Load audio track URL
- `restoreAudioTimestamp`: Restore audio playback position
- `saveAudioTrack`: Save audio track state
- `saveAudioTimestamp`: Save audio playback position
- `changeAudioTrack`: Change to a different audio track (next/previous/random)

## Usage

### 1. Setup Provider

Wrap your reader components with the `ReaderCoordinatorProvider`:

```tsx
import { ReaderCoordinatorProvider } from "./contexts/ReaderCoordinatorContext";

function App() {
  return (
    <ReaderCoordinatorProvider
      onChapterChange={async (bookId, chapterId, options) => {
        // Your chapter change implementation
      }}
      onChapterRestore={async (bookId, chapterId) => {
        // Your chapter restore implementation
      }}
      onChapterProgressRestore={async (bookId, chapterId, withAutoScroll) => {
        // Your progress restore implementation
      }}
      onChapterSave={async (bookId, chapterId) => {
        // Your chapter save implementation
      }}
      onChapterProgressSave={async (bookId, chapterId, snapshot) => {
        // Your progress save implementation
      }}
      onAudioTrackLoad={async (bookId, trackId) => {
        // Your track load implementation - return track URL
        return trackUrl;
      }}
      onAudioTimestampRestore={async (bookId, trackId, timestamp) => {
        // Your timestamp restore implementation
      }}
      onAudioTrackSave={async (bookId, trackId) => {
        // Your track save implementation
      }}
      onAudioTimestampSave={async (bookId, trackId, timestamp) => {
        // Your timestamp save implementation
      }}
      onAudioTrackChange={async (bookId, trackId, direction) => {
        // Your track change implementation
      }}
    >
      <YourReaderComponents />
    </ReaderCoordinatorProvider>
  );
}
```

### 2. Use the Hook

In your components, use the `useReaderCoordinator` hook:

```tsx
import { useReaderCoordinator } from "./contexts/ReaderCoordinatorContext";

function MyComponent() {
  const coordinator = useReaderCoordinator();
  
  // Check if an operation is in progress
  const isChangingChapter = coordinator.isOperationInProgress("changeChapter");
  const isLoadingTrack = coordinator.isOperationInProgress("loadAudioTrack");
  
  // Get current operation details
  const currentOp = coordinator.getCurrentOperation("changeChapter");
  
  // Perform operations
  const handleChapterChange = async () => {
    await coordinator.changeChapter(bookId, chapterId, { scrollPosition: "top" });
  };
  
  const handleTrackChange = async () => {
    await coordinator.changeAudioTrack(bookId, trackId, "next");
  };
  
  // Cancel operations if needed
  if (currentOp) {
    coordinator.cancelOperation(currentOp.id);
  }
  
  // Access loading states
  const { chapterLoading, trackChanging, audioLoading } = coordinator.loading;
  
  return (
    <div>
      {chapterLoading && <Spinner />}
      {trackChanging && <TrackChangeIndicator />}
    </div>
  );
}
```

### 3. Integration Hook

For easier integration with existing code, use the `useReaderCoordinatorIntegration` hook:

```tsx
import { useReaderCoordinatorIntegration } from "./hooks/reader/useReaderCoordinator";

function ReaderWrapper() {
  const coordinator = useReaderCoordinatorIntegration({
    onChapterChangeImpl: async (bookId, chapterId, options) => {
      // Your existing chapter change logic
    },
    onChapterRestoreImpl: async (bookId, chapterId) => {
      // Your existing restore logic
    },
    // ... other implementations
  });
  
  // Use coordinator methods
  await coordinator.changeChapter(bookId, chapterId);
  
  // Access state
  const isLoading = coordinator.loading.chapterLoading;
}
```

## Operation Coordination

### Automatic Cancellation

When a new operation of the same type starts, the previous operation is automatically cancelled:

- `changeChapter` cancels any existing `changeChapter` or `restoreChapter`
- `changeAudioTrack` cancels any existing `changeAudioTrack` or `restoreAudioTimestamp`
- `saveChapterProgress` cancels any existing `saveChapterProgress`

### Parallel Operations

Some operations can run in parallel:
- Multiple `loadAudioTrack` operations (different tracks)
- `saveChapter` and `saveChapterProgress` (different save types)
- `saveAudioTimestamp` operations (batched)

### Operation Locks

Three lock categories:
- **chapter**: Chapter content operations
- **audio**: Audio track operations
- **progress**: Progress save/restore operations

## Cancellation Behavior

Operations check for cancellation at multiple points:
1. Before execution starts
2. After async operations complete
3. During execution (if operation checks `operation.cancelled`)

When cancelled, operations:
- Stop executing new work
- Don't throw errors (unless already in error state)
- Clean up resources
- Clear loading states

## Best Practices

1. **Always check loading state** before starting operations:
   ```tsx
   if (coordinator.loading.chapterLoading) {
     return; // Operation already in progress
   }
   ```

2. **Use operation IDs** to track specific operations:
   ```tsx
   const currentOp = coordinator.getCurrentOperation("changeChapter");
   if (currentOp && currentOp.chapterId === targetChapterId) {
     // This is the operation we want
   }
   ```

3. **Handle cancellation** in your implementations:
   ```tsx
   onChapterChange: async (bookId, chapterId, options) => {
     // Check cancellation periodically
     const operation = coordinator.getCurrentOperation("changeChapter");
     if (operation?.cancelled) {
       return; // Stop execution
     }
     
     // Your implementation
   }
   ```

4. **Clean up on unmount**:
   ```tsx
   useEffect(() => {
     return () => {
       coordinator.cancelAllOperations();
     };
   }, [coordinator]);
   ```

## State Structure

```typescript
type OperationLocks = {
  chapter: OperationState | null;
  audio: OperationState | null;
  progress: OperationState | null;
};

type OperationState = {
  type: OperationType;
  id: string;
  bookId?: string;
  chapterId?: string;
  trackId?: string;
  timestamp: number;
  cancelled: boolean;
};

type LoadingStates = {
  chapterLoading: boolean;
  chapterRestoring: boolean;
  chapterSaving: boolean;
  audioLoading: boolean;
  audioRestoring: boolean;
  audioSaving: boolean;
  trackChanging: boolean;
};
```

## Migration Guide

### From Direct Operations

**Before:**
```tsx
const handleChapterChange = async () => {
  await loadChapter(bookId, chapterId);
  await restoreProgress(bookId, chapterId);
};
```

**After:**
```tsx
const coordinator = useReaderCoordinator();

const handleChapterChange = async () => {
  await coordinator.changeChapter(bookId, chapterId);
  // Progress restore is handled separately if needed
  await coordinator.restoreChapterProgress(bookId, chapterId);
};
```

### From Multiple Flags

**Before:**
```tsx
const [isLoadingChapter, setIsLoadingChapter] = useState(false);
const [isChangingTrack, setIsChangingTrack] = useState(false);
// ... many more flags
```

**After:**
```tsx
const coordinator = useReaderCoordinator();
const { chapterLoading, trackChanging } = coordinator.loading;
```

## Troubleshooting

### Operations Not Cancelling

- Ensure you're using the coordinator methods, not direct implementations
- Check that operation handlers check `operation.cancelled` during execution
- Verify that new operations properly cancel previous ones

### Loading States Not Updating

- Loading states are managed by the coordinator
- Don't manually set loading states in your implementations
- Use `coordinator.loading` to access current states

### Race Conditions

- All operations go through the coordinator
- Use `isOperationInProgress` to check before starting new operations
- Operations automatically cancel conflicting ones

