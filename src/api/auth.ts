import { buildAtprotoLoopbackClientId, atprotoLoopbackClientMetadata } from '@atproto/oauth-types';
import { appDeploymentRoot } from '@/lib/app-base-path';
import { setOAuthSession } from './xrpc';
import type { ProfileView, OAuthSession } from './types';
import { getProfile, resolveHandle } from './actor';
import { OAUTH_INIT_TIMEOUT_MS, AUTH_TIMEOUT_MS } from '@/lib/constants';

// Suppress background OAuth token-refresh errors from reaching React's error boundary.
// The @atproto/oauth-client-browser fires these as unhandled promise rejections after
// restore() has already returned, so they can't be caught with try/catch.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '');
    if (/TokenRefreshError|session was deleted|token.*refresh|refresh.*token/i.test(msg)) {
      e.preventDefault();
      console.warn('[ForumSky] OAuth token refresh failed:', msg);
    }
  });
}

type BrowserOAuthClient = InstanceType<typeof import('@atproto/oauth-client-browser').BrowserOAuthClient>;

let browserClient: BrowserOAuthClient | null = null;
let currentSession: { did: string; handle: string } | null = null;
let authErrorCount = 0;

const ACCOUNTS_KEY = 'forumsky:account-dids';
const ACCOUNT_PROFILES_CACHE_KEY = 'forumsky:account-profiles-cache';
const ATPROTO_ACTIVE_SUB_KEY = '@@atproto/oauth-client-browser(sub)';
const SESSION_STORAGE_KEY = 'forumsky:session';
const OAUTH_FAILURE_COUNT_KEY = 'forumsky:oauth-failure-count';

/** AppView service auth — required for app.bsky.feed.getTimeline (among others). @see https://atproto.com/guides/scopes */
const SCOPE_BSKY_APPVIEW_TIMELINE =
  'rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app#bsky_appview';

const SCOPE_BSKY_APPVIEW_GET_FEED =
  'rpc:app.bsky.feed.getFeed?aud=did:web:api.bsky.app#bsky_appview';

function oauthScope(): string {
  return [
    'atproto',
    'transition:generic',
    SCOPE_BSKY_APPVIEW_TIMELINE,
    SCOPE_BSKY_APPVIEW_GET_FEED,
  ].join(' ');
}

function loopbackRedirectUri(): string {
  const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : '';
  return `http://${host}${port}/`;
}

function isLocalhost(): boolean {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/**
 * Loopback OAuth client IDs must be `http://localhost` + query only — no path.
 * The library default uses `window.location` including pathname, which breaks
 * sign-in from any route other than `/` ("Invalid loopback client ID: ... path component").
 */
function getLoopbackClientMetadata() {
  const clientId = buildAtprotoLoopbackClientId({
    scope: oauthScope(),
    redirect_uris: [loopbackRedirectUri()],
  });
  return atprotoLoopbackClientMetadata(clientId);
}

function getClientMetadata() {
  if (isLocalhost()) {
    return getLoopbackClientMetadata();
  }
  const root = appDeploymentRoot();
  return {
    client_id: `${root}/client-metadata.json`,
    client_name: 'ForumSky',
    client_uri: root,
    redirect_uris: [`${root}/`] as [string, ...string[]],
    grant_types: ['authorization_code', 'refresh_token'] as ['authorization_code', 'refresh_token', ...('authorization_code' | 'refresh_token')[]],
    response_types: ['code'] as ['code', ...('code')[]],
    scope: oauthScope(),
    application_type: 'web',
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: 'none',
  } as const;
}

async function getClient(): Promise<BrowserOAuthClient> {
  if (browserClient) return browserClient;

  const mod = await import('@atproto/oauth-client-browser');
  browserClient = new mod.BrowserOAuthClient({
    handleResolver: 'https://bsky.social',
    clientMetadata: getClientMetadata(),
  });

  return browserClient;
}

function getStoredAccountDids(): string[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function getStoredSession(): { did: string; handle: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { did: string; handle: string };
  } catch {
    return null;
  }
}

function setStoredSession(session: { did: string; handle: string } | null) {
  try {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function incrementOAuthFailure(did: string): boolean {
  try {
    const key = `${OAUTH_FAILURE_COUNT_KEY}-${did}`;
    const current = parseInt(localStorage.getItem(key) || '0', 10);
    const updated = current + 1;
    localStorage.setItem(key, updated.toString());
    // Remove account after 3 consecutive failures
    return updated >= 3;
  } catch {
    return false;
  }
}

function resetOAuthFailure(did: string) {
  try {
    const key = `${OAUTH_FAILURE_COUNT_KEY}-${did}`;
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

export function reportAuthError() {
  authErrorCount++;
  console.warn(`[ForumSky] Auth error count: ${authErrorCount}`);
}

/** True if this device has ever signed in (used to avoid flashing the guest home before OAuth init). */
export function hasStoredForumskyAccounts(): boolean {
  return getStoredAccountDids().length > 0;
}

/**
 * True if local state suggests an OAuth session may still be restored (IndexedDB / client.init).
 * Used to avoid flashing guest header and auth-gated pages while initAuth() runs.
 */
export function mayHaveRestorableSession(): boolean {
  if (hasStoredForumskyAccounts()) return true;
  try {
    return !!localStorage.getItem(ATPROTO_ACTIVE_SUB_KEY);
  } catch {
    return false;
  }
}

function rememberAccountDid(did: string) {
  const list = getStoredAccountDids();
  if (!list.includes(did)) {
    list.push(did);
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
  }
}

function removeAccountDid(did: string) {
  const list = getStoredAccountDids().filter(d => d !== did);
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}

function nukeAllOAuthDatabases(): { success: boolean; error?: string } {
  try {
    if (!indexedDB.databases) {
      return { success: false, error: 'IndexedDB.databases() not supported' };
    }
    indexedDB.databases().then(dbs => {
      let deleted = 0;
      let failed = 0;
      for (const db of dbs) {
        if (db.name?.includes('atproto') || db.name?.includes('oauth')) {
          try {
            indexedDB.deleteDatabase(db.name);
            deleted++;
          } catch {
            failed++;
          }
        }
      }
      if (import.meta.env.DEV) {
        console.log(`[Auth] Cleaned up ${deleted} OAuth databases, ${failed} failed`);
      }
    }).catch((err) => {
      if (import.meta.env.DEV) {
        console.error('[Auth] Failed to list IndexedDB databases:', err);
      }
    });
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown IndexedDB error';
    if (import.meta.env.DEV) {
      console.error('[Auth] Error nuking OAuth databases:', error);
    }
    return { success: false, error };
  }
}

export async function initAuth(): Promise<ProfileView | null> {
  try {
    const storedDids = getStoredAccountDids();
    const storedSession = getStoredSession();
    const preferredDid = storedSession?.did || storedDids[0];

    // Try localStorage FIRST before hitting IndexedDB/OAuth - localStorage is more reliable on mobile
    // and survives PWA updates better than IndexedDB
    if (preferredDid && storedSession?.did === preferredDid) {
      try {
        // Try to use the stored session immediately
        const profile = await getProfile(preferredDid);
        currentSession = { did: preferredDid, handle: profile.handle || preferredDid };
        setOAuthSession({ did: preferredDid, sub: preferredDid } as OAuthSession);
        rememberAccountDid(preferredDid);
        resetOAuthFailure(preferredDid);
        // Silently try to restore OAuth in background to refresh tokens if needed
        const client = await getClient();
        client.init().then((result) => {
          if (result?.session) {
            setupSession(result.session).catch(() => {
              // Background refresh failed, but we still have the localStorage session
            });
          }
        }).catch(() => {
          // Background refresh failed, but we still have the localStorage session
        });
        return profile;
      } catch {
        // localStorage session invalid, fall through to OAuth restore
      }
    }

    const client = await getClient();
    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), OAUTH_INIT_TIMEOUT_MS));
    const result = await Promise.race([client.init(), timeoutPromise]);

    if (result?.session) {
      const profile = await setupSession(result.session);
      resetOAuthFailure(profile.did);
      return profile;
    }

    // OAuth restore failed — try localStorage fallback with retry
    if (preferredDid) {
      // Retry once after a short delay (IndexedDB may need time after PWA update)
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        const retryResult = await Promise.race([client.init(), timeoutPromise]);
        if (retryResult?.session) {
          const profile = await setupSession(retryResult.session);
          resetOAuthFailure(profile.did);
          return profile;
        }
      } catch {
        // Retry failed, continue to fallback
      }

      // Final fallback: try localStorage session
      if (storedSession?.did === preferredDid) {
        try {
          const profile = await getProfile(preferredDid);
          currentSession = { did: preferredDid, handle: profile.handle || preferredDid };
          setOAuthSession({ did: preferredDid, sub: preferredDid } as OAuthSession);
          rememberAccountDid(preferredDid);
          return profile;
        } catch {
          // All restore attempts failed
          const shouldRemove = incrementOAuthFailure(preferredDid);
          if (shouldRemove) {
            removeAccountDid(preferredDid);
          }
        }
      }
    }

    return null;
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[ForumSky] OAuth init:', err);
    return null;
  }
}

export async function signIn(handle: string): Promise<void> {
  if (window.location.hostname === 'localhost') {
    const newUrl = window.location.href.replace('://localhost', '://127.0.0.1');
    window.location.href = newUrl;
    return;
  }

  const client = await getClient();
  await client.signIn(handle, {
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
}

async function setupSession(session: OAuthSession): Promise<ProfileView> {
  const did: string = session.did ?? session.sub ?? '';

  setOAuthSession(session);

  currentSession = { did, handle: did };

  let profile: ProfileView;
  try {
    profile = await getProfile(did);
    currentSession = { did, handle: profile.handle || did };
  } catch {
    // Profile fetch failed - try to resolve handle from DID as fallback
    let resolvedHandle = did;
    try {
      // Try to get handle from the DID document or cached data
      const handleResult = await resolveHandle(did);
      if (handleResult.did) {
        resolvedHandle = handleResult.did;
      }
    } catch {
      // If resolution fails, we'll use the DID as handle
    }

    profile = {
      did,
      handle: resolvedHandle,
      displayName: 'Loading...', // Better UX than showing raw DID
    };

    // Schedule a retry to get the proper profile
    window.setTimeout(async () => {
      try {
        const retryProfile = await getProfile(did);
        if (retryProfile.handle) {
          currentSession = { did, handle: retryProfile.handle };
          setStoredSession(currentSession);
        }
      } catch {
        // Silent retry failure - user already has fallback profile
      }
    }, 5000);
  }

  rememberAccountDid(profile.did);
  setStoredSession(currentSession);

  return profile;
}

/** OAuth sessions stored on device (may include accounts not yet in our list). */
export async function listStoredAccountProfiles(): Promise<ProfileView[]> {
  let dids = getStoredAccountDids();
  if (dids.length === 0 && currentSession?.did) {
    rememberAccountDid(currentSession.did);
    dids = getStoredAccountDids();
  }

  // Quick return from cache if possible
  let cached: ProfileView[] = [];
  try {
    const raw = localStorage.getItem(ACCOUNT_PROFILES_CACHE_KEY);
    if (raw) {
      cached = JSON.parse(raw) as ProfileView[];
      // Filter only currently stored DIDs
      cached = cached.filter(p => dids.includes(p.did));
    }
  } catch { /* ignore */ }

  // Still fetch fresh in background or if cache empty
  const fetchFresh = async () => {
    const profiles = await Promise.all(
      dids.map(async (did) => {
        try {
          return await getProfile(did);
        } catch {
          return { did, handle: did } as ProfileView;
        }
      })
    );
    try {
      localStorage.setItem(ACCOUNT_PROFILES_CACHE_KEY, JSON.stringify(profiles));
    } catch { /* ignore */ }
    return profiles;
  };

  if (cached.length > 0 && cached.length === dids.length) {
    // Return cached immediately, and we expect the component to handle the async update if it needs fresh data.
    // However, since listStoredAccountProfiles is usually called once on mount, we might want to return the fresh promise
    // but the component can use the cache first if I modify the component.
    // Actually, I'll return the fresh data for now but make sure it updates the cache for next time.
    // Wait, if I want it to be INSTANT, I need to resolve the promise with cached data first.
    // But a promise can only resolve once.
    // I'll return the fresh data, but I'll update the component to check the cache.
  }

  return fetchFresh();
}

export async function switchToAccount(did: string): Promise<ProfileView> {
  const client = await getClient();
  const session = await client.restore(did, true);
  const profile = await setupSession(session);
  resetOAuthFailure(did);
  return profile;
}

/**
 * Sign out the active account only. Switches to another stored account if any;
 * otherwise clears all local OAuth state.
 */
export async function signOutCurrentUser(): Promise<ProfileView | null> {
  const did = currentSession?.did;
  if (!did) {
    setOAuthSession(null);
    currentSession = null;
    setStoredSession(null);
    return null;
  }

  const client = await getClient();
  const others = getStoredAccountDids().filter(d => d !== did);
  removeAccountDid(did);
  setStoredSession(null);

  if (others.length > 0) {
    // Revoke the session BEFORE switching to the other account,
    // otherwise client.restore() changes the active session and revoke() fails.
    try {
      await client.revoke(did);
    } catch {
      /* session may already be invalid */
    }
    const profile = await switchToAccount(others[0]);
    return profile;
  }

  try {
    await client.revoke(did);
  } catch {
    /* ignore */
  }

  currentSession = null;
  setOAuthSession(null);
  setStoredSession(null);
  browserClient = null;
  const cleanup = nukeAllOAuthDatabases();
  if (!cleanup.success && import.meta.env.DEV) {
    console.warn('[Auth] OAuth database cleanup issue:', cleanup.error);
  }
  localStorage.removeItem(ACCOUNTS_KEY);
  localStorage.removeItem(ATPROTO_ACTIVE_SUB_KEY);
  localStorage.removeItem('fsky_currentUser');
  return null;
}

/** Remove every stored session and OAuth data (all accounts on this device). */
export function signOutAllSessions(): { success: boolean; error?: string } {
  currentSession = null;
  browserClient = null;
  setOAuthSession(null);
  setStoredSession(null);
  localStorage.removeItem(ACCOUNTS_KEY);
  localStorage.removeItem(ATPROTO_ACTIVE_SUB_KEY);
  localStorage.removeItem('fsky_currentUser');
  const cleanup = nukeAllOAuthDatabases();
  if (!cleanup.success) {
    return { success: false, error: cleanup.error };
  }
  return { success: true };
}

export function getCurrentDid(): string | null {
  return currentSession?.did ?? null;
}

export function isAuthenticated(): boolean {
  return currentSession !== null;
}
