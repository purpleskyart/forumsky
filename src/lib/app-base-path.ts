import { createBrowserHistory } from 'history';

/**
 * Vite public base, always ends with `/` (`/` or `/repo/`).
 * Set at build time via `GITHUB_PAGES_BASE` in vite.config.
 */
export const APP_BASE_URL = import.meta.env.BASE_URL;

const basePrefix = APP_BASE_URL.replace(/\/$/, '');

/** Browser history with optional basename (GitHub project pages). */
export const browserHistory = createBrowserHistory({
  basename: basePrefix || undefined,
});

/**
 * Pathname inside the SPA (strips Vite base), e.g. `/c/foo` or `/`.
 * Use instead of `window.location.pathname` for route checks and parsers.
 */
export function appPathname(): string {
  if (typeof window === 'undefined') return '/';
  const pathname = window.location.pathname;
  if (!basePrefix) return pathname || '/';
  if (pathname === basePrefix || pathname === `${basePrefix}/`) return '/';
  if (pathname.startsWith(`${basePrefix}/`)) {
    const rest = pathname.slice(basePrefix.length);
    return rest || '/';
  }
  return pathname || '/';
}

/** `href` for in-app paths (middle-click, copy link). Pass-through for `#` and absolute URLs. */
export function hrefForAppPath(path: string): string {
  if (
    path === '#' ||
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('mailto:')
  ) {
    return path;
  }
  if (!path || path === '/') return APP_BASE_URL;
  const tail = path.startsWith('/') ? path.slice(1) : path;
  return APP_BASE_URL + tail;
}

/**
 * Public app root for OAuth metadata: origin + non-root base, no trailing slash.
 * e.g. `https://user.github.io/repo` or `https://forumsky.app`.
 */
export function appDeploymentRoot(): string {
  return `${window.location.origin}${basePrefix}`;
}
