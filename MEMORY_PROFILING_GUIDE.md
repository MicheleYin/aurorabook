# Memory Profiling Guide for Tauri/WebKit on macOS

## Overview

Since Tauri uses WebKit on macOS (not Chromium), Chrome DevTools isn't available. This guide covers alternative methods to profile memory usage and identify leaks.

## 1. WebKit Inspector (Safari Web Inspector)

### Enable WebKit Inspector

1. **Enable Developer Menu in Tauri:**
   ```rust
   // In src-tauri/src/main.rs or lib.rs
   tauri::Builder::default()
       .setup(|app| {
           #[cfg(debug_assertions)]
           {
               app.handle().devtools();
           }
           Ok(())
       })
   ```

2. **Or enable in production (for testing):**
   ```rust
   .setup(|app| {
       app.handle().devtools(); // Always enable for profiling
       Ok(())
   })
   ```

3. **Open Safari:**
   - Safari → Preferences → Advanced → Check "Show Develop menu in menu bar"
   - Develop → [Your App Name] → Show Web Inspector

### Using WebKit Inspector

1. **Memory Timeline:**
   - Open Web Inspector
   - Go to "Timelines" tab
   - Select "Memory" checkbox
   - Record while using the app
   - Look for:
     - Growing heap size
     - Increasing DOM node count
     - Growing JavaScript object count

2. **Heap Snapshots:**
   - Go to "Profiles" tab
   - Select "Take Heap Snapshot"
   - Take snapshots at different times:
     - After app load
     - After loading a book
     - After switching chapters
     - After 10 minutes of use
   - Compare snapshots to find growing objects

3. **Allocation Timeline:**
   - Go to "Profiles" tab
   - Select "Record Allocation Timeline"
   - Use the app normally
   - Stop recording
   - Look for objects that aren't being garbage collected

## 2. macOS System Tools

### Activity Monitor

1. **Open Activity Monitor:**
   - Applications → Utilities → Activity Monitor
   - Or: `open -a "Activity Monitor"`

2. **Monitor Memory:**
   - Find your Tauri app process
   - Watch "Memory" column
   - Look for:
     - Steady growth over time (memory leak)
     - High memory usage after operations
     - Memory not being released

3. **Memory Pressure:**
   - Check "Memory Pressure" graph at bottom
   - Green = OK, Yellow = Warning, Red = Critical

### Instruments (Xcode Tools)

1. **Install Xcode Command Line Tools:**
   ```bash
   xcode-select --install
   ```

2. **Open Instruments:**
   ```bash
   open -a Instruments
   ```

3. **Useful Instruments for Memory:**
   - **Allocations:** Track all memory allocations
     - Shows object counts, sizes, and call stacks
     - Can identify memory leaks
   - **Leaks:** Automatically detect memory leaks
   - **VM Tracker:** Track virtual memory usage
   - **Time Profiler:** CPU and memory usage over time

4. **Profile Your App:**
   - Select instrument (e.g., "Allocations")
   - Choose your Tauri app as target
   - Click Record
   - Use the app
   - Stop recording
   - Analyze results

### Command Line Tools

```bash
# Monitor memory usage of your app
# Replace "YourApp" with your actual app name
ps aux | grep -i "YourApp" | grep -v grep

# Get detailed memory info
vm_stat

# Monitor memory pressure
memory_pressure

# Get memory stats for a process
# First get PID: ps aux | grep YourApp
vmmap <PID>
```

## 3. Code-Based Memory Monitoring

### Add Memory Monitoring to Your App

Create a memory monitoring utility:

```typescript
// src/lib/memory-monitor.ts

interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export class MemoryMonitor {
  private intervalId: number | null = null;
  private samples: Array<{ timestamp: number; memory: MemoryInfo }> = [];
  private maxSamples = 100;

  /**
   * Get current memory usage (if available)
   */
  static getMemoryInfo(): MemoryInfo | null {
    // @ts-ignore - performance.memory is WebKit-specific
    if (typeof performance !== 'undefined' && performance.memory) {
      // @ts-ignore
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      };
    }
    return null;
  }

  /**
   * Start monitoring memory usage
   */
  start(intervalMs: number = 5000): void {
    if (this.intervalId !== null) {
      console.warn('[MemoryMonitor] Already monitoring');
      return;
    }

    this.intervalId = window.setInterval(() => {
      const memory = MemoryMonitor.getMemoryInfo();
      if (memory) {
        this.samples.push({
          timestamp: Date.now(),
          memory,
        });

        // Keep only recent samples
        if (this.samples.length > this.maxSamples) {
          this.samples.shift();
        }

        // Log if memory is growing
        if (this.samples.length >= 2) {
          const prev = this.samples[this.samples.length - 2];
          const curr = this.samples[this.samples.length - 1];
          const growth = curr.memory.usedJSHeapSize - prev.memory.usedJSHeapSize;
          
          if (growth > 0) {
            console.log('[MemoryMonitor] Memory growth:', {
              used: this.formatBytes(curr.memory.usedJSHeapSize),
              growth: `+${this.formatBytes(growth)}`,
              percent: ((curr.memory.usedJSHeapSize / curr.memory.jsHeapSizeLimit) * 100).toFixed(2) + '%',
            });
          }
        }
      }
    }, intervalMs);

    console.log('[MemoryMonitor] Started monitoring');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[MemoryMonitor] Stopped monitoring');
    }
  }

  /**
   * Get memory statistics
   */
  getStats(): {
    current: MemoryInfo | null;
    samples: Array<{ timestamp: number; memory: MemoryInfo }>;
    average: number | null;
    peak: number | null;
    growth: number | null;
  } {
    const current = MemoryMonitor.getMemoryInfo();
    
    if (this.samples.length === 0) {
      return {
        current,
        samples: [],
        average: null,
        peak: null,
        growth: null,
      };
    }

    const usedSizes = this.samples.map(s => s.memory.usedJSHeapSize);
    const average = usedSizes.reduce((a, b) => a + b, 0) / usedSizes.length;
    const peak = Math.max(...usedSizes);
    const growth = this.samples.length >= 2
      ? usedSizes[usedSizes.length - 1] - usedSizes[0]
      : null;

    return {
      current,
      samples: [...this.samples],
      average,
      peak,
      growth,
    };
  }

  /**
   * Log memory statistics
   */
  logStats(): void {
    const stats = this.getStats();
    if (!stats.current) {
      console.warn('[MemoryMonitor] Memory info not available');
      return;
    }

    console.log('[MemoryMonitor] Statistics:', {
      current: this.formatBytes(stats.current.usedJSHeapSize),
      limit: this.formatBytes(stats.current.jsHeapSizeLimit),
      percent: ((stats.current.usedJSHeapSize / stats.current.jsHeapSizeLimit) * 100).toFixed(2) + '%',
      average: stats.average ? this.formatBytes(stats.average) : 'N/A',
      peak: stats.peak ? this.formatBytes(stats.peak) : 'N/A',
      growth: stats.growth ? (stats.growth > 0 ? '+' : '') + this.formatBytes(stats.growth) : 'N/A',
      samples: this.samples.length,
    });
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Force garbage collection (if available in debug mode)
   */
  static forceGC(): void {
    // @ts-ignore - gc() is available in some debug environments
    if (typeof gc === 'function') {
      // @ts-ignore
      gc();
      console.log('[MemoryMonitor] Forced garbage collection');
    } else {
      console.warn('[MemoryMonitor] Garbage collection not available');
    }
  }
}

// Export singleton instance
export const memoryMonitor = new MemoryMonitor();
```

### Use in Your App

```typescript
// In src/App.tsx or main component
import { memoryMonitor } from './lib/memory-monitor';

// Start monitoring in development
if (import.meta.env.DEV) {
  memoryMonitor.start(5000); // Check every 5 seconds
  
  // Log stats periodically
  setInterval(() => {
    memoryMonitor.logStats();
  }, 30000); // Every 30 seconds
  
  // Expose to window for manual inspection
  (window as any).memoryMonitor = memoryMonitor;
}
```

## 4. DOM Node Counting

Add DOM node monitoring:

```typescript
// src/lib/dom-monitor.ts

export class DOMMonitor {
  /**
   * Count DOM nodes
   */
  static countNodes(): {
    total: number;
    elements: number;
    textNodes: number;
    byTag: Record<string, number>;
  } {
    const allNodes = document.querySelectorAll('*');
    const stats = {
      total: allNodes.length,
      elements: 0,
      textNodes: 0,
      byTag: {} as Record<string, number>,
    };

    allNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        stats.elements++;
        const tag = node.tagName.toLowerCase();
        stats.byTag[tag] = (stats.byTag[tag] || 0) + 1;
      } else if (node.nodeType === Node.TEXT_NODE) {
        stats.textNodes++;
      }
    });

    return stats;
  }

  /**
   * Log DOM statistics
   */
  static logStats(): void {
    const stats = this.countNodes();
    console.log('[DOMMonitor] DOM Statistics:', {
      total: stats.total,
      elements: stats.elements,
      textNodes: stats.textNodes,
      topTags: Object.entries(stats.byTag)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => `${tag}: ${count}`)
        .join(', '),
    });
  }
}

// Expose to window
if (typeof window !== 'undefined') {
  (window as any).DOMMonitor = DOMMonitor;
}
```

## 5. Blob URL Tracking

Monitor blob URLs:

```typescript
// Add to src/lib/blob-url-manager.ts

export function getBlobURLStats(): {
  total: number;
  byBook: Record<string, number>;
  totalSize: string; // Estimated
} {
  const stats = {
    total: blobURLManager.getTotalCount(),
    byBook: {} as Record<string, number>,
    totalSize: 'N/A',
  };

  // Note: This would require tracking book IDs with URLs
  // You'd need to enhance the blob URL manager to support this
  
  return stats;
}

// Log stats
export function logBlobURLStats(): void {
  const stats = getBlobURLStats();
  console.log('[BlobURLManager] Statistics:', stats);
}
```

## 6. Testing Checklist

### Memory Leak Detection

1. **Baseline Measurement:**
   - Start app
   - Wait 30 seconds
   - Record memory usage

2. **Load Test:**
   - Load a book
   - Record memory
   - Switch chapters 10 times
   - Record memory
   - Switch books 5 times
   - Record memory

3. **Time-Based Test:**
   - Use app normally for 10 minutes
   - Record memory every minute
   - Check for steady growth

4. **Stress Test:**
   - Rapidly switch chapters
   - Rapidly switch books
   - Load/unload audio tracks
   - Check memory after each operation

### What to Look For

- **Memory Leaks:**
  - Steady growth over time without corresponding user actions
  - Memory not released after operations complete
  - Growing DOM node count

- **High Usage:**
  - Sudden spikes during operations
  - Memory not being released after switching books
  - Large number of cached resources

- **Specific Issues:**
  - Blob URLs not being revoked
  - Event listeners not being cleaned up
  - Caches growing unbounded
  - DOM references preventing GC

## 7. Quick Debug Commands

Add to your app for quick debugging:

```typescript
// In development, expose debugging tools
if (import.meta.env.DEV) {
  (window as any).debugMemory = {
    // Get current memory
    getMemory: () => MemoryMonitor.getMemoryInfo(),
    
    // Force GC (if available)
    forceGC: () => MemoryMonitor.forceGC(),
    
    // Get DOM stats
    getDOMStats: () => DOMMonitor.countNodes(),
    
    // Get blob URL stats
    getBlobStats: () => getBlobURLStats(),
    
    // Get cache sizes
    getCacheSizes: () => {
      // Add your cache inspection methods
      return {
        // chapterCache: chapterCache.size,
        // audioTrackCache: audioTrackCache.size,
        // etc.
      };
    },
    
    // Log everything
    logAll: () => {
      console.group('Memory Debug Info');
      memoryMonitor.logStats();
      DOMMonitor.logStats();
      logBlobURLStats();
      console.groupEnd();
    },
  };
}
```

Then in WebKit Inspector console:
```javascript
// Get current memory
debugMemory.getMemory()

// Log all stats
debugMemory.logAll()

// Force garbage collection
debugMemory.forceGC()
```

## 8. Tauri-Specific Monitoring

You can also add Rust-side monitoring:

```rust
// In src-tauri/src/main.rs
use sysinfo::{System, SystemExt, ProcessExt};

fn get_memory_usage() -> u64 {
    let mut system = System::new_all();
    system.refresh_all();
    
    if let Some(process) = system.process(sysinfo::get_current_pid().unwrap()) {
        process.memory() // Memory in KB
    } else {
        0
    }
}
```

## Summary

1. **Use WebKit Inspector** for detailed JavaScript heap analysis
2. **Use Activity Monitor** for overall app memory usage
3. **Use Instruments** for deep memory profiling
4. **Add code-based monitoring** for real-time tracking
5. **Test systematically** with the checklist above

The combination of these tools will help you identify memory leaks and high usage patterns in your Tauri/WebKit app.
