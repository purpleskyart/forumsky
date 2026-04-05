import { xrpcGet, xrpcSessionGet, getOAuthSession } from './xrpc';
import type {
  SearchPostsResponse,
  GetPostThreadResponse,
  GetAuthorFeedResponse,
  GetTimelineResponse,
  GetFeedResponse,
  GetFeedGeneratorResponse,
  PostView,
} from './types';

export async function searchPosts(
  query: string,
  opts?: { cursor?: string; limit?: number; sort?: 'top' | 'latest' },
): Promise<SearchPostsResponse> {
  return xrpcGet<SearchPostsResponse>('app.bsky.feed.searchPosts', {
    q: query,
    limit: opts?.limit ?? 25,
    cursor: opts?.cursor,
    sort: opts?.sort ?? 'latest',
  });
}

export async function searchByTag(
  tag: string,
  opts?: { cursor?: string; limit?: number; sort?: 'latest' | 'top' },
): Promise<SearchPostsResponse> {
  return searchPosts(`#${tag}`, {
    ...opts,
    sort: opts?.sort ?? 'latest',
  });
}

/** Home timeline (people you follow) — requires OAuth session. */
export async function getTimeline(
  opts?: { cursor?: string; limit?: number },
): Promise<GetTimelineResponse> {
  return xrpcSessionGet<GetTimelineResponse>('app.bsky.feed.getTimeline', {
    limit: opts?.limit ?? 30,
    cursor: opts?.cursor,
  });
}

/** Custom algorithmic feed (`at://…/app.bsky.feed.generator/…`) — requires OAuth session. */
export async function getFeed(
  feedAtUri: string,
  opts?: { cursor?: string; limit?: number },
): Promise<GetFeedResponse> {
  return xrpcSessionGet<GetFeedResponse>('app.bsky.feed.getFeed', {
    feed: feedAtUri,
    limit: opts?.limit ?? 30,
    cursor: opts?.cursor,
  });
}

/** Resolve feed generator metadata (public AppView). */
export async function getFeedGenerator(feedAtUri: string): Promise<GetFeedGeneratorResponse> {
  return xrpcGet<GetFeedGeneratorResponse>('app.bsky.feed.getFeedGenerator', {
    feed: feedAtUri,
  });
}

export async function getPostThread(
  uri: string,
  depth = 100,
  parentHeight = 0,
): Promise<GetPostThreadResponse> {
  const params = { uri, depth, parentHeight };
  return getOAuthSession()
    ? xrpcSessionGet<GetPostThreadResponse>('app.bsky.feed.getPostThread', params)
    : xrpcGet<GetPostThreadResponse>('app.bsky.feed.getPostThread', params);
}

export async function getAuthorFeed(
  actor: string,
  opts?: { cursor?: string; limit?: number; filter?: string },
): Promise<GetAuthorFeedResponse> {
  return xrpcGet<GetAuthorFeedResponse>('app.bsky.feed.getAuthorFeed', {
    actor,
    limit: opts?.limit ?? 30,
    cursor: opts?.cursor,
    filter: opts?.filter ?? 'posts_no_replies',
  });
}

export async function getPosts(uris: string[]): Promise<{ posts: PostView[] }> {
  const params: Record<string, string> = {};
  uris.forEach((u, i) => { params[`uris[${i}]`] = u; });
  return getOAuthSession()
    ? xrpcSessionGet<{ posts: PostView[] }>('app.bsky.feed.getPosts', params)
    : xrpcGet<{ posts: PostView[] }>('app.bsky.feed.getPosts', params);
}

export function getPostUri(did: string, rkey: string): string {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

export function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } | null {
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { repo: m[1], collection: m[2], rkey: m[3] };
}
