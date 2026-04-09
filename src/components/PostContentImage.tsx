import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';

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

  const close = useCallback(() => setOpen(false), []);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') goToPrev();
      if (e.key === 'ArrowRight') goToNext();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, goToPrev, goToNext]);

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
