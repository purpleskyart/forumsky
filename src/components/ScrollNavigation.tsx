import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

interface ScrollNavigationProps {
  isNestedMode: boolean;
  topCommentCount: number;
}

export function ScrollNavigation({ isNestedMode, topCommentCount }: ScrollNavigationProps) {
  const [showButton, setShowButton] = useState(false);
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('down');
  const [currentTopCommentIndex, setCurrentTopCommentIndex] = useState(0);
  const lastScrollY = useRef(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHoldingRef = useRef(false);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;

      // Show button if not at top or bottom
      const isAtTop = scrollY < 50;
      const isAtBottom = scrollY + windowHeight >= documentHeight - 50;
      setShowButton(!isAtTop && !isAtBottom);

      // Determine scroll direction
      if (scrollY > lastScrollY.current) {
        setScrollDirection('down');
      } else if (scrollY < lastScrollY.current) {
        setScrollDirection('up');
      }
      lastScrollY.current = scrollY;

      // Update current top comment index in nested mode
      if (isNestedMode) {
        updateCurrentTopCommentIndex();
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial check

    return () => window.removeEventListener('scroll', handleScroll);
  }, [isNestedMode]);

  const updateCurrentTopCommentIndex = useCallback(() => {
    let currentIndex = 0;
    for (let i = 0; i < topCommentCount; i++) {
      const element = document.getElementById(`top-comment-${i}`);
      if (element) {
        const rect = element.getBoundingClientRect();
        if (rect.top <= window.innerHeight / 2) {
          currentIndex = i;
        }
      }
    }
    setCurrentTopCommentIndex(currentIndex);
  }, [topCommentCount]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollToBottom = useCallback(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  }, []);

  const scrollToNextTopComment = useCallback(() => {
    const nextIndex = Math.min(currentTopCommentIndex + 1, topCommentCount - 1);
    const element = document.getElementById(`top-comment-${nextIndex}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrentTopCommentIndex(nextIndex);
    }
  }, [currentTopCommentIndex, topCommentCount]);

  const scrollToPreviousTopComment = useCallback(() => {
    const prevIndex = Math.max(currentTopCommentIndex - 1, 0);
    const element = document.getElementById(`top-comment-${prevIndex}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setCurrentTopCommentIndex(prevIndex);
    }
  }, [currentTopCommentIndex]);

  const handleHoldStart = useCallback((direction: 'next' | 'previous') => {
    isHoldingRef.current = true;
    
    // Immediate scroll on press
    if (direction === 'next') {
      scrollToNextTopComment();
    } else {
      scrollToPreviousTopComment();
    }

    // Continue scrolling while holding
    holdTimerRef.current = setInterval(() => {
      if (isHoldingRef.current) {
        if (direction === 'next') {
          scrollToNextTopComment();
        } else {
          scrollToPreviousTopComment();
        }
      }
    }, 500);
  }, [scrollToNextTopComment, scrollToPreviousTopComment]);

  const handleHoldEnd = useCallback(() => {
    isHoldingRef.current = false;
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  if (!showButton) return null;

  return (
    <div class="scroll-navigation">
      {isNestedMode && topCommentCount > 0 ? (
        <div class="scroll-navigation-nested">
          <button
            type="button"
            class="scroll-nav-btn scroll-nav-btn-previous"
            onMouseDown={() => handleHoldStart('previous')}
            onMouseUp={handleHoldEnd}
            onMouseLeave={handleHoldEnd}
            onTouchStart={() => handleHoldStart('previous')}
            onTouchEnd={handleHoldEnd}
            title="Hold to scroll to previous top comment"
            disabled={currentTopCommentIndex === 0}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <button
            type="button"
            class="scroll-nav-btn scroll-nav-btn-next"
            onClick={scrollToNextTopComment}
            onMouseDown={() => handleHoldStart('next')}
            onMouseUp={handleHoldEnd}
            onMouseLeave={handleHoldEnd}
            onTouchStart={() => handleHoldStart('next')}
            onTouchEnd={handleHoldEnd}
            title="Click for next, hold to scroll through top comments"
            disabled={currentTopCommentIndex === topCommentCount - 1}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          class="scroll-nav-btn"
          onClick={scrollDirection === 'down' ? scrollToBottom : scrollToTop}
          title={scrollDirection === 'down' ? 'Scroll to bottom' : 'Scroll to top'}
        >
          {scrollDirection === 'down' ? (
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
