import { route as preactRoute } from 'preact-router';
import { FOLLOWED_COMMUNITY_TAG } from '@/lib/preferences';
import { confirmLeaveIfComposerDirty } from '@/lib/navigation-guard';

/**
 * Preact-router installs a document click handler that calls `route(anchor.getAttribute('href'))`.
 * With `import.meta.env.BASE_URL` (e.g. GitHub Pages `/repo/`), `href` is `/repo/t/...` while routes
 * are defined as `/t/...`, so matching fails and the SPA can get stuck until a full reload.
 * Setting `data-native` skips that handler; use with `navigate()` / `spaNavigateClick` for same-origin links.
 */
export const SPA_ANCHOR_SHIELD = { 'data-native': '' } as const;

export function navigate(path: string, replace = false) {
  if (!confirmLeaveIfComposerDirty()) return;
  preactRoute(path, replace);
}

/** Primary-click SPA navigation; modifier clicks keep default (new tab, etc.). */
export function spaNavigateClick(path: string): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    if (path === '#' || path === '') return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(path);
  };
}

/** Like {@link spaNavigateClick} but stops outer handlers (e.g. feed row background navigate). */
export function spaNavigateClickStopRow(path: string): (e: MouseEvent) => void {
  return (e: MouseEvent) => {
    e.stopPropagation();
    if (path === '#' || path === '') return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(path);
  };
}

/** Same idea as Artsky Layout: browser back (history). */
export function navigateBack() {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    window.history.back();
  } else {
    navigate('/', true);
  }
}

export function searchUrl(query: string, scope: 'global' | 'following' | 'me' | 'users' = 'global'): string {
  const p = new URLSearchParams();
  if (query.trim()) p.set('q', query.trim());
  p.set('scope', scope);
  return `/search?${p.toString()}`;
}

export function communityUrl(tag: string): string {
  if (tag === FOLLOWED_COMMUNITY_TAG) return '/';
  return `/c/${encodeURIComponent(tag)}`;
}

export function threadUrl(actor: string, rkey: string): string {
  return `/t/${encodeURIComponent(actor)}/${encodeURIComponent(rkey)}`;
}

export function profileUrl(handle: string): string {
  return `/u/${encodeURIComponent(handle)}`;
}
