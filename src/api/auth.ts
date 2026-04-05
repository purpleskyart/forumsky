import { buildAtprotoLoopbackClientId, atprotoLoopbackClientMetadata } from '@atproto/oauth-types';
import { appDeploymentRoot } from '@/lib/app-base-path';
import { setOAuthSession } from './xrpc';
import type { ProfileView } from './types';
import { getProfile } from './actor';

let browserClient: any = null;
let currentSession: { did: string; handle: string } | null = null;

const ACCOUNTS_KEY = 'forumsky:account-dids';
const ATPROTO_ACTIVE_SUB_KEY = '@@atproto/oauth-client-browser(sub)';

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

function getClientMetadata(): any {
  if (isLocalhost()) {
    return getLoopbackClientMetadata();
  }
  const root = appDeploymentRoot();
  return {
    client_id: `${root}/client-metadata.json`,
    client_name: 'ForumSky',
    client_uri: root,
    redirect_uris: [`${root}/`],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: oauthScope(),
    application_type: 'web',
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: 'none',
  };
}

async function getClient(): Promise<any> {
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

function nukeAllOAuthDatabases() {
  try {
    indexedDB.databases?.().then(dbs => {
      for (const db of dbs) {
        if (db.name?.includes('atproto') || db.name?.includes('oauth')) {
          indexedDB.deleteDatabase(db.name);
        }
      }
    });
  } catch {}
}

export async function initAuth(): Promise<ProfileView | null> {
  try {
    const client = await getClient();
    const result = await client.init();

    if (result?.session) {
      return await setupSession(result.session);
    }
    return null;
  } catch (err) {
    console.warn('[ForumSky] OAuth init:', err);
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
    signal: AbortSignal.timeout(120_000),
  });
}

async function setupSession(session: any): Promise<ProfileView> {
  const did: string = session.did || session.sub;

  setOAuthSession(session);

  currentSession = { did, handle: did };

  let profile: ProfileView;
  try {
    profile = await getProfile(did);
    currentSession = { did, handle: profile.handle || did };
  } catch {
    profile = { did, handle: did };
  }

  rememberAccountDid(profile.did);
  return profile;
}

/** OAuth sessions stored on device (may include accounts not yet in our list). */
export async function listStoredAccountProfiles(): Promise<ProfileView[]> {
  let dids = getStoredAccountDids();
  if (dids.length === 0 && currentSession?.did) {
    rememberAccountDid(currentSession.did);
    dids = getStoredAccountDids();
  }
  const profiles: ProfileView[] = [];
  for (const did of dids) {
    try {
      profiles.push(await getProfile(did));
    } catch {
      profiles.push({ did, handle: did });
    }
  }
  return profiles;
}

export async function switchToAccount(did: string): Promise<ProfileView> {
  const client = await getClient();
  const session = await client.restore(did, true);
  return setupSession(session);
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
    return null;
  }

  const client = await getClient();
  const others = getStoredAccountDids().filter(d => d !== did);
  removeAccountDid(did);

  if (others.length > 0) {
    const profile = await switchToAccount(others[0]);
    try {
      await client.revoke(did);
    } catch {
      /* session may already be invalid */
    }
    return profile;
  }

  try {
    await client.revoke(did);
  } catch {
    /* ignore */
  }

  currentSession = null;
  setOAuthSession(null);
  browserClient = null;
  nukeAllOAuthDatabases();
  localStorage.removeItem(ACCOUNTS_KEY);
  localStorage.removeItem(ATPROTO_ACTIVE_SUB_KEY);
  return null;
}

/** Remove every stored session and OAuth data (all accounts on this device). */
export function signOutAllSessions() {
  currentSession = null;
  browserClient = null;
  setOAuthSession(null);
  localStorage.removeItem(ACCOUNTS_KEY);
  localStorage.removeItem(ATPROTO_ACTIVE_SUB_KEY);
  nukeAllOAuthDatabases();
}

export function getCurrentDid(): string | null {
  return currentSession?.did ?? null;
}

export function isAuthenticated(): boolean {
  return currentSession !== null;
}
