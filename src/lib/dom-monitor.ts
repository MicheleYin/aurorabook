/**
 * DOM Monitor - Track DOM node counts and statistics
 */

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

  /**
   * Count nodes in a specific container
   */
  static countNodesInContainer(container: HTMLElement): {
    total: number;
    elements: number;
    byTag: Record<string, number>;
  } {
    const allNodes = container.querySelectorAll('*');
    const stats = {
      total: allNodes.length,
      elements: 0,
      byTag: {} as Record<string, number>,
    };

    allNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        stats.elements++;
        const tag = node.tagName.toLowerCase();
        stats.byTag[tag] = (stats.byTag[tag] || 0) + 1;
      }
    });

    return stats;
  }
}
