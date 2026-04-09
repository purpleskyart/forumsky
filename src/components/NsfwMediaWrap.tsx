import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { nsfwMediaMode } from '@/lib/store';
import type { Label } from '@/api/types';

/** Extract the first human-readable NSFW label value from a list of labels. */
function nsfwLabelText(labels?: Label[]): string | null {
  if (!labels?.length) return null;
  const nsfwVals = ['sexual', 'nudity', 'porn', 'nsfw', 'adult', 'graphic-media'];
  for (const L of labels) {
    const val = L.val?.replace(/^[!]+/, '').toLowerCase().trim();
    if (!val) continue;
    if (nsfwVals.includes(val) || val.includes('sexual') || val.includes('nsfw') || val.includes('porn') || val.includes('graphic-media')) {
      return val.replace(/-/g, ' ');
    }
  }
  return null;
}

/**
 * Gates labeled sensitive media per {@link nsfwMediaMode}.
 * When hidden, children are not mounted (no image/video request).
 */
export function NsfwMediaWrap({
  isNsfw,
  compact,
  labels,
  children,
}: {
  isNsfw: boolean;
  /** Smaller placeholder (e.g. thread list thumbnails). */
  compact?: boolean;
  /** Labels from the post/author, used to show a descriptive warning on the overlay. */
  labels?: Label[];
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

  const labelText = nsfwLabelText(labels);

  if (mode === 'hide') {
    return (
      <div
        class={`nsfw-media-placeholder${compact ? ' nsfw-media-placeholder--compact' : ''}`}
        role="img"
        aria-label="Sensitive media hidden by your settings"
      >
        <span class="nsfw-media-placeholder-text">
          {labelText ? `${labelText} · ` : ''}Sensitive media hidden
        </span>
      </div>
    );
  }

  return (
    <div
      class="nsfw-media-blur-wrap"
      onClick={e => {
        e.stopPropagation();
        setRevealed(true);
      }}
      title="Click to show sensitive media"
    >
      <div class="nsfw-media-blur-layer" aria-hidden>
        {children}
      </div>
      <div class="nsfw-media-blur-overlay">
        <div class="nsfw-media-blur-overlay-content">
          {labelText && (
            <span class="nsfw-media-label-badge">{labelText}</span>
          )}
          <button
            type="button"
            class="btn btn-outline btn-sm nsfw-media-reveal-btn"
          >
            Show media
          </button>
        </div>
      </div>
    </div>
  );
}
