import { xrpcGet, xrpcSessionGet, getOAuthSession } from './xrpc';
import type { GetProfileResponse, GetProfilesResponse, ProfileView } from './types';

export interface ActorPreferencesResponse {
  preferences: unknown[];
}

/** Requires OAuth — account sync / migration API. */
export async function getActorPreferences(): Promise<ActorPreferencesResponse> {
  return xrpcSessionGet<ActorPreferencesResponse>('app.bsky.actor.getPreferences', {});
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
