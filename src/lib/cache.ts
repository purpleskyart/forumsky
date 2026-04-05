const CACHE_PREFIX = 'fsky_cache_';
const DEFAULT_TTL = 60_000; // 1 minute

interface CacheEntry<T> {
  data: T;
  ts: number;
  ttl: number;
}

export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.ts > entry.ttl) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function getStale<T>(key: string): { data: T; stale: boolean } | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    const stale = Date.now() - entry.ts > entry.ttl;
    return { data: entry.data, stale };
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T, ttl = DEFAULT_TTL) {
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now(), ttl };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // storage full, evict oldest entries
    evictOldest(5);
    try {
      const entry: CacheEntry<T> = { data, ts: Date.now(), ttl };
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // give up
    }
  }
}

export function clearCache() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  keys.forEach(k => localStorage.removeItem(k));
}

export function removeCacheEntry(key: string) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    /* ignore */
  }
}

function evictOldest(count: number) {
  const entries: { key: string; ts: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CACHE_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const { ts } = JSON.parse(raw);
      entries.push({ key, ts });
    } catch {
      entries.push({ key, ts: 0 });
    }
  }
  entries.sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    localStorage.removeItem(entries[i].key);
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
