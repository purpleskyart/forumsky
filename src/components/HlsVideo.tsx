import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { useHlsPlayer } from '@/hooks/useHlsPlayer';

type HlsVideoProps = {
  playlist: string;
  poster?: string;
  className?: string;
  'aria-label'?: string;
  aspectRatio?: { width: number; height: number };
};

/** How much of the player must be visible before autoplay (feed-style). */
const IN_VIEW_THRESHOLD = 0.35;

/**
 * Plays Bluesky-style HLS playlists in the browser: native where supported (Safari),
 * otherwise loads hls.js on demand (Chrome, Firefox, …).
 */
export function HlsVideo({ 
  playlist, 
  poster, 
  className, 
  'aria-label': ariaLabel,
  aspectRatio 
}: HlsVideoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lightboxVideoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import('hls.js').default | null>(null);
  const lightboxHlsRef = useRef<import('hls.js').default | null>(null);
  const isInViewRef = useRef(false);
  /** When false, a play overlay covers the player; native controls stay in the DOM for stable layout. */
  const [showControls, setShowControls] = useState(false);
  /** Locks layout to decoded dimensions so poster → play does not resize the box. */
  const [aspectCss, setAspectCss] = useState<string | null>(
    aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : null
  );

  useEffect(() => {
    setAspectCss(null);
  }, [playlist]);

  useHlsPlayer(videoRef, hlsRef, playlist, { muted: true, autoplay: false });

  useEffect(() => {
    const wrap = wrapRef.current;
    const video = videoRef.current;
    if (!wrap || !video) return;

    video.muted = true;

    const tryPlayInView = () => {
      void video.play().catch(() => {
        video.muted = true;
        void video.play().catch(() => {});
      });
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        isInViewRef.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          tryPlayInView();
        } else {
          video.pause();
        }
      },
      { threshold: IN_VIEW_THRESHOLD },
    );
    observer.observe(wrap);

    const onVisibilityChange = () => {
      if (document.hidden) {
        video.pause();
      } else if (isInViewRef.current) {
        tryPlayInView();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [playlist]);

  const [isHovered, setIsHovered] = useState(false);
  const onMouseEnter = () => setIsHovered(true);
  const onMouseLeave = () => setIsHovered(false);

  // Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);

  // Handle escape key to close lightbox
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxOpen, closeLightbox]);

  // Load HLS for lightbox video when it opens
  useHlsPlayer(lightboxVideoRef, lightboxHlsRef, lightboxOpen ? playlist : undefined, { muted: false, autoplay: true });

  // Pan/zoom state for mobile fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isZooming, setIsZooming] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; distance: number } | null>(null);

  const onVideoPlay = () => {};

  const openLightbox = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLightboxOpen(true);
  };

  useEffect(() => {
    const onFsChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);
      setShowControls(isFs);
      // Reset zoom/pan when exiting fullscreen
      if (!isFs) {
        setZoom(1);
        setPanX(0);
        setPanY(0);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  // Touch handlers for pinch-to-zoom and pan
  const getTouchDistance = (touches: TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = (e: TouchEvent) => {
    const v = videoRef.current;
    if (!v || !isFullscreen) return;

    if (e.touches.length === 2) {
      // Pinch to zoom
      setIsZooming(true);
      touchStartRef.current = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        distance: getTouchDistance(e.touches),
      };
    } else if (e.touches.length === 1 && zoom > 1) {
      // Pan
      setIsPanning(true);
      touchStartRef.current = {
        x: e.touches[0].clientX - panX,
        y: e.touches[0].clientY - panY,
        distance: 0,
      };
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    const v = videoRef.current;
    if (!v || !isFullscreen) return;

    if (isZooming && e.touches.length === 2 && touchStartRef.current) {
      // Handle pinch zoom
      const currentDistance = getTouchDistance(e.touches);
      const scale = currentDistance / touchStartRef.current.distance;
      const newZoom = Math.min(Math.max(zoom * scale, 1), 4);
      setZoom(newZoom);
      touchStartRef.current.distance = currentDistance;
    } else if (isPanning && e.touches.length === 1 && touchStartRef.current) {
      // Handle pan
      e.preventDefault();
      const newX = e.touches[0].clientX - touchStartRef.current.x;
      const newY = e.touches[0].clientY - touchStartRef.current.y;
      setPanX(newX);
      setPanY(newY);
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    setIsZooming(false);
    setIsPanning(false);
    if (e.touches.length === 0) {
      touchStartRef.current = null;
    }
  };

  const onLoadedMetadata = (e: Event) => {
    const el = e.currentTarget as HTMLVideoElement;
    if (el.videoWidth > 0 && el.videoHeight > 0) {
      setAspectCss(`${el.videoWidth} / ${el.videoHeight}`);
    }
  };

  return (
    <>
      <div
        class="post-hls-video-wrap"
        ref={wrapRef}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <video
          ref={videoRef}
          class={`${className ?? ''} post-hls-video--compact`.trim()}
          controls={showControls || isHovered}
          playsInline
          preload="metadata"
          poster={poster}
          aria-label={ariaLabel}
          style={{
            aspectRatio: aspectCss || undefined,
            backgroundColor: 'var(--bg-elevated)',
            transform: isFullscreen ? `translate(${panX}px, ${panY}px) scale(${zoom})` : 'none',
            transformOrigin: 'center center',
            transition: isZooming || isPanning ? 'none' : 'transform 0.2s ease-out',
          }}
          onLoadedMetadata={onLoadedMetadata}
          onPlay={onVideoPlay}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />
        {/* Transparent overlay to capture clicks for lightbox, above video but below controls */}
        <div
          class="post-hls-video-click-overlay"
          onClick={openLightbox}
          style={{
            position: 'absolute',
            inset: 0,
            cursor: 'zoom-in',
            zIndex: 1,
            // Allow clicks to pass through to controls when they're visible
            pointerEvents: showControls || isHovered ? 'none' : 'auto',
          }}
        />
      </div>
      {lightboxOpen &&
        createPortal(
          <div
            class="media-lightbox-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Enlarged video"
            onClick={closeLightbox}
          >
            <button
              type="button"
              class="media-lightbox-close"
              aria-label="Close"
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                closeLightbox();
              }}
            >
              ×
            </button>
            <video
              ref={lightboxVideoRef}
              class="media-lightbox-video"
              poster={poster}
              controls
              playsInline
              preload="metadata"
              aria-label={ariaLabel}
              onClick={(e: MouseEvent) => e.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
