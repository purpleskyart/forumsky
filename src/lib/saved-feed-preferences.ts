/** Extract custom feed generator URIs from Bluesky `getPreferences` response. */

export const FEED_GENERATOR_URI_RE = /^at:\/\/[^/]+\/app\.bsky\.feed\.generator\/[^/]+$/;

export interface SavedGeneratorFeedRef {
  uri: string;
  /** True if pinned in the Bluesky app sidebar */
  pinned: boolean;
}

function isFeedGeneratorUri(s: string): boolean {
  return FEED_GENERATOR_URI_RE.test(s);
}

/**
 * Walk preference records and collect `app.bsky.feed.generator` URIs.
 * If the same URI appears in both v1 and v2, pinned is true when any record marks it pinned.
 */
export function parseSavedGeneratorFeedsFromPreferences(prefs: unknown): SavedGeneratorFeedRef[] {
  if (!Array.isArray(prefs)) return [];
  const pinnedByUri = new Map<string, boolean>();

  for (const p of prefs) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const t = o.$type;

    if (t === 'app.bsky.actor.defs#savedFeedsPrefV2') {
      const items = o.items;
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const item = it as Record<string, unknown>;
        if (item.type !== 'feed') continue;
        const value = typeof item.value === 'string' ? item.value : '';
        if (!isFeedGeneratorUri(value)) continue;
        const pinned = Boolean(item.pinned);
        pinnedByUri.set(value, pinned || pinnedByUri.get(value) === true);
      }
    }

    if (t === 'app.bsky.actor.defs#savedFeedsPref') {
      const pinnedArr = Array.isArray(o.pinned) ? o.pinned : [];
      const savedArr = Array.isArray(o.saved) ? o.saved : [];
      for (const uri of pinnedArr) {
        if (typeof uri === 'string' && isFeedGeneratorUri(uri)) {
          pinnedByUri.set(uri, true);
        }
      }
      for (const uri of savedArr) {
        if (typeof uri === 'string' && isFeedGeneratorUri(uri)) {
          if (!pinnedByUri.has(uri)) pinnedByUri.set(uri, false);
        }
      }
    }
  }

  return [...pinnedByUri.entries()].map(([uri, pinned]) => ({ uri, pinned }));
}
