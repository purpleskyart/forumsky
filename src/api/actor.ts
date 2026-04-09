import { xrpcGet, xrpcSessionGet, xrpcPost, getOAuthSession } from './xrpc';
import type { GetProfileResponse, GetProfilesResponse, ProfileView, CreateRecordResponse } from './types';

export interface ActorPreferencesResponse {
  preferences: unknown[];
}

/** Requires OAuth — account sync / migration API. */
export async function getActorPreferences(): Promise<ActorPreferencesResponse> {
  return xrpcSessionGet<ActorPreferencesResponse>('app.bsky.actor.getPreferences', {});
}

/** Custom collection for storing ForumSky pinned threads across devices */
const PINNED_THREADS_COLLECTION = 'app.purplesky.threads.pinned';

/** Custom collection for storing ForumSky subscribed threads across devices */
const SUBSCRIBED_THREADS_COLLECTION = 'app.purplesky.threads.subscribed';

export interface PinnedThreadsRecord {
  $type: string;
  pinnedThreads: Record<string, string[]>;
}

export interface SubscribedThreadsRecord {
  $type: string;
  subscribedThreads: string[];
}

/** Get pinned threads from the user's repo */
export async function getPinnedThreadsFromRepo(): Promise<Record<string, string[]>> {
  const session = getOAuthSession();
  if (!session) return {};

  try {
    const res = await xrpcSessionGet<{
      records?: Array<{ uri?: string; value?: PinnedThreadsRecord }>;
    }>('com.atproto.repo.listRecords', {
      repo: session.did,
      collection: PINNED_THREADS_COLLECTION,
      limit: 1,
    });

    if (res.records && res.records.length > 0 && res.records[0].value) {
      return res.records[0].value.pinnedThreads || {};
    }
    return {};
  } catch {
    return {};
  }
}

/** Save pinned threads to the user's repo */
export async function savePinnedThreadsToRepo(pinnedThreads: Record<string, string[]>): Promise<void> {
  const session = getOAuthSession();
  if (!session) return;

  try {
    const existing = await getPinnedThreadsFromRepo();
    const records = await xrpcSessionGet<{
      records?: Array<{ uri?: string; value?: PinnedThreadsRecord }>;
    }>('com.atproto.repo.listRecords', {
      repo: session.did,
      collection: PINNED_THREADS_COLLECTION,
      limit: 1,
    });

    const record: PinnedThreadsRecord = {
      $type: PINNED_THREADS_COLLECTION,
      pinnedThreads,
    };

    if (records.records && records.records.length > 0 && records.records[0].uri) {
      const parsed = records.records[0].uri?.split('/') || [];
      const rkey = parsed[parsed.length - 1];
      await xrpcPost('com.atproto.repo.putRecord', {
        repo: session.did,
        collection: PINNED_THREADS_COLLECTION,
        rkey,
        record,
      });
    } else {
      await xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
        repo: session.did,
        collection: PINNED_THREADS_COLLECTION,
        record,
      });
    }
  } catch {
    // If sync fails, fall back to localStorage
  }
}

/** Get subscribed threads from the user's repo */
export async function getSubscribedThreadsFromRepo(): Promise<string[]> {
  const session = getOAuthSession();
  if (!session) return [];

  try {
    const res = await xrpcSessionGet<{
      records?: Array<{ uri?: string; value?: SubscribedThreadsRecord }>;
    }>('com.atproto.repo.listRecords', {
      repo: session.did,
      collection: SUBSCRIBED_THREADS_COLLECTION,
      limit: 1,
    });

    if (res.records && res.records.length > 0 && res.records[0].value) {
      return res.records[0].value.subscribedThreads || [];
    }
    return [];
  } catch {
    return [];
  }
}

/** Save subscribed threads to the user's repo */
export async function saveSubscribedThreadsToRepo(subscribedThreads: string[]): Promise<void> {
  const session = getOAuthSession();
  if (!session) return;

  try {
    const records = await xrpcSessionGet<{
      records?: Array<{ uri?: string; value?: SubscribedThreadsRecord }>;
    }>('com.atproto.repo.listRecords', {
      repo: session.did,
      collection: SUBSCRIBED_THREADS_COLLECTION,
      limit: 1,
    });

    const record: SubscribedThreadsRecord = {
      $type: SUBSCRIBED_THREADS_COLLECTION,
      subscribedThreads,
    };

    if (records.records && records.records.length > 0 && records.records[0].uri) {
      const parsed = records.records[0].uri?.split('/') || [];
      const rkey = parsed[parsed.length - 1];
      await xrpcPost('com.atproto.repo.putRecord', {
        repo: session.did,
        collection: SUBSCRIBED_THREADS_COLLECTION,
        rkey,
        record,
      });
    } else {
      await xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
        repo: session.did,
        collection: SUBSCRIBED_THREADS_COLLECTION,
        record,
      });
    }
  } catch {
    // If sync fails, fall back to localStorage
  }
}

/** With a session, includes `viewer.following` / `followedBy` etc.; public otherwise. */
export async function getProfile(actor: string): Promise<GetProfileResponse> {
  if (getOAuthSession()) {
    return xrpcSessionGet<GetProfileResponse>('app.bsky.actor.getProfile', { actor });
  }
  return xrpcGet<GetProfileResponse>('app.bsky.actor.getProfile', { actor });
}

export async function getProfiles(actors: string[]): Promise<ProfileView[]> {
  if (actors.length === 0) return [];
  const params: Record<string, string> = {};
  actors.forEach((a, i) => { params[`actors[${i}]`] = a; });
  const res = await xrpcGet<GetProfilesResponse>('app.bsky.actor.getProfiles', params);
  return res.profiles;
}

export async function resolveHandle(handle: string): Promise<{ did: string }> {
  return xrpcGet<{ did: string }>('com.atproto.identity.resolveHandle', { handle });
}

/** Prefix search for Bluesky handles / display names (public API). */
export async function searchActors(
  query: string,
  opts?: { limit?: number },
): Promise<ProfileView[]> {
  const q = query.trim().replace(/^@+/, '');
  if (q.length < 1) return [];
  const res = await xrpcGet<{ actors: ProfileView[] }>('app.bsky.actor.searchActors', {
    q,
    limit: opts?.limit ?? 8,
  });
  return res.actors ?? [];
}
