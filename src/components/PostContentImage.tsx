import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { FOCUSABLE_SELECTORS } from '@/lib/constants';

interface ImageData {
  thumb: string;
  fullsize: string;
  alt: string;
  aspectRatio?: { width: number; height: number };
}

/**
 * Inline post image: click opens a full-screen lightbox (Escape or backdrop to close).
 */
export function PostContentImage({
  src,
  alt,
  className = 'post-content-media',
  aspectRatio,
  allImages,
  currentIndex,
}: {
  src: string;
  alt: string;
  className?: string;
  aspectRatio?: { width: number; height: number };
  allImages?: ImageData[];
  currentIndex?: number;
}) {
  const [open, setOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(currentIndex ?? 0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Restore focus to the element that was focused before opening
    if (previouslyFocusedRef.current) {
      previouslyFocusedRef.current.focus();
    }
  }, []);

  /** Get all focusable elements within the lightbox */
  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!lightboxRef.current) return [];
    return Array.from(lightboxRef.current.querySelectorAll(FOCUSABLE_SELECTORS));
  }, []);

  /** Trap focus within the lightbox */
  const trapFocus = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      // Shift+Tab: if on first element, wrap to last
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: if on last element, wrap to first
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  }, [getFocusableElements]);

  const images = allImages || [{ thumb: src, fullsize: src, alt, aspectRatio }];
  const effectiveIndex = allImages ? currentImageIndex : 0;

  const goToPrev = useCallback(() => {
    if (allImages && effectiveIndex > 0) {
      setCurrentImageIndex(effectiveIndex - 1);
    }
  }, [allImages, effectiveIndex]);

  const goToNext = useCallback(() => {
    if (allImages && effectiveIndex < allImages.length - 1) {
      setCurrentImageIndex(effectiveIndex + 1);
    }
  }, [allImages, effectiveIndex]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const touchStart = touchStartRef.current;
    if (!touchStart) return;

    const touchEnd = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY,
    };

    const diffX = touchEnd.x - touchStart.x;
    const diffY = touchEnd.y - touchStart.y;

    const minSwipeDistance = 50;

    // Vertical swipe (up/down) - close
    if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > minSwipeDistance) {
      close();
    }
    // Horizontal swipe (left/right) - navigate
    else if (Math.abs(diffX) > minSwipeDistance) {
      if (diffX > 0) {
        goToPrev();
      } else {
        goToNext();
      }
    }

    touchStartRef.current = null;
  }, [close, goToPrev, goToNext]);

  useEffect(() => {
    if (!open) return;

    // Store the previously focused element
    previouslyFocusedRef.current = document.activeElement as HTMLElement;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        e.stopPropagation();
        goToPrev();
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        e.stopPropagation();
        goToNext();
      }
      trapFocus(e);
    };
    // Use capture phase so lightbox gets events before window listeners on feed pages
    window.addEventListener('keydown', onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first focusable element when opening
    requestAnimationFrame(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        // Focus close button first, or first nav button
        const closeBtn = focusable.find(el => el.classList.contains('media-lightbox-close'));
        (closeBtn || focusable[0]).focus();
      }
    });

    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, goToPrev, goToNext, trapFocus, getFocusableElements]);

  // Reset index when opening
  useEffect(() => {
    if (open && currentIndex !== undefined) {
      setCurrentImageIndex(currentIndex);
    }
  }, [open, currentIndex]);

  return (
    <>
      <img
        class={className}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        tabIndex={0}
        aria-label={alt ? `View larger: ${alt}` : 'View larger image'}
        style={{
          cursor: 'zoom-in',
          aspectRatio: aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : undefined,
          backgroundColor: 'var(--bg-elevated)',
        }}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setCurrentImageIndex(currentIndex ?? 0);
          setOpen(true);
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setCurrentImageIndex(currentIndex ?? 0);
            setOpen(true);
          }
        }}
      />
      {open &&
        createPortal(
          <div
            ref={lightboxRef}
            class="media-lightbox-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Enlarged image"
            onClick={close}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <button
              type="button"
              class="media-lightbox-close"
              aria-label="Close"
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                close();
              }}
            >
              ×
            </button>
            {allImages && allImages.length > 1 && effectiveIndex > 0 && (
              <button
                type="button"
                class="media-lightbox-nav media-lightbox-nav--prev"
                aria-label="Previous image"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  goToPrev();
                }}
              >
                ‹
              </button>
            )}
            <img
              class="media-lightbox-img"
              src={images[effectiveIndex].fullsize}
              alt={images[effectiveIndex].alt}
              onClick={(e: MouseEvent) => e.stopPropagation()}
            />
            {allImages && allImages.length > 1 && effectiveIndex < allImages.length - 1 && (
              <button
                type="button"
                class="media-lightbox-nav media-lightbox-nav--next"
                aria-label="Next image"
                onClick={(e: MouseEvent) => {
                  e.stopPropagation();
                  goToNext();
                }}
              >
                ›
              </button>
            )}
            {allImages && allImages.length > 1 && (
              <div class="media-lightbox-counter">
                {effectiveIndex + 1} / {allImages.length}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
