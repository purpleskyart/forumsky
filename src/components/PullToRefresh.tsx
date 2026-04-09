import { useState, useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

/**
 * Implements a high-quality pull-to-refresh interaction specifically for PWAs.
 * Features a resistance-curved pull, haptic-like triggers, and a clean spinner.
 */
export function PullToRefresh({ children }: { children: ComponentChildren }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [hasTriggered, setHasTriggered] = useState(false);
  const touchStartRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const REFRESH_THRESHOLD = 80;
  const MAX_PULL = 120;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only track pull-to-refresh if we are at the very top of the page
      if (window.scrollY <= 0) {
        touchStartRef.current = e.touches[0].screenY;
        setHasTriggered(false);
      } else {
        touchStartRef.current = null;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartRef.current === null || refreshing) return;

      const currentY = e.touches[0].screenY;
      const diff = currentY - touchStartRef.current;

      // Only pull down
      if (diff > 0 && window.scrollY <= 0) {
        // Prevent default browser "bounce" or other overscroll behaviors
        if (e.cancelable) e.preventDefault();
        
        // Resistance curve: pull becomes harder as you go further
        const pull = Math.min(MAX_PULL, Math.pow(diff, 0.75) * 2.5);
        setPullDistance(pull);

        // Simulated haptic feedback threshold
        if (pull > REFRESH_THRESHOLD && !hasTriggered) {
          if ('vibrate' in navigator) {
            try { navigator.vibrate(10); } catch (err) { /* ignore */ }
          }
          setHasTriggered(true);
        } else if (pull <= REFRESH_THRESHOLD && hasTriggered) {
          setHasTriggered(false);
        }
      } else if (diff < 0) {
        // If they start swiping up, cancel the pull logic immediately
        touchStartRef.current = null;
        setPullDistance(0);
      }
    };

    const handleTouchEnd = () => {
      if (pullDistance > REFRESH_THRESHOLD) {
        triggerRefresh();
      } else {
        setPullDistance(0);
      }
      touchStartRef.current = null;
    };

    const triggerRefresh = () => {
      setRefreshing(true);
      setPullDistance(REFRESH_THRESHOLD);
      
      // Perform a full reload to clear state and refresh app version as requested earlier
      // This is the most reliable "refresh" for a PWA shell.
      window.location.reload();
      
      // Safety timeout in case reload is delayed
      setTimeout(() => {
        setRefreshing(false);
        setPullDistance(0);
      }, 5000);
    };

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [pullDistance, refreshing, hasTriggered]);

  return (
    <div ref={containerRef} class="ptr-container">
      <div 
        class="ptr-indicator" 
        style={{ 
          transform: `translate3d(-50%, ${pullDistance - 50}px, 0) scale(${Math.min(1, pullDistance / REFRESH_THRESHOLD)})`,
          opacity: Math.min(1, pullDistance / 40)
        }}
      >
        <div class={`ptr-spinner ${refreshing ? 'refreshing' : ''} ${pullDistance > REFRESH_THRESHOLD ? 'ready' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
             <path 
               d="M21 12a9 9 0 1 1-6.219-8.56" 
               style={{ 
                 strokeDasharray: '60', 
                 strokeDashoffset: refreshing ? '0' : Math.max(0, 60 - (pullDistance / REFRESH_THRESHOLD) * 60)
               }} 
             />
             {!refreshing && (
               <path d="M12 7l3 3-3 3" transform={`rotate(${(pullDistance / REFRESH_THRESHOLD) * 360}, 12, 12)`} />
             )}
          </svg>
        </div>
      </div>
      <div 
        class="ptr-content"
        style={{ 
            transition: pullDistance === 0 ? 'transform 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28)' : 'none'
        }}
      >
        {children}
      </div>
    </div>
  );
}
