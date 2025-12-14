# Memory Optimization Proposal for Reader

## Current Memory Issues

### 1. **Full Chapter HTML in DOM**
- **Problem**: Entire chapter HTML (potentially 100K+ spans) is rendered via `dangerouslySetInnerHTML`
- **Impact**: High memory usage, slow DOM operations, expensive re-renders
- **Location**: `ReaderViewport.tsx:404` - `dangerouslySetInnerHTML={{ __html: activeChapter.contentHtml }}`

### 2. **Frequent DOM Queries**
- **Problem**: `querySelector` called repeatedly for element lookups
- **Impact**: Expensive DOM traversal, especially with large chapters
- **Locations**:
  - `useAudioTextSync.ts:425` - `querySelector` for segment elements
  - `useHighlighting.ts:156` - `querySelector` for highlighting
  - `scroll-utils.ts:329` - `querySelector` for scrolling

### 3. **No Virtualization**
- **Problem**: All content rendered even if only 10% is visible
- **Impact**: Unnecessary DOM nodes, memory waste

### 4. **Inefficient Element Caching**
- **Problem**: DOM elements cached in refs, but queries still happen frequently
- **Impact**: Memory leaks, stale references

## Proposed Solutions

### Solution 1: Virtual Scrolling / Windowing (Recommended)
**Only render visible content + buffer**

```typescript
// Use react-window or react-virtualized
import { FixedSizeList } from 'react-window';

// Or custom implementation:
// - Track scroll position
// - Calculate visible range
// - Only render spans in visible range + buffer
// - Use placeholder divs for non-visible content
```

**Benefits**:
- Reduces DOM nodes by 80-90%
- Faster rendering
- Lower memory usage

**Implementation**:
1. Parse chapter HTML into segments
2. Track scroll position
3. Calculate visible range (viewport + buffer)
4. Only render segments in range
5. Use fixed-height placeholders for non-visible content

### Solution 2: Lazy Span Rendering
**Only render spans near current audio position**

```typescript
// Track current audio segment
// Only render spans within ±N segments of current position
// Unrender spans that are far away
```

**Benefits**:
- Reduces active DOM nodes
- Keeps audio sync working
- Lower memory footprint

### Solution 3: Element ID Index Map
**Pre-build a Map of element IDs to positions**

```typescript
// Build index when chapter loads
const elementIndex = new Map<string, {
  position: number, // Character position in HTML
  approximateScrollTop: number, // Estimated scroll position
  segmentIndex: number // Index in segments array
}>();

// Fast lookup without DOM query
const getElementPosition = (elementId: string) => {
  return elementIndex.get(elementId);
};
```

**Benefits**:
- O(1) lookup instead of O(n) DOM query
- No DOM traversal needed
- Can estimate scroll position without rendering

### Solution 4: Use Intersection Observer
**Replace querySelector with Intersection Observer**

```typescript
// Instead of querySelector, use Intersection Observer
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // Element is visible
    }
  });
}, {
  root: contentRef.current,
  rootMargin: '200px', // Buffer zone
  threshold: 0.1
});

// Observe elements as they're rendered
```

**Benefits**:
- Browser-optimized visibility detection
- No manual DOM queries
- Better performance

### Solution 5: Use getElementById (Quick Win)
**Replace querySelector with getElementById**

```typescript
// Current (slow):
const element = contentRef.current.querySelector(`#${elementId}`);

// Optimized (fast):
const element = document.getElementById(elementId);
// Then check if it's in our container
if (element && contentRef.current.contains(element)) {
  // Use element
}
```

**Benefits**:
- `getElementById` uses browser's ID map (O(1))
- `querySelector` does full traversal (O(n))
- Simple change, immediate improvement

### Solution 6: CSS Containment
**Limit layout calculations**

```css
.reader-chapter-content {
  contain: layout style paint;
  content-visibility: auto;
}
```

**Benefits**:
- Browser skips layout for off-screen content
- Reduces repaints/reflows
- Lower CPU usage

### Solution 7: WeakMap for Element Caching
**Better memory management**

```typescript
// Instead of refs storing elements
const elementCache = new WeakMap<HTMLElement, {
  id: string,
  position: number,
  lastAccess: number
}>();

// Elements are automatically garbage collected when removed from DOM
```

**Benefits**:
- Automatic cleanup
- No memory leaks
- Better for dynamic content

## Recommended Implementation Plan

### Phase 1: Quick Wins (Low effort, high impact)
1. ✅ Replace `querySelector` with `getElementById` where possible
2. ✅ Add CSS containment to chapter content
3. ✅ Build element ID index map on chapter load
4. ✅ Use WeakMap for element caching

### Phase 2: Medium-term (Moderate effort)
1. Implement lazy span rendering (only render ±50 segments around current audio)
2. Use Intersection Observer for visibility detection
3. Optimize highlighting to only update visible elements

### Phase 3: Long-term (High effort, highest impact)
1. Implement virtual scrolling/windowing
2. Lazy load chapter content in chunks
3. Consider using a virtual DOM library

## Code Changes Needed

### Priority 1: getElementById optimization
- `useAudioTextSync.ts:425` - Replace querySelector
- `useHighlighting.ts:156` - Replace querySelector  
- `scroll-utils.ts:329` - Replace querySelector

### Priority 2: Element Index Map
- Build index when chapter loads
- Store in ref or context
- Use for fast lookups

### Priority 3: CSS Containment
- Add to `ReaderViewport.tsx` chapter content div

### Priority 4: Virtual Scrolling
- Refactor `ReaderViewport` to use windowing
- Parse chapter into segments
- Track scroll position



