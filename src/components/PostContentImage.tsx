import { useState, useEffect, useCallback } from 'preact/hooks';
import { createPortal } from 'preact/compat';

/**
 * Inline post image: click opens a full-screen lightbox (Escape or backdrop to close).
 */
export function PostContentImage({
  src,
  alt,
  className = 'post-content-media',
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

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
        style={{ cursor: 'zoom-in' }}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
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
            <img
              class="media-lightbox-img"
              src={src}
              alt={alt}
              onClick={(e: MouseEvent) => e.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
