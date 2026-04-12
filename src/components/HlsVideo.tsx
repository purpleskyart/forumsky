import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
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
 * 
 * Tap video to enter fullscreen (same video element, no reload).
 * In fullscreen, controls are hidden initially; tap again to show controls.
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
  const hlsRef = useRef<import('hls.js').default | null>(null);
  const isInViewRef = useRef(false);
  
  /** In fullscreen: false = just entered, controls hidden; true = tap again, show controls */
  const [fullscreenControlsEnabled, setFullscreenControlsEnabled] = useState(false);
  /** Controls visible in non-fullscreen mode (hover or tap) */
  const [showControls, setShowControls] = useState(false);
  /** Locks layout to decoded dimensions so poster → play does not resize the box. */
  const [aspectCss, setAspectCss] = useState<string | null>(
    aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : null
  );
  /** Track fullscreen state */
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Hover state for desktop */
  const [isHovered, setIsHovered] = useState(false);

  // Update aspect ratio when prop changes, but keep existing value if video already loaded
  useEffect(() => {
    if (aspectRatio) {
      setAspectCss(`${aspectRatio.width} / ${aspectRatio.height}`);
    }
  }, [aspectRatio?.width, aspectRatio?.height]);

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

  const onMouseEnter = () => setIsHovered(true);
  const onMouseLeave = () => setIsHovered(false);

  // Pan/zoom state for mobile fullscreen
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isZooming, setIsZooming] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; distance: number } | null>(null);
  const lastTapTimeRef = useRef(0);

  // Track fullscreen changes
  useEffect(() => {
    const onFsChange = () => {
      const fsElement = document.fullscreenElement;
      const isFs = !!fsElement;
      setIsFullscreen(isFs);
      
      if (isFs) {
        // Just entered fullscreen: disable controls initially
        setFullscreenControlsEnabled(false);
      } else {
        // Exited fullscreen: reset everything
        setFullscreenControlsEnabled(false);
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

  // Enter fullscreen using the same video element (no reload)
  const enterFullscreen = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    
    // Try video element fullscreen first (better for mobile)
    const fsMethod = video.requestFullscreen || (video as any).webkitRequestFullscreen;
    if (fsMethod) {
      void fsMethod.call(video).catch(() => {});
    } else {
      // Fallback to wrapper
      const wrap = wrapRef.current;
      if (wrap) {
        const wrapFs = wrap.requestFullscreen || (wrap as any).webkitRequestFullscreen;
        if (wrapFs) void wrapFs.call(wrap).catch(() => {});
      }
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    const exitMethod = document.exitFullscreen || (document as any).webkitExitFullscreen;
    if (exitMethod) {
      void exitMethod.call(document).catch(() => {});
    }
  }, []);

  // Handle tap on video: first tap enters fullscreen, second tap toggles controls
  const handleVideoTap = useCallback((e: MouseEvent | TouchEvent) => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;
    
    // Prevent double-tap zoom on mobile
    if (timeSinceLastTap < 300) {
      e.preventDefault();
      return;
    }

    if (!isFullscreen) {
      // First tap: enter fullscreen
      e.preventDefault();
      e.stopPropagation();
      enterFullscreen();
    } else {
      // In fullscreen: toggle controls
      e.preventDefault();
      e.stopPropagation();
      setFullscreenControlsEnabled(prev => !prev);
    }
  }, [isFullscreen, enterFullscreen]);

  // Handle escape key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitFullscreen();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen, exitFullscreen]);

  // Touch handlers for pinch-to-zoom and pan
  const getTouchDistance = (touches: TouchList): number => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = (e: TouchEvent) => {
    const v = videoRef.current;
    if (!v || !isFullscreen) {
      // Allow tap to enter fullscreen
      if (e.touches.length === 1) {
        handleVideoTap(e);
      }
      return;
    }

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

  // Determine if controls should be shown
  // In fullscreen: only if fullscreenControlsEnabled is true
  // Not in fullscreen: show on hover or if showControls is true
  const controlsVisible = isFullscreen 
    ? fullscreenControlsEnabled 
    : (showControls || isHovered);

  return (
    <div
      class="post-hls-video-wrap"
      ref={wrapRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <video
        ref={videoRef}
        class={`${className ?? ''} post-hls-video--compact`.trim()}
        controls={controlsVisible}
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
          cursor: isFullscreen ? (fullscreenControlsEnabled ? 'default' : 'pointer') : 'pointer',
        }}
        onLoadedMetadata={onLoadedMetadata}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleVideoTap}
      />
      {/* Tap overlay for non-fullscreen mode (shows when controls are visible so clicking controls works) */}
      {!isFullscreen && (
        <div
          class="post-hls-video-click-overlay"
          onClick={handleVideoTap}
          style={{
            position: 'absolute',
            inset: 0,
            cursor: 'pointer',
            zIndex: 1,
            // Allow clicks to pass through to controls when they're visible
            pointerEvents: showControls || isHovered ? 'none' : 'auto',
          }}
        />
      )}
      {/* Fullscreen close button (visible when controls are enabled) */}
      {isFullscreen && fullscreenControlsEnabled && (
        <button
          type="button"
          class="media-lightbox-close"
          aria-label="Close fullscreen"
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            exitFullscreen();
          }}
          style={{
            position: 'fixed',
            top: '16px',
            right: '16px',
            zIndex: 10000,
            background: 'rgba(0,0,0,0.6)',
            border: 'none',
            color: 'white',
            fontSize: '24px',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
