import { useRef, useState, useEffect, useCallback } from 'preact/hooks';
import type { ImageView } from '@/api/types';

function normalizeUrlKey(u: string): string {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return u.replace(/[?#].*$/, '');
  }
}

function canUseStaticThumb(thumb: string, full: string): boolean {
  return Boolean(thumb && normalizeUrlKey(thumb) !== normalizeUrlKey(full));
}

/**
 * GIF: animated source loads when scrolled into view; click toggles pause.
 * Uses a static thumb from the API when available; otherwise freezes the first frame (fetch + canvas).
 */
export function GifImageFromEmbed({
  img,
  className = '',
}: {
  img: ImageView;
  className?: string;
}) {
  const full = img.fullsize || img.thumb;
  const thumb = img.thumb || img.fullsize;
  return (
    <GifImage
      thumb={thumb}
      fullsize={full}
      alt={img.alt || ''}
      aspectRatio={img.aspectRatio}
      className={className}
    />
  );
}

export function GifImage({
  thumb,
  fullsize,
  alt,
  className = '',
  aspectRatio,
}: {
  thumb: string;
  fullsize: string;
  alt: string;
  className?: string;
  aspectRatio?: { width: number; height: number };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [inView, setInView] = useState(false);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [playKey, setPlayKey] = useState(0);

  const full = fullsize || thumb;
  const swap = canUseStaticThumb(thumb, full);
  const showAnimated = inView && !paused;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setInView(e.isIntersecting),
      { rootMargin: '100px 0px', threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!paused || swap || !inView) {
      setFrozen(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(full);
        if (!res.ok) throw new Error('fetch');
        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        if (cancelled) {
          bmp.close();
          return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
          bmp.close();
          return;
        }
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          bmp.close();
          return;
        }
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        setFrozen(true);
      } catch {
        if (!cancelled) {
          setFrozen(false);
          setPaused(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paused, swap, inView, full]);

  const toggle = useCallback(() => {
    if (!inView) return;
    setPaused((p) => {
      const next = !p;
      if (p && !next) {
        setFrozen(false);
        setPlayKey((k) => k + 1);
      }
      return next;
    });
  }, [inView]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  const label = paused ? 'Play GIF' : 'Pause GIF';

  return (
    <div
      ref={wrapRef}
      class={`post-gif-wrap ${className}`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={paused}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }}
      onKeyDown={onKeyDown}
    >
      {swap && (
        <img
          src={showAnimated ? full : thumb}
          alt={alt}
          class="post-gif-img"
          decoding="async"
          draggable={false}
          style={{ 
            aspectRatio: aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : undefined,
            backgroundColor: 'var(--bg-elevated)',
          }}
        />
      )}

      {!swap && !inView && (
        <div
          class="post-gif-placeholder"
          style={
            aspectRatio
              ? { aspectRatio: `${aspectRatio.width} / ${aspectRatio.height}` }
              : { minHeight: '160px' }
          }
        />
      )}

      {!swap && inView && !paused && (
        <img
          key={playKey}
          class="post-gif-img"
          src={full}
          alt={alt}
          decoding="async"
          draggable={false}
          style={{ 
            aspectRatio: aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : undefined,
            backgroundColor: 'var(--bg-elevated)',
          }}
        />
      )}

      {!swap && inView && paused && (
        <>
          {!frozen && <div class="post-gif-loading" aria-hidden="true" />}
          <canvas
            ref={canvasRef}
            class="post-gif-canvas"
            style={{ 
              display: frozen ? 'block' : 'none',
              aspectRatio: aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : undefined,
            }}
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}
