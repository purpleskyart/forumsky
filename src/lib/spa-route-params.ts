/**
 * Read route params from `location.pathname` when router props are missing
 * (e.g. cold loads, HMR, or edge cases). Keeps public URLs working while logged out.
 */

export function safeDecodePathSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** `/t/:actor/:rkey` — actor may be a handle (with dots) or a DID. */
export function parseThreadRoutePath(pathname: string): { actor?: string; rkey?: string } {
  const m = pathname.match(/^\/t\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return {};
  return {
    actor: safeDecodePathSegment(m[1]),
    rkey: safeDecodePathSegment(m[2]),
  };
}

/** `/u/:handle` — handle may contain dots. */
export function parseProfileRoutePath(pathname: string): { handle?: string } {
  const m = pathname.match(/^\/u\/(.+)$/);
  if (!m) return {};
  return { handle: safeDecodePathSegment(m[1]) };
}

/** `/c/:tag` only (not `/`; followed feed sets tag via props). */
export function parseCommunityRoutePath(pathname: string): { tag?: string } {
  const m = pathname.match(/^\/c\/([^/]+)\/?$/);
  if (!m) return {};
  return { tag: safeDecodePathSegment(m[1]) };
}
