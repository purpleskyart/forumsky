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
import { TIMELINE_LIMIT, SEARCH_LIMIT, AUTHOR_FEED_LIMIT, POST_URI_CHUNK_SIZE } from '@/lib/constants';

export async function searchPosts(
  query: string,
  opts?: { cursor?: string; limit?: number; sort?: 'top' | 'latest' },
): Promise<SearchPostsResponse> {
  return xrpcGet<SearchPostsResponse>('app.bsky.feed.searchPosts', {
    q: query,
    limit: opts?.limit ?? SEARCH_LIMIT,
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
    limit: opts?.limit ?? TIMELINE_LIMIT,
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
    limit: opts?.limit ?? TIMELINE_LIMIT,
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
    limit: opts?.limit ?? AUTHOR_FEED_LIMIT,
    cursor: opts?.cursor,
    filter: opts?.filter ?? 'posts_no_replies',
  });
}

export async function getPosts(uris: string[]): Promise<{ posts: PostView[] }> {
  if (uris.length === 0) return { posts: [] };

  const chunks: PostView[][] = [];
  for (let i = 0; i < uris.length; i += POST_URI_CHUNK_SIZE) {
    const chunk = uris.slice(i, i + POST_URI_CHUNK_SIZE);
    const params: Record<string, string> = {};
    chunk.forEach((u, j) => { params[`uris[${j}]`] = u; });
    const res = getOAuthSession()
      ? await xrpcSessionGet<{ posts: PostView[] }>('app.bsky.feed.getPosts', params)
      : await xrpcGet<{ posts: PostView[] }>('app.bsky.feed.getPosts', params);
    chunks.push(res.posts);
  }

  return { posts: chunks.flat() };
}

export function getPostUri(did: string, rkey: string): string {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

export function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } | null {
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { repo: m[1], collection: m[2], rkey: m[3] };
}
