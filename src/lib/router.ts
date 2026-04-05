import { route as preactRoute } from 'preact-router';
import { FOLLOWED_COMMUNITY_TAG } from '@/lib/preferences';
import { confirmLeaveIfComposerDirty } from '@/lib/navigation-guard';

export function navigate(path: string, replace = false) {
  if (!confirmLeaveIfComposerDirty()) return;
  preactRoute(path, replace);
}

/** Same idea as Artsky Layout: browser back (history). */
export function navigateBack() {
  if (typeof window !== 'undefined' && window.history.length > 1) {
    window.history.back();
  } else {
    navigate('/', true);
  }
}

export function searchUrl(query: string, scope: 'global' | 'following' | 'me' = 'global'): string {
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
