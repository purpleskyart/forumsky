/**
 * Prefetch thread data to make navigation feel instant
 */

const PREFETCH_CACHE = new Map<string, any>();
const PREFETCH_TTL = 10 * 60 * 1000; // 10 minutes
const STORAGE_KEY = 'forumsky_thread_cache';

// Load from localStorage on init
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const now = Date.now();
      for (const [uri, entry] of Object.entries(parsed)) {
        const typedEntry = entry as { data: any; timestamp: number };
        if (now - typedEntry.timestamp < PREFETCH_TTL) {
          PREFETCH_CACHE.set(uri, typedEntry);
        }
      }
    }
  } catch {
    // Ignore storage errors
  }
}

function persistCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, any> = {};
    for (const [uri, entry] of PREFETCH_CACHE.entries()) {
      obj[uri] = entry;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage errors
  }
}

export async function prefetchThread(uri: string): Promise<void> {
  if (PREFETCH_CACHE.has(uri)) {
    const cached = PREFETCH_CACHE.get(uri);
    if (Date.now() - cached.timestamp < PREFETCH_TTL) {
      return; // Already cached and fresh
    }
  }

  try {
    const { getPostThread } = await import('@/api/feed');
    const thread = await getPostThread(uri);
    PREFETCH_CACHE.set(uri, {
      data: thread,
      timestamp: Date.now(),
    });
    persistCache();
  } catch (err) {
    // Silently fail prefetch - it's just an optimization
    if (import.meta.env.DEV) console.debug('Prefetch failed for thread:', uri);
  }
}

export function getCachedThread(uri: string): any | null {
  const cached = PREFETCH_CACHE.get(uri);
  if (!cached) return null;
  
  if (Date.now() - cached.timestamp > PREFETCH_TTL) {
    PREFETCH_CACHE.delete(uri);
    persistCache();
    return null;
  }
  
  return cached.data;
}

export function clearPrefetchCache(): void {
  PREFETCH_CACHE.clear();
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}
