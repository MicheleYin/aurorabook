# Audio Memory Debug Guide

## Quick Start: Tools You Can Use Right Now

Your app already has debugging tools built-in! In development mode, open the WebKit Inspector console and use:

```javascript
// Get comprehensive memory stats
debugMemory.logAll()

// Get current JavaScript heap memory (may be null in WebKit/Safari)
debugMemory.getMemory()

// Get DOM node statistics (ALWAYS WORKS)
debugMemory.getDOMStats()

// Get blob URL statistics (CRITICAL for audio - ALWAYS WORKS)
debugMemory.getBlobStats()

// Get audio element info (ALWAYS WORKS)
debugMemory.getAudioInfo()

// Audio-specific diagnostic (RECOMMENDED)
debugMemory.diagnoseAudio()

// Force garbage collection (if available)
debugMemory.forceGC()
```

### ⚠️ Important Note About Memory API

**The JavaScript heap memory API (`performance.memory`) is NOT available in WebKit/Safari** (which Tauri uses on macOS). This is a Chrome-specific API.

**What still works:**
- ✅ Blob URL tracking (most important for audio memory issues)
- ✅ DOM node counting
- ✅ Audio element state
- ✅ All other debug tools

**For actual memory profiling, use:**
- WebKit Inspector (Safari → Develop → Show Web Inspector) - Heap snapshots
- Activity Monitor - Overall app memory
- macOS Instruments - Deep profiling

The `debugMemory.diagnoseAudio()` function will guide you to the right tools if the memory API isn't available.

## What's Likely Causing High Memory During Audio Playback

### 1. **Blob URLs Holding Audio Data** 🔴 HIGHEST IMPACT
- **Issue**: Each audio track is loaded as a Blob URL, which holds the **entire audio file in memory**
- **Size**: ~1-50MB per track depending on file size
- **Location**: 
  - `src/lib/lazy-chapter-loader.ts` - `audioTrackCache` (LRU, max 1 track)
  - `src/hooks/audio/useAudioTrackLoader.ts` - Resource loader cache (no size limit per book)
  - `src/lib/blob-url-manager.ts` - Centralized tracking

**Check with**:
```javascript
debugMemory.getBlobStats()
// Look for: { total: X, byBook: {...} }
// If total > 1-2, you have multiple tracks in memory
```

### 2. **HTML5 Audio Element Buffering** 🟡 MEDIUM IMPACT
- **Issue**: The browser buffers audio data for smooth playback
- **Size**: Typically 10-30 seconds of audio ahead of current position
- **Location**: `src/components/reader/ReaderAudioPlayer.tsx`

**What happens**:
- When you play audio, the browser decodes and buffers the audio
- This uses additional memory beyond the blob URL
- Memory is released when audio stops, but may persist briefly

### 3. **Multiple Cache Layers** 🟡 MEDIUM IMPACT
- **Issue**: Audio tracks are cached in multiple places simultaneously
- **Locations**:
  1. `audioTrackCache` in `lazy-chapter-loader.ts` (LRU, max 1)
  2. `useResourceLoader` cache in `useAudioTrackLoader.ts` (unbounded per book)
  3. Blob URLs tracked in `blobURLManager`

**Check**: Look for duplicate entries across caches

### 4. **DOM Nodes** 🟢 LOWER IMPACT
- **Issue**: Virtualization helps, but DOM nodes still consume memory
- **Check with**:
```javascript
debugMemory.getDOMStats()
// Watch for: total nodes growing during audio playback
```

## Step-by-Step Debugging Process

### Step 1: Baseline Measurement
Before playing audio:
```javascript
// Take baseline snapshot
const baseline = {
  memory: debugMemory.getMemory(),
  blob: debugMemory.getBlobStats(),
  dom: debugMemory.getDOMStats()
}
console.log('Baseline:', baseline)
```

### Step 2: Start Audio Playback
Play audio and immediately check:
```javascript
// Check memory spike
const duringPlayback = {
  memory: debugMemory.getMemory(),
  blob: debugMemory.getBlobStats(),
  dom: debugMemory.getDOMStats()
}
console.log('During Playback:', duringPlayback)

// Calculate growth
const memoryGrowth = duringPlayback.memory.usedJSHeapSize - baseline.memory.usedJSHeapSize
console.log('Memory Growth:', (memoryGrowth / 1024 / 1024).toFixed(2), 'MB')
```

### Step 3: Monitor Over Time
Set up continuous monitoring:
```javascript
// Monitor every 5 seconds while playing
const monitor = setInterval(() => {
  const stats = {
    memory: debugMemory.getMemory(),
    blob: debugMemory.getBlobStats(),
    time: new Date().toISOString()
  }
  console.log('Memory Check:', stats)
}, 5000)

// Stop monitoring after 1 minute
setTimeout(() => clearInterval(monitor), 60000)
```

### Step 4: Stop Audio and Check Cleanup
After stopping audio:
```javascript
// Wait a few seconds for cleanup
setTimeout(() => {
  const afterStop = {
    memory: debugMemory.getMemory(),
    blob: debugMemory.getBlobStats(),
    dom: debugMemory.getDOMStats()
  }
  console.log('After Stop:', afterStop)
  
  // Check if memory was released
  const memoryReleased = afterStop.memory.usedJSHeapSize < duringPlayback.memory.usedJSHeapSize
  console.log('Memory Released?', memoryReleased)
}, 5000)
```

## What to Look For

### 🚨 Red Flags (Memory Leaks)

1. **Blob URLs Not Being Revoked**
   ```javascript
   debugMemory.getBlobStats()
   // If total keeps growing after stopping audio = LEAK
   ```

2. **Memory Not Released After Stopping**
   ```javascript
   // Memory should drop after stopping audio
   // If it stays high = audio data not being released
   ```

3. **Multiple Tracks in Memory**
   ```javascript
   debugMemory.getBlobStats()
   // If byBook shows multiple tracks when only one should be playing = CACHE ISSUE
   ```

### ⚠️ Yellow Flags (High Usage, Not Leaks)

1. **Large Blob URLs**
   - If a single track is 50MB+, that's expected
   - But if multiple tracks are loaded = optimization needed

2. **DOM Nodes Growing**
   - Should be stable with virtualization
   - If growing during playback = DOM leak

3. **Memory Spikes During Playback**
   - Some spike is normal (buffering)
   - But if it keeps growing = leak

## Advanced Tools

### WebKit Inspector (Safari)

1. **Enable WebKit Inspector**:
   - Safari → Preferences → Advanced → "Show Develop menu"
   - Develop → [Your App] → Show Web Inspector

2. **Memory Timeline**:
   - Timelines tab → Check "Memory"
   - Record while playing audio
   - Watch for growing heap

3. **Heap Snapshots**:
   - Profiles tab → "Take Heap Snapshot"
   - Take before/during/after audio playback
   - Compare to find what's growing

### macOS Activity Monitor

```bash
# Open Activity Monitor
open -a "Activity Monitor"

# Or from terminal
ps aux | grep -i "tts-tauri" | grep -v grep
```

Watch the "Memory" column for your app process.

### macOS Instruments (Deep Profiling)

```bash
# Open Instruments
open -a Instruments

# Use "Allocations" instrument
# - Shows all memory allocations
# - Can identify leaks
# - Shows call stacks
```

## Quick Diagnostic Script

Run this in the WebKit Inspector console while audio is playing:

```javascript
// Complete diagnostic
async function diagnoseAudioMemory() {
  console.group('🔍 Audio Memory Diagnostic');
  
  // 1. Current state
  const memory = debugMemory.getMemory();
  const blob = debugMemory.getBlobStats();
  const dom = debugMemory.getDOMStats();
  
  console.log('📊 Current State:');
  console.log('  Memory:', {
    used: (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
    total: (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB',
    limit: (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB',
    percent: ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2) + '%'
  });
  
  console.log('  Blob URLs:', blob);
  console.log('  DOM Nodes:', {
    total: dom.total,
    elements: dom.elements
  });
  
  // 2. Check for issues
  console.log('\n⚠️  Potential Issues:');
  
  if (blob.total > 2) {
    console.warn('  ⚠️  Multiple blob URLs detected:', blob.total);
    console.warn('     Expected: 1-2 (current + maybe previous)');
  }
  
  if (memory.usedJSHeapSize / memory.jsHeapSizeLimit > 0.8) {
    console.warn('  ⚠️  Memory usage > 80%');
  }
  
  if (dom.total > 10000) {
    console.warn('  ⚠️  High DOM node count:', dom.total);
  }
  
  // 3. Recommendations
  console.log('\n💡 Recommendations:');
  if (blob.total > 2) {
    console.log('  - Check if old blob URLs are being revoked');
    console.log('  - Verify blobURLManager.revokeForBook() is called on book switch');
  }
  
  if (memory.usedJSHeapSize / memory.jsHeapSizeLimit > 0.7) {
    console.log('  - Consider reducing cache sizes');
    console.log('  - Check for memory leaks with heap snapshots');
  }
  
  console.groupEnd();
}

// Run it
diagnoseAudioMemory();
```

## Expected Behavior

### Normal Memory Usage:
- **Before audio**: ~50-200MB (depending on book/chapters loaded)
- **During audio playback**: +10-50MB (blob URL + buffering)
- **After stopping**: Should return close to baseline (blob may persist briefly)

### Abnormal (Leak):
- **During playback**: Memory keeps growing continuously
- **After stopping**: Memory doesn't drop significantly
- **Blob URLs**: Multiple tracks remain in memory
- **DOM nodes**: Keep growing during playback

## Next Steps

1. **Run the diagnostic script** above while audio is playing
2. **Check blob URL count** - should be 1-2 max
3. **Monitor memory over time** - should stabilize, not grow
4. **Take heap snapshots** in WebKit Inspector to see what objects are using memory
5. **Check Activity Monitor** for overall app memory usage

## Files to Check if Issues Found

- `src/lib/blob-url-manager.ts` - Blob URL cleanup
- `src/lib/lazy-chapter-loader.ts` - Audio track cache
- `src/hooks/audio/useAudioTrackLoader.ts` - Resource loader cache
- `src/components/reader/ReaderAudioPlayer.tsx` - Audio element management
