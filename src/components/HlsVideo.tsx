import { useRef, useEffect, useState } from 'preact/hooks';

type HlsVideoProps = {
  playlist: string;
  poster?: string;
  className?: string;
  'aria-label'?: string;
  aspectRatio?: { width: number; height: number };
};

/** How much of the player must be visible before autoplay (feed-style). */
const IN_VIEW_THRESHOLD = 0.35;

function nativeHlsSupported(video: HTMLVideoElement): boolean {
  return Boolean(
    video.canPlayType('application/vnd.apple.mpegurl') ||
      video.canPlayType('application/x-mpegURL'),
  );
}

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
  const hlsRef = useRef<import('hls.js').default | null>(null);
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playlist) return;

    if (nativeHlsSupported(video)) {
      video.src = playlist;
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    let cancelled = false;

    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      const el = videoRef.current;
      if (!el) return;

      if (!Hls.isSupported()) return;

      const instance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hlsRef.current = instance;
      instance.loadSource(playlist);
      instance.attachMedia(el);
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            instance.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            instance.recoverMediaError();
            break;
          default:
            instance.destroy();
            if (hlsRef.current === instance) hlsRef.current = null;
            break;
        }
      });
    });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [playlist]);

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

  // Pan/zoom state for mobile fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isZooming, setIsZooming] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; distance: number } | null>(null);

  const onVideoPlay = () => {};

  const toggleFullscreen = async (e: MouseEvent) => {
    const v = videoRef.current;
    if (!v) return;
    e.preventDefault();
    e.stopPropagation();

    if (!document.fullscreenElement) {
      v.muted = false;
      try {
        if ((v as any).webkitEnterFullscreen) {
          (v as any).webkitEnterFullscreen();
        } else {
          await v.requestFullscreen();
        }
      } catch (err) {
        // Fallback for some browsers
      }
    } else {
      if (document.exitFullscreen) {
        void document.exitFullscreen();
      }
    }
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
        onClick={toggleFullscreen}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />
    </div>
  );
}
