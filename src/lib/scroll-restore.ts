/**
 * Persists window scroll per pathname+search+hash in sessionStorage so browser
 * back/forward returns to the same vertical position (feed ↔ thread).
 */

const PREFIX = 'forumskyScroll:';

function storageKey(fullPath: string): string {
  return PREFIX + fullPath;
}

export function currentScrollStorageKey(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname + window.location.search + window.location.hash;
}

function readSavedScroll(fullPath: string): number | null {
  const raw = sessionStorage.getItem(storageKey(fullPath));
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function writeSavedScroll(fullPath: string, y: number): void {
  sessionStorage.setItem(storageKey(fullPath), String(Math.max(0, Math.round(y))));
}

let persistRefCount = 0;
let rafId: number | null = null;
let ticking = false;
/** Skip persisting while we apply a restored position (avoids corrupting storage on back/forward). */
let ignoreScrollPersistUntil = 0;

function flushScrollPosition(): void {
  ticking = false;
  if (typeof window === 'undefined') return;
  if (performance.now() < ignoreScrollPersistUntil) return;
  writeSavedScroll(currentScrollStorageKey(), window.scrollY);
}

function onWindowScroll(): void {
  if (ticking) return;
  ticking = true;
  rafId = window.requestAnimationFrame(() => {
    rafId = null;
    flushScrollPosition();
  });
}

/** Start saving scroll position for the current URL (throttled). Idempotent ref-counted. */
export function attachScrollPositionPersistence(): () => void {
  if (typeof window === 'undefined') return () => {};
  persistRefCount += 1;
  if (persistRefCount === 1) {
    window.addEventListener('scroll', onWindowScroll, { passive: true });
    window.addEventListener('pagehide', flushScrollPosition);
  }
  return () => {
    persistRefCount = Math.max(0, persistRefCount - 1);
    if (persistRefCount === 0) {
      window.removeEventListener('scroll', onWindowScroll);
      window.removeEventListener('pagehide', flushScrollPosition);
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      ticking = false;
    }
  };
}

/**
 * Restore scroll for the current location from sessionStorage.
 * Several passes help after async layout (feed load, images).
 */
export function restoreScrollNow(): void {
  if (typeof window === 'undefined') return;
  const key = currentScrollStorageKey();
  const y = readSavedScroll(key);
  if (y == null) return;

  ignoreScrollPersistUntil = performance.now() + 400;

  const apply = () => window.scrollTo({ top: y, left: 0, behavior: 'auto' });
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
  window.setTimeout(apply, 50);
  window.setTimeout(apply, 200);
}

/** Call after the router URL changes (back/forward or in-app navigation). */
export function scheduleScrollRestore(): void {
  requestAnimationFrame(() => {
    restoreScrollNow();
  });
}

export function setManualScrollRestoration(): void {
  if (typeof window === 'undefined') return;
  try {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  } catch {
    /* ignore */
  }
}

/**
 * Save scroll for the current URL immediately before history changes (SPA navigation).
 * Ensures the outgoing page’s position is stored under the correct key.
 */
/** popstate changes URL before React paints; block persisting wrong scrollY under the new path. */
export function attachPopstateScrollGuard(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onPop = () => {
    ignoreScrollPersistUntil = performance.now() + 500;
  };
  window.addEventListener('popstate', onPop, true);
  return () => window.removeEventListener('popstate', onPop, true);
}

export function patchHistoryScrollSave(): () => void {
  if (typeof window === 'undefined') return () => {};
  const push = history.pushState.bind(history);
  const rep = history.replaceState.bind(history);
  history.pushState = function (
    this: History,
    ...args: Parameters<History['pushState']>
  ): ReturnType<History['pushState']> {
    writeSavedScroll(currentScrollStorageKey(), window.scrollY);
    return push(...args);
  };
  history.replaceState = function (
    this: History,
    ...args: Parameters<History['replaceState']>
  ): ReturnType<History['replaceState']> {
    writeSavedScroll(currentScrollStorageKey(), window.scrollY);
    return rep(...args);
  };
  return () => {
    history.pushState = push;
    history.replaceState = rep;
  };
}
