import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { nsfwMediaMode } from '@/lib/store';

/**
 * Gates labeled sensitive media per {@link nsfwMediaMode}.
 * When hidden, children are not mounted (no image/video request).
 */
export function NsfwMediaWrap({
  isNsfw,
  compact,
  children,
}: {
  isNsfw: boolean;
  /** Smaller placeholder (e.g. thread list thumbnails). */
  compact?: boolean;
  children: ComponentChildren;
}) {
  const mode = nsfwMediaMode.value;
  const [revealed, setRevealed] = useState(false);

  if (!isNsfw || mode === 'show') {
    return <>{children}</>;
  }
  if (mode === 'blur' && revealed) {
    return <>{children}</>;
  }
  if (mode === 'hide') {
    return (
      <div
        class={`nsfw-media-placeholder${compact ? ' nsfw-media-placeholder--compact' : ''}`}
        role="img"
        aria-label="Sensitive media hidden by your settings"
      >
        <span class="nsfw-media-placeholder-text">Sensitive media hidden</span>
      </div>
    );
  }

  return (
    <div class="nsfw-media-blur-wrap">
      <div class="nsfw-media-blur-layer" aria-hidden>
        {children}
      </div>
      <div class="nsfw-media-blur-overlay">
        <button
          type="button"
          class="btn btn-outline btn-sm nsfw-media-reveal-btn"
          onClick={e => {
            e.stopPropagation();
            setRevealed(true);
          }}
        >
          Show media
        </button>
      </div>
    </div>
  );
}
