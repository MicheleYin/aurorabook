/**
 * Memory Monitor - Track JavaScript heap memory usage
 * Works with WebKit's performance.memory API
 */

import { logger } from "./logger";

interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export class MemoryMonitor {
  private intervalId: number | null = null;
  private samples: Array<{ timestamp: number; memory: MemoryInfo }> = [];
  private maxSamples = 100;
  private static hasWarnedAboutUnavailability = false;
  private static isAvailable: boolean | null = null;

  /**
   * Check if memory API is available
   */
  static checkAvailability(): boolean {
    if (this.isAvailable !== null) {
      return this.isAvailable;
    }
    
    // @ts-ignore - performance.memory is Chrome-specific, not available in WebKit/Safari
    const available = typeof performance !== 'undefined' && 
                      // @ts-ignore
                      performance.memory && 
                      typeof (performance as any).memory.usedJSHeapSize === 'number';
    
    this.isAvailable = available;
    
    if (!available && !this.hasWarnedAboutUnavailability) {
      logger.log(
        '[MemoryMonitor] JavaScript heap memory API not available.\n' +
        '  This is expected in WebKit/Safari (Tauri uses WebKit).\n' +
        '  Use WebKit Inspector (Safari → Develop → Show Web Inspector) for memory profiling.\n' +
        '  Or use Activity Monitor for overall app memory usage.\n' +
        '  Other debug tools (blob URLs, DOM nodes, audio) still work.'
      );
      this.hasWarnedAboutUnavailability = true;
    }
    
    return available;
  }

  /**
   * Get current memory usage (if available)
   */
  static getMemoryInfo(): MemoryInfo | null {
    if (!this.checkAvailability()) {
      return null;
    }
    
    // @ts-ignore - performance.memory is Chrome-specific
    return {
      usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
      totalJSHeapSize: (performance as any).memory.totalJSHeapSize,
      jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit,
    };
  }

  /**
   * Start monitoring memory usage
   */
  start(intervalMs: number = 5000): void {
    if (this.intervalId !== null) {
      logger.warn('[MemoryMonitor] Already monitoring');
      return;
    }

    // Check availability first
    if (!MemoryMonitor.checkAvailability()) {
      logger.debug('[MemoryMonitor] Monitoring started but memory API unavailable. Other debug tools still work.');
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
            logger.debug('[MemoryMonitor] Memory growth:', {
              used: this.formatBytes(curr.memory.usedJSHeapSize),
              growth: `+${this.formatBytes(growth)}`,
              percent: ((curr.memory.usedJSHeapSize / curr.memory.jsHeapSizeLimit) * 100).toFixed(2) + '%',
            });
          }
        }
      }
    }, intervalMs);

    logger.debug('[MemoryMonitor] Started monitoring');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.debug('[MemoryMonitor] Stopped monitoring');
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
      // Don't warn - already warned once in checkAvailability()
      // Just show what we can
      if (this.samples.length > 0) {
        logger.debug('[MemoryMonitor] Historical data available:', {
          samples: this.samples.length,
          average: stats.average ? this.formatBytes(stats.average) : 'N/A',
          peak: stats.peak ? this.formatBytes(stats.peak) : 'N/A',
          growth: stats.growth ? (stats.growth > 0 ? '+' : '') + this.formatBytes(stats.growth) : 'N/A',
        });
        logger.debug('  Note: Current memory not available. Use WebKit Inspector for real-time memory info.');
      }
      return;
    }

    logger.debug('[MemoryMonitor] Statistics:', {
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
      logger.debug('[MemoryMonitor] Forced garbage collection');
    } else {
      logger.warn('[MemoryMonitor] Garbage collection not available');
    }
  }
}

// Export singleton instance
export const memoryMonitor = new MemoryMonitor();
