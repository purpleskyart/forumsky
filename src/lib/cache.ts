const CACHE_PREFIX = 'fsky_cache_';
const META_PREFIX = 'fsky_meta_';
const DEFAULT_TTL = 60_000; // 1 minute

// Track cache keys to avoid full localStorage iteration on eviction
const cacheKeys = new Set<string>();

export const CACHE_TTL = {
  DEFAULT: DEFAULT_TTL,
  PROFILE: 5 * 60 * 1000, // 5 minutes
  TIMELINE: 30_000, // 30 seconds
  FEED: 60_000, // 1 minute
  COMMUNITY_STATS: 120_000, // 2 minutes
} as const;

interface CacheEntry<T> {
  data: T;
}

interface CacheMeta {
  ts: number;
  ttl: number;
}

export function getCached<T>(key: string): T | null {
  try {
    const metaRaw = localStorage.getItem(META_PREFIX + key);
    if (!metaRaw) return null;
    const meta: CacheMeta = JSON.parse(metaRaw);
    if (Date.now() - meta.ts > meta.ttl) {
      localStorage.removeItem(META_PREFIX + key);
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    const dataRaw = localStorage.getItem(CACHE_PREFIX + key);
    if (!dataRaw) return null;
    const entry: CacheEntry<T> = JSON.parse(dataRaw);
    return entry.data;
  } catch {
    return null;
  }
}

export function getStale<T>(key: string): { data: T; stale: boolean } | null {
  try {
    const metaRaw = localStorage.getItem(META_PREFIX + key);
    if (!metaRaw) return null;
    const meta: CacheMeta = JSON.parse(metaRaw);
    const stale = Date.now() - meta.ts > meta.ttl;
    const dataRaw = localStorage.getItem(CACHE_PREFIX + key);
    if (!dataRaw) return null;
    const entry: CacheEntry<T> = JSON.parse(dataRaw);
    return { data: entry.data, stale };
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T, ttl = DEFAULT_TTL) {
  try {
    const entry: CacheEntry<T> = { data };
    const meta: CacheMeta = { ts: Date.now(), ttl };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    localStorage.setItem(META_PREFIX + key, JSON.stringify(meta));
    cacheKeys.add(key);
  } catch {
    evictOldest(5);
    try {
      const entry: CacheEntry<T> = { data };
      const meta: CacheMeta = { ts: Date.now(), ttl };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
      localStorage.setItem(META_PREFIX + key, JSON.stringify(meta));
      cacheKeys.add(key);
    } catch {
      // give up
    }
  }
}

export function clearCache() {
  cacheKeys.forEach(key => {
    localStorage.removeItem(CACHE_PREFIX + key);
    localStorage.removeItem(META_PREFIX + key);
  });
  cacheKeys.clear();
}

export function removeCacheEntry(key: string) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
    localStorage.removeItem(META_PREFIX + key);
    cacheKeys.delete(key);
  } catch {
    /* ignore */
  }
}

function evictOldest(count: number) {
  const entries: { key: string; ts: number }[] = [];
  for (const key of cacheKeys) {
    try {
      const raw = localStorage.getItem(META_PREFIX + key);
      if (!raw) continue;
      const { ts } = JSON.parse(raw);
      entries.push({ key, ts });
    } catch {
      entries.push({ key, ts: 0 });
    }
  }
  entries.sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    const { key } = entries[i];
    localStorage.removeItem(CACHE_PREFIX + key);
    localStorage.removeItem(META_PREFIX + key);
    cacheKeys.delete(key);
  }
}

/**
 * Stale-while-revalidate wrapper.
 * Returns cached data immediately if available, refreshes in background.
 */
export async function swr<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = DEFAULT_TTL,
): Promise<T> {
  const cached = getStale<T>(key);
  if (cached && !cached.stale) {
    return cached.data;
  }

  if (cached) {
    // Return stale, refresh in background
    fetcher().then(data => setCache(key, data, ttl)).catch(() => {});
    return cached.data;
  }

  const data = await fetcher();
  setCache(key, data, ttl);
  return data;
}
