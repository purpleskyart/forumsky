import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

interface VirtualListOptions {
  /** Total number of items */
  itemCount: number;
  /** Estimated height of each item in pixels */
  itemHeight: number;
  /** Number of items to render outside viewport (overscan) */
  overscan?: number;
  /** Container height in pixels (auto-detected if not provided) */
  containerHeight?: number;
}

interface VirtualListResult {
  /** Index of first visible item */
  startIndex: number;
  /** Index of last visible item */
  endIndex: number;
  /** Total scrollable height */
  totalHeight: number;
  /** Offset for visible items */
  offsetY: number;
  /** Set container ref */
  containerRef: (el: HTMLElement | null) => void;
  /** Scroll to specific index */
  scrollToIndex: (index: number) => void;
}

/**
 * Virtual list hook using Intersection Observer.
 * Only renders items that are in or near the viewport.
 */
export function useVirtualList(options: VirtualListOptions): VirtualListResult {
  const { itemCount, itemHeight, overscan = 3, containerHeight: fixedHeight } = options;
  
  const containerRef = useRef<HTMLElement | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: Math.min(itemCount - 1, 10) });
  const [containerHeight, setContainerHeight] = useState(fixedHeight || 0);
  const prevItemCountRef = useRef(itemCount);
  
  // Update container height when ref changes or on resize
  useEffect(() => {
    if (fixedHeight) return;
    
    const updateHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };
    
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, [fixedHeight]);
  
  // Calculate visible range based on scroll position
  const calculateVisibleRange = useCallback(() => {
    if (!containerRef.current) return;
    
    const scrollTop = containerRef.current.scrollTop;
    const height = containerHeight || containerRef.current.clientHeight;
    
    // Calculate which items should be visible
    const start = Math.floor(scrollTop / itemHeight);
    const visibleCount = Math.ceil(height / itemHeight);
    
    // Apply overscan (render extra items above and below)
    const startIndex = Math.max(0, start - overscan);
    const endIndex = Math.min(itemCount - 1, start + visibleCount + overscan);
    
    setVisibleRange(prev => {
      if (prev.start !== startIndex || prev.end !== endIndex) {
        return { start: startIndex, end: endIndex };
      }
      return prev;
    });
  }, [itemCount, itemHeight, overscan, containerHeight]);
  
  // Set up scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const handleScroll = () => {
      requestAnimationFrame(calculateVisibleRange);
    };
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    calculateVisibleRange(); // Initial calculation
    
    return () => container.removeEventListener('scroll', handleScroll);
  }, [calculateVisibleRange]);
  
  // Recalculate when dependencies change
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      calculateVisibleRange();
      return;
    }

    const prevItemCount = prevItemCountRef.current;
    const newItemCount = itemCount;
    const itemsAdded = newItemCount - prevItemCount;

    // If new items were appended and user is near bottom, preserve scroll position
    if (itemsAdded > 0 && prevItemCount > 0) {
      const scrollTop = container.scrollTop;
      const scrollHeight = container.scrollHeight;
      const clientHeight = container.clientHeight;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      // If user is within 200px of bottom, maintain position relative to bottom
      if (distanceFromBottom < 200) {
        // Calculate new scroll position to maintain same distance from bottom
        const newScrollHeight = newItemCount * itemHeight;
        const newScrollTop = newScrollHeight - distanceFromBottom - clientHeight;
        container.scrollTop = Math.max(0, newScrollTop);
      }
    }

    prevItemCountRef.current = newItemCount;
    calculateVisibleRange();
  }, [itemCount, itemHeight, calculateVisibleRange]);
  
  const scrollToIndex = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;
    
    const targetScrollTop = index * itemHeight;
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
  }, [itemHeight]);
  
  const totalHeight = itemCount * itemHeight;
  const offsetY = visibleRange.start * itemHeight;
  
  return {
    startIndex: visibleRange.start,
    endIndex: visibleRange.end,
    totalHeight,
    offsetY,
    containerRef: (el: HTMLElement | null) => {
      containerRef.current = el;
      if (el && !fixedHeight) {
        setContainerHeight(el.clientHeight);
      }
    },
    scrollToIndex,
  };
}
