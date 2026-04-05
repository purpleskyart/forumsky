/**
 * Find which row has the most visible area in the viewport so keyboard W/S (or arrows)
 * can continue from the post the user was reading after mouse scroll.
 */

function visibleHeightInViewport(el: Element, vh: number): number {
  const r = el.getBoundingClientRect();
  return Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
}

/** Thread posts use DOM ids `thread-post-1` … `thread-post-N` (1-based). */
export function dominantVisibleThreadPostNumber(maxPost: number, fallback: number): number {
  if (maxPost < 1) return fallback;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  let bestN = fallback;
  let bestArea = -1;
  for (let n = 1; n <= maxPost; n++) {
    const el = document.getElementById(`thread-post-${n}`);
    if (!el) continue;
    const area = visibleHeightInViewport(el, vh);
    if (area > bestArea) {
      bestArea = area;
      bestN = n;
    }
  }
  return bestArea <= 0 ? fallback : bestN;
}

/** Feed / list rows with ids like `community-feed-kb-0` (0-based index). */
export function dominantVisibleListRowIndex(count: number, elementId: (i: number) => string, fallback: number): number {
  if (count <= 0) return fallback;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  let bestIdx = fallback;
  let bestArea = -1;
  for (let i = 0; i < count; i++) {
    const el = document.getElementById(elementId(i));
    if (!el) continue;
    const area = visibleHeightInViewport(el, vh);
    if (area > bestArea) {
      bestArea = area;
      bestIdx = i;
    }
  }
  return bestArea <= 0 ? fallback : bestIdx;
}
