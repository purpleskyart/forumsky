import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

interface VirtualListOptions {
  /** Total number of items */
  itemCount: number;
  /** Estimated height of each item in pixels */
  itemHeight: number;
  /** Number of items to render outside viewport (overscan) */
  overscan?: number;
}

interface VirtualListResult {
  /** Index of first visible item */
  startIndex: number;
  /** Index of last visible item */
  endIndex: number;
  /** Total scrollable height (for positioning) */
  totalHeight: number;
  /** Offset for visible items */
  offsetY: number;
  /** Set container ref (for measuring position) */
  containerRef: (el: HTMLElement | null) => void;
  /** Scroll to specific index */
  scrollToIndex: (index: number) => void;
}

/**
 * Virtual list hook using window scroll.
 * Only renders items that are in or near the viewport.
 * Designed for pages where the window is the scrolling container.
 */
export function useVirtualList(options: VirtualListOptions): VirtualListResult {
  const { itemCount, itemHeight, overscan = 3 } = options;

  const containerRef = useRef<HTMLElement | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: Math.min(itemCount - 1, 10) });

  // Use refs for values that change frequently but shouldn't trigger callback recreation
  const itemHeightRef = useRef(itemHeight);
  const overscanRef = useRef(overscan);
  const itemCountRef = useRef(itemCount);
  const prevItemCountRef = useRef(itemCount);

  // Keep refs in sync
  itemHeightRef.current = itemHeight;
  overscanRef.current = overscan;
  itemCountRef.current = itemCount;

  // Calculate visible range based on window scroll position
  const calculateVisibleRange = useCallback(() => {
    const container = containerRef.current;
    const iHeight = itemHeightRef.current;
    const iCount = itemCountRef.current;
    const oScan = overscanRef.current;

    if (!container || iCount === 0) {
      setVisibleRange({ start: 0, end: 0 });
      return;
    }

    // Get container's position relative to the document
    const containerRect = container.getBoundingClientRect();
    const containerTop = containerRect.top + window.scrollY;

    // Calculate scroll position relative to the container
    const scrollTop = Math.max(0, window.scrollY - containerTop);
    const viewportHeight = window.innerHeight;

    // Calculate which items should be visible
    const start = Math.floor(scrollTop / iHeight);
    const visibleCount = Math.ceil(viewportHeight / iHeight);

    // Apply overscan (render extra items above and below)
    const startIndex = Math.max(0, start - oScan);
    const endIndex = Math.min(iCount - 1, start + visibleCount + oScan);

    setVisibleRange(prev => {
      if (prev.start !== startIndex || prev.end !== endIndex) {
        return { start: startIndex, end: endIndex };
      }
      return prev;
    });
  }, []);

  // Set up window scroll listener
  useEffect(() => {
    const handleScroll = () => {
      requestAnimationFrame(calculateVisibleRange);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', calculateVisibleRange, { passive: true });

    // Initial calculation with a slight delay to ensure layout is complete
    const timeoutId = setTimeout(calculateVisibleRange, 0);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', calculateVisibleRange);
      clearTimeout(timeoutId);
    };
  }, [calculateVisibleRange]);

  // Recalculate when item count changes
  useEffect(() => {
    prevItemCountRef.current = itemCount;
    calculateVisibleRange();
  }, [itemCount, calculateVisibleRange]);

  const scrollToIndex = useCallback((index: number) => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerTop = containerRect.top + window.scrollY;
    const targetScrollTop = containerTop + (index * itemHeight);

    window.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
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
      // Recalculate when container ref is set
      if (el) {
        setTimeout(calculateVisibleRange, 0);
      }
    },
    scrollToIndex,
  };
}
