/**
 * Persists window scroll per pathname+search+hash in sessionStorage so browser
 * back/forward returns to the same vertical position (feed ↔ thread).
 */

import { appPathname } from '@/lib/app-base-path';

const PREFIX = 'forumskyScroll:';

function storageKey(fullPath: string): string {
  return PREFIX + fullPath;
}

export function currentScrollStorageKey(): string {
  if (typeof window === 'undefined') return '';
  return appPathname() + window.location.search + window.location.hash;
}

function readSavedScroll(fullPath: string): number | null {
  const raw = sessionStorage.getItem(storageKey(fullPath));
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function writeSavedScroll(fullPath: string, y: number): void {
  sessionStorage.setItem(storageKey(fullPath), String(Math.max(0, Math.round(y))));
  console.log('[ScrollRestore] Saved scroll for', fullPath, ':', y);
}

export { writeSavedScroll };

/** Remove saved scroll position for a path (used before forward navigation to ensure we start at top). */
export function clearSavedScroll(fullPath: string): void {
  try {
    sessionStorage.removeItem(storageKey(fullPath));
  } catch {
    /* ignore */
  }
}

let persistRefCount = 0;
let rafId: number | null = null;
let ticking = false;
/** Skip persisting while we apply a restored position (avoids corrupting storage on back/forward). */
let ignoreScrollPersistUntil = 0;
/** Track scroll restoration timers for cleanup */
let restoreTimerIds: number[] = [];

/** Pause scroll persistence for a short duration (used during navigation to prevent RAF overwrites). */
export function pauseScrollPersistence(durationMs = 100): void {
  ignoreScrollPersistUntil = performance.now() + durationMs;
  if (rafId != null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }
  ticking = false;
}

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
 * Stops trying to restore once user starts scrolling.
 * Retries until content is tall enough to support the scroll position.
 */
export function restoreScrollNow(): void {
  if (typeof window === 'undefined') return;
  const key = currentScrollStorageKey();
  const y = readSavedScroll(key);
  console.log('[ScrollRestore] Attempting to restore for key:', key, ': saved y=', y, 'current y=', window.scrollY, 'document height=', document.documentElement.scrollHeight);
  if (y == null) {
    console.log('[ScrollRestore] No saved scroll found for key:', key);
    // Log all saved scroll keys for debugging
    const allKeys = Object.keys(sessionStorage).filter(k => k.startsWith('forumskyScroll:'));
    console.log('[ScrollRestore] All saved scroll keys:', allKeys);
    return;
  }

  ignoreScrollPersistUntil = performance.now() + 500;

  // Clear any pending restoration timers
  restoreTimerIds.forEach(id => window.clearTimeout(id));
  restoreTimerIds = [];

  let hasUserScrolled = false;
  let hasAttemptedRestore = false;
  let attemptCount = 0;
  const maxAttempts = 30; // Increased from 10 to handle slower content loading

  const checkUserScroll = () => {
    // Only check for user scroll AFTER we've attempted restoration at least once
    // This prevents falsely detecting user scroll when page is at 0 and we're trying to restore to 500
    if (!hasAttemptedRestore) return false;
    if (Math.abs(window.scrollY - y) > 50) {
      hasUserScrolled = true;
    }
    return hasUserScrolled;
  };

  const canScrollTo = (targetY: number) => {
    const docHeight = document.documentElement.scrollHeight;
    const viewportHeight = window.innerHeight;
    const maxScroll = Math.max(0, docHeight - viewportHeight);
    const result = targetY <= maxScroll + 100; // Allow small overshoot tolerance
    console.log('[ScrollRestore] canScrollTo check: targetY=', targetY, 'docHeight=', docHeight, 'viewportHeight=', viewportHeight, 'maxScroll=', maxScroll, 'result=', result);
    return result;
  };

  const apply = () => {
    if (checkUserScroll()) {
      console.log('[ScrollRestore] apply: user scrolled, aborting');
      return false;
    }
    if (!canScrollTo(y)) {
      console.log('[ScrollRestore] apply: cannot scroll to target, aborting');
      return false;
    }
    console.log('[ScrollRestore] apply: scrolling to', y);
    hasAttemptedRestore = true;
    window.scrollTo({ top: y, left: 0, behavior: 'auto' });
    const success = Math.abs(window.scrollY - y) < 50;
    console.log('[ScrollRestore] apply: after scrollTo, scrollY=', window.scrollY, 'success=', success);
    return success;
  };

  // Initial restore attempt
  apply();

  // Follow-ups that stop if user scrolled or successful restore
  const schedule = (delay: number) => {
    const id = window.setTimeout(() => {
      attemptCount++;
      if (checkUserScroll()) return;
      const success = apply();
      if (!success && attemptCount < maxAttempts) {
        // Retry with exponential backoff up to 2000ms (increased from 500ms)
        const nextDelay = Math.min(delay * 1.5, 2000);
        schedule(nextDelay);
      }
    }, delay);
    restoreTimerIds.push(id);
  };

  requestAnimationFrame(() => {
    if (!checkUserScroll()) {
      const success = apply();
      if (!success) schedule(100); // Increased from 50ms
    }
  });
  schedule(200); // Increased from 100ms
  schedule(500); // Increased from 300ms
  schedule(1000); // Increased from 600ms
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
 * Ensures the outgoing page's position is stored under the correct key.
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
