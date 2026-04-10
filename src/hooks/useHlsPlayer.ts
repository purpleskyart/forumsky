import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

function nativeHlsSupported(video: HTMLVideoElement): boolean {
  return Boolean(
    video.canPlayType('application/vnd.apple.mpegURL') ||
      video.canPlayType('application/x-mpegURL'),
  );
}

interface UseHlsPlayerOptions {
  muted?: boolean;
  autoplay?: boolean;
}

/**
 * Hook to initialize HLS player on a video element.
 * Handles both native HLS support (Safari) and hls.js (Chrome, Firefox, etc.)
 */
export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement>,
  hlsRef: RefObject<import('hls.js').default | null>,
  playlist: string | undefined,
  options: UseHlsPlayerOptions = {},
): void {
  const { muted = true, autoplay = false } = options;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playlist) return;

    if (nativeHlsSupported(video)) {
      video.src = playlist;
      video.muted = muted;
      if (autoplay) {
        void video.play().catch(() => {});
      }
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
      el.muted = muted;
      if (autoplay) {
        void el.play().catch(() => {});
      }
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
  }, [playlist, muted, autoplay, videoRef, hlsRef]);
}
