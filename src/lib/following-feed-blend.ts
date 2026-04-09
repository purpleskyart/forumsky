import { getTimeline, getFeed } from '@/api/feed';
import type { FeedBlendSourceMeta, FeedRootItem, FeedViewPost, PostView } from '@/api/types';
import type { FollowingBlendSource } from '@/lib/preferences';

export interface SourceFetchState {
  cursor: string | undefined;
  done: boolean;
}

export interface FollowingBlendRuntime {
  sources: FollowingBlendSource[];
  queues: FeedRootItem[][];
  heads: number[];
  taken: number[];
  seen: Set<string>;
  fetch: SourceFetchState[];
}

export function createFollowingBlendRuntime(sources: FollowingBlendSource[]): FollowingBlendRuntime {
  const n = sources.length;
  return {
    sources,
    queues: Array.from({ length: n }, () => []),
    heads: Array(n).fill(0),
    taken: Array(n).fill(0),
    seen: new Set<string>(),
    fetch: Array.from({ length: n }, () => ({ cursor: undefined, done: false })),
  };
}

export interface FollowingMergeRuntime {
  sources: FollowingBlendSource[];
  raw: FeedRootItem[];
  seen: Set<string>;
  fetch: SourceFetchState[];
}

export function createFollowingMergeRuntime(sources: FollowingBlendSource[]): FollowingMergeRuntime {
  return {
    sources,
    raw: [],
    seen: new Set<string>(),
    fetch: sources.map(() => ({ cursor: undefined, done: false })),
  };
}

export function blendMetaFromSource(source: FollowingBlendSource): FeedBlendSourceMeta {
  if (source.kind === 'timeline') {
    return { kind: 'timeline', label: source.label };
  }
  return { kind: 'custom', label: source.label, feedUri: source.feedUri };
}

export function feedPostsToRootItems(
  items: FeedViewPost[],
  isRootPost: (p: PostView) => boolean,
  blendSource?: FeedBlendSourceMeta,
): FeedRootItem[] {
  const out: FeedRootItem[] = [];
  for (const it of items) {
    // If it's a reply, use the root post as the thread anchor.
    // If it's a root post, use it directly.
    const threadRoot = it.reply?.root || it.post;
    
    // For Following feed, we want to allow replies to bump threads.
    // However, some feeds/sources might not want this. ForumSky usually treats Following as a forum-style feed of threads.
    
    // We only include it if the resulting threadRoot is actually a root post 
    // (sometimes root could be missing or we want to filter to primary hashtags in other views).
    if (!isRootPost(threadRoot)) continue;

    // The activity timestamp is either the repost time, the reply time, or the post's own index time.
    const activity = it.reason?.indexedAt || it.post.indexedAt;
    const activityAuthor = it.reason?.by || it.post.author;

    out.push({ 
      post: threadRoot, 
      reason: it.reason, 
      blendSource, 
      lastActivity: activity,
      lastActivityAuthor: activityAuthor,
    });
  }
  return out;
}

/** First occurrence wins (stable for repost attribution). */
export function dedupeFeedRootItemsByUri(items: FeedRootItem[]): FeedRootItem[] {
  const seen = new Set<string>();
  const out: FeedRootItem[] = [];
  for (const it of items) {
    if (seen.has(it.post.uri)) continue;
    seen.add(it.post.uri);
    out.push(it);
  }
  return out;
}

export function activeBlendSources(config: FollowingBlendSource[]): FollowingBlendSource[] {
  return config.filter(s => s.enabled && s.weight > 0);
}

export function blendWeights(sources: FollowingBlendSource[]): number[] {
  return sources.map(s => Math.max(0, s.weight));
}

/**
 * Weighted fair interleaving: each pick prefers the source that is most under its ideal share.
 * `taken[i]` = how many posts have been chosen from source i (update as you go).
 */
export function pullWeightedBlendedRoots(
  queues: FeedRootItem[][],
  heads: number[],
  weights: number[],
  taken: number[],
  seen: Set<string>,
  count: number,
): FeedRootItem[] {
  const w = weights.map(x => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0);
  const out: FeedRootItem[] = [];
  if (sum <= 0 || w.length === 0) return out;

  while (out.length < count) {
    let bestI = -1;
    let bestScore = -Infinity;
    const totalPlaced = taken.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) {
      if (w[i] <= 0) continue;
      while (heads[i] < queues[i].length && seen.has(queues[i][heads[i]].post.uri)) {
        heads[i]++;
      }
      if (heads[i] >= queues[i].length) continue;
      const ideal = (w[i] / sum) * (totalPlaced + 1);
      const score = ideal - taken[i];
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
      }
    }
    if (bestI < 0) break;
    const item = queues[bestI][heads[bestI]++];
    if (seen.has(item.post.uri)) continue;
    seen.add(item.post.uri);
    taken[bestI]++;
    out.push(item);
  }
  return out;
}

export async function fetchBlendBatch(
  source: FollowingBlendSource,
  cursor: string | undefined,
  limit: number,
  isRootPost: (p: PostView) => boolean,
): Promise<{ items: FeedRootItem[]; cursor: string | undefined }> {
  const meta = blendMetaFromSource(source);
  if (source.kind === 'timeline') {
    const res = await getTimeline({ limit, cursor });
    return {
      items: feedPostsToRootItems(res.feed, isRootPost, meta),
      cursor: res.cursor,
    };
  }
  const uri = source.feedUri;
  if (!uri) return { items: [], cursor: undefined };
  const res = await getFeed(uri, { limit, cursor });
  return {
    items: feedPostsToRootItems(res.feed, isRootPost, meta),
    cursor: res.cursor,
  };
}

export function followingBlendHasMore(rt: FollowingBlendRuntime): boolean {
  if (rt.fetch.some(f => !f.done)) return true;
  return rt.queues.some((q, i) => rt.heads[i] < q.length);
}

/** Fill `pool` with weighted-blended roots until length >= targetLen or sources exhaust. */
export async function extendRecentBlendedPool(
  rt: FollowingBlendRuntime,
  isRootPost: (p: PostView) => boolean,
  pool: FeedRootItem[],
  targetLen: number,
  maxRounds: number,
  shouldCancel: () => boolean,
): Promise<void> {
  const weights = blendWeights(rt.sources);
  for (let round = 0; pool.length < targetLen && round < maxRounds; round++) {
    if (shouldCancel()) return;
    const chunk = pullWeightedBlendedRoots(
      rt.queues,
      rt.heads,
      weights,
      rt.taken,
      rt.seen,
      targetLen - pool.length,
    );
    if (chunk.length > 0) {
      pool.push(...chunk);
      continue;
    }
    const batches = await Promise.all(
      rt.sources.map(async (_, i) => {
        const st = rt.fetch[i];
        if (st.done) {
          return { i, items: [] as FeedRootItem[], cursor: undefined as string | undefined };
        }
        const { items, cursor } = await fetchBlendBatch(
          rt.sources[i],
          st.cursor,
          100,
          isRootPost,
        );
        return { i, items, cursor };
      }),
    );
    let anyIngested = false;
    for (const b of batches) {
      const st = rt.fetch[b.i];
      if (!st.done) {
        st.cursor = b.cursor;
        if (!b.cursor) st.done = true;
      }
      if (b.items.length > 0) anyIngested = true;
      rt.queues[b.i].push(...b.items);
    }
    const stillLive = rt.fetch.some(f => !f.done);
    if (!anyIngested && !stillLive) break;
  }
}

/** Fetch merged roots (all sources, parallel batches) until `raw` has at least targetLen unique roots. */
export async function extendMergedFollowingPool(
  rt: FollowingMergeRuntime,
  isRootPost: (p: PostView) => boolean,
  targetLen: number,
  maxRounds: number,
  shouldCancel: () => boolean,
): Promise<void> {
  for (let round = 0; rt.raw.length < targetLen && round < maxRounds; round++) {
    if (shouldCancel()) return;
    const before = rt.raw.length;
    const batches = await Promise.all(
      rt.sources.map(async (_, i) => {
        const st = rt.fetch[i];
        if (st.done) return { i, items: [] as FeedRootItem[], cursor: undefined as string | undefined };
        const { items, cursor } = await fetchBlendBatch(
          rt.sources[i],
          st.cursor,
          100,
          isRootPost,
        );
        return { i, items, cursor };
      }),
    );
    for (const b of batches) {
      const st = rt.fetch[b.i];
      if (!st.done) {
        st.cursor = b.cursor;
        if (!b.cursor) st.done = true;
      }
      for (const it of b.items) {
        if (rt.seen.has(it.post.uri)) continue;
        rt.seen.add(it.post.uri);
        rt.raw.push(it);
      }
    }
    if (rt.raw.length === before && rt.fetch.every(f => f.done)) break;
  }
}
