/**
 * Microcosm Constellation API – downvote counts for AT Protocol
 * (same collection as ArtSky: app.purplesky.feed.downvote).
 *
 * @see https://constellation.microcosm.blue/
 */

const CONSTELLATION_BASE = 'https://constellation.microcosm.blue';
const DOWNVOTE_COLLECTION = 'app.purplesky.feed.downvote';
const DOWNVOTE_PATH = '.subject.uri';

/** Distinct DIDs that have downvoted a post. */
export async function getDownvoteCount(postUri: string): Promise<number> {
  const params = new URLSearchParams({
    target: postUri,
    collection: DOWNVOTE_COLLECTION,
    path: DOWNVOTE_PATH,
  });
  try {
    const res = await fetch(`${CONSTELLATION_BASE}/links/count/distinct-dids?${params}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { total?: number };
    return typeof data.total === 'number' ? data.total : 0;
  } catch {
    return 0;
  }
}

const DOWNVOTE_BATCH_SIZE = 4;
const DOWNVOTE_BATCH_DELAY_MS = 150;

export async function getDownvoteCounts(postUris: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(postUris)];
  const out: Record<string, number> = {};
  for (let i = 0; i < unique.length; i += DOWNVOTE_BATCH_SIZE) {
    const batch = unique.slice(i, i + DOWNVOTE_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (uri) => ({ uri, count: await getDownvoteCount(uri) })),
    );
    for (const { uri, count } of results) out[uri] = count;
    if (i + DOWNVOTE_BATCH_SIZE < unique.length) {
      await new Promise((r) => setTimeout(r, DOWNVOTE_BATCH_DELAY_MS));
    }
  }
  return out;
}
