# Memory Optimization Implementation

## ✅ Completed Quick Wins

### 1. Replaced querySelector with getElementById
**Files Changed:**
- `src/hooks/reader/useAudioTextSync.ts` - Line 425
- `src/hooks/reader/useHighlighting.ts` - Line 156
- `src/lib/scroll-utils.ts` - Line 329

**Impact:**
- `getElementById` uses browser's ID map (O(1) lookup)
- `querySelector` does full DOM traversal (O(n))
- **Expected improvement: 10-100x faster for element lookups**

### 2. Added CSS Containment
**Files Changed:**
- `src/components/reader/ReaderViewport.tsx` - Added `contain: "layout style paint"` to article and content div

**Impact:**
- Browser skips layout calculations for off-screen content
- Reduces repaints/reflows
- **Expected improvement: 20-30% reduction in layout calculations**

### 3. Created Element Index Hook
**New File:**
- `src/hooks/reader/useElementIndex.ts`

**Purpose:**
- Pre-builds a Map of element IDs to positions
- Allows O(1) lookups without DOM queries
- Can estimate scroll positions for virtual scrolling

## 🔄 Next Steps (Recommended Priority)

### Phase 1: Element Index Integration (Medium effort)
1. Integrate `useElementIndex` into `ReaderWrapper` or `ReaderViewport`
2. Use index to check if element exists before DOM query
3. Use index for scroll position estimation

### Phase 2: Lazy Span Rendering (High effort, high impact)
**Only render spans near current audio position**

```typescript
// Track current audio segment index
// Only render spans within ±50 segments of current position
// Use placeholders for non-visible spans
```

**Benefits:**
- Reduces active DOM nodes by 80-90%
- Keeps audio sync working
- Lower memory footprint

### Phase 3: Virtual Scrolling (Very high effort, highest impact)
**Only render visible content + buffer**

```typescript
// Use react-window or custom implementation
// Track scroll position
// Calculate visible range
// Only render segments in range
```

**Benefits:**
- Reduces DOM nodes by 90-95%
- Much faster rendering
- Significantly lower memory usage

## Current Memory Issues

### 1. Full Chapter HTML in DOM
- **Problem**: Entire chapter HTML (potentially 100K+ spans) rendered via `dangerouslySetInnerHTML`
- **Location**: `ReaderViewport.tsx:404`
- **Solution**: Virtual scrolling or lazy span rendering

### 2. All Spans Always Rendered
- **Problem**: Every span (f000001, f000002, etc.) is in the DOM even if not visible
- **Solution**: Only render visible spans + buffer

### 3. Frequent DOM Queries (Partially Fixed)
- **Problem**: Still some querySelector calls for non-ID lookups
- **Solution**: Use element index or Intersection Observer

## Performance Metrics to Track

1. **DOM Node Count**: Should decrease by 80-90% with virtual scrolling
2. **Memory Usage**: Should decrease by 60-80% with optimizations
3. **Element Lookup Time**: Should decrease by 10-100x with getElementById
4. **Layout Calculations**: Should decrease by 20-30% with CSS containment

## Testing Recommendations

1. Test with large chapters (10K+ spans)
2. Monitor memory usage in DevTools
3. Measure element lookup performance
4. Test audio sync still works correctly
5. Test scrolling performance

