import { useRef, useEffect, useState } from 'preact/hooks';

type HlsVideoProps = {
  playlist: string;
  poster?: string;
  className?: string;
  'aria-label'?: string;
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
export function HlsVideo({ playlist, poster, className, 'aria-label': ariaLabel }: HlsVideoProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import('hls.js').default | null>(null);
  const isInViewRef = useRef(false);
  /** When false, a play overlay covers the player; native controls stay in the DOM for stable layout. */
  const [showControls, setShowControls] = useState(false);
  /** Locks layout to decoded dimensions so poster → play does not resize the box. */
  const [aspectCss, setAspectCss] = useState<string | null>(null);

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

  const revealAndPlay = (e: MouseEvent) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (v) v.muted = false;
    setShowControls(true);
    queueMicrotask(() => {
      void videoRef.current?.play().catch(() => {});
    });
  };

  const onVideoPlay = () => setShowControls(true);

  const onLoadedMetadata = (e: Event) => {
    const el = e.currentTarget as HTMLVideoElement;
    if (el.videoWidth > 0 && el.videoHeight > 0) {
      setAspectCss(`${el.videoWidth} / ${el.videoHeight}`);
    }
  };

  return (
    <div class="post-hls-video-wrap" ref={wrapRef}>
      <video
        ref={videoRef}
        class={`${className ?? ''}${showControls ? '' : ' post-hls-video--has-overlay'}`.trim()}
        controls={showControls}
        playsInline
        preload="metadata"
        poster={poster}
        aria-label={ariaLabel}
        style={aspectCss ? { aspectRatio: aspectCss } : undefined}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={onVideoPlay}
        onClick={showControls ? undefined : revealAndPlay}
      />
      {!showControls && (
        <button
          type="button"
          class="post-hls-video-play-overlay"
          aria-label={ariaLabel ?? 'Play video'}
          onClick={revealAndPlay}
        >
          <span class="post-hls-video-play-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
