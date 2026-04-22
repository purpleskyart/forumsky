import type { ThreadViewPost, PostView } from '@/api/types';
import { isThreadViewPost } from '@/api/types';
import { parseRichText } from '@/lib/richtext';
import { THREAD_MERGER_CACHE_MAX_SIZE } from '@/lib/constants';

// Cache for mergeThread results to avoid re-processing the same thread
// Using a Map instead of WeakMap to have control over cache size
const mergeCache = new Map<ThreadViewPost, MergedThread>();

// Track access order for LRU eviction
const accessOrder: ThreadViewPost[] = [];

/** Get from cache with LRU tracking */
function getFromCache(thread: ThreadViewPost): MergedThread | undefined {
  const result = mergeCache.get(thread);
  if (result) {
    // Update access order (move to end = most recently used)
    const index = accessOrder.indexOf(thread);
    if (index > -1) {
      accessOrder.splice(index, 1);
      accessOrder.push(thread);
    }
  }
  return result;
}

/** Set in cache with LRU eviction */
function setInCache(thread: ThreadViewPost, result: MergedThread) {
  // Evict oldest entries if at capacity
  while (mergeCache.size >= THREAD_MERGER_CACHE_MAX_SIZE && accessOrder.length > 0) {
    const oldest = accessOrder.shift();
    if (oldest) {
      mergeCache.delete(oldest);
    }
  }

  mergeCache.set(thread, result);
  accessOrder.push(thread);
}

export interface ForumPost {
  /** All merged post segments (self-replies by the OP concatenated) */
  segments: PostView[];
  /** Combined text from all segments */
  text: string;
  /** The root post */
  root: PostView;
}

export interface ForumComment {
  post: PostView;
  /** If the commenter also self-replied, merge those too */
  segments: PostView[];
  text: string;
  depth: number;
}

export interface MergedThread {
  forumPost: ForumPost;
  comments: ForumComment[];
  /** Total unique commenters */
  commenterCount: number;
  /** Most recent activity timestamp */
  lastActivity: string;
}

/** A thread reply whose Bluesky parent is a specific post URI */
export interface DirectReplyLink {
  uri: string;
  postNumber: number;
  handle: string;
}

/**
 * Maps parent post URI → direct replies (Bluesky `reply.parent`) to that URI.
 * Used to show “&gt;&gt;” child links under each merged post block.
 */
/** Reddit-style tree: each node is a merged comment and its direct nested replies. */
export interface CommentTreeNode {
  comment: ForumComment;
  children: CommentTreeNode[];
}

/**
 * Group comments under their Bluesky reply parent (OP segments or another comment’s segments).
 * Top level = parent URI is any OP segment; unknown parents are treated as top level.
 */
export function buildNestedCommentTree(
  comments: ForumComment[],
  opSegments: PostView[],
): CommentTreeNode[] {
  const opUriSet = new Set(opSegments.map(s => s.uri));
  const uriToOwner = new Map<string, ForumComment>();
  for (const c of comments) {
    for (const seg of c.segments) {
      uriToOwner.set(seg.uri, c);
    }
  }

  const childrenByParentKey = new Map<string, ForumComment[]>();
  const topLevel: ForumComment[] = [];

  for (const c of comments) {
    const parentUri = c.post.record.reply?.parent?.uri;
    if (!parentUri) {
      topLevel.push(c);
      continue;
    }
    if (opUriSet.has(parentUri)) {
      topLevel.push(c);
      continue;
    }
    const parentComment = uriToOwner.get(parentUri);
    if (parentComment && parentComment.post.uri !== c.post.uri) {
      const key = parentComment.post.uri;
      const arr = childrenByParentKey.get(key) ?? [];
      arr.push(c);
      childrenByParentKey.set(key, arr);
    } else {
      topLevel.push(c);
    }
  }

  const sortChrono = (a: ForumComment, b: ForumComment) =>
    new Date(a.post.record.createdAt).getTime() -
    new Date(b.post.record.createdAt).getTime();

  topLevel.sort(sortChrono);
  for (const arr of childrenByParentKey.values()) {
    arr.sort(sortChrono);
  }

  function buildNode(c: ForumComment): CommentTreeNode {
    const rawKids = childrenByParentKey.get(c.post.uri) ?? [];
    const children = rawKids.map(buildNode);
    return { comment: c, children };
  }

  return topLevel.map(buildNode);
}

export function buildDirectRepliesByParentUri(
  comments: ForumComment[],
): Map<string, DirectReplyLink[]> {
  const map = new Map<string, DirectReplyLink[]>();
  comments.forEach((comment, idx) => {
    const parentUri = comment.post.record.reply?.parent?.uri;
    if (!parentUri) return;
    const link: DirectReplyLink = {
      uri: comment.post.uri,
      postNumber: idx + 2,
      handle: comment.post.author.handle,
    };
    const list = map.get(parentUri) ?? [];
    list.push(link);
    map.set(parentUri, list);
  });
  return map;
}

/**
 * All distinct direct replies to any Bluesky post in this merged block (OP or comment segments).
 */
export function getChildRepliesForSegments(
  segments: PostView[],
  directRepliesByParentUri: Map<string, DirectReplyLink[]>,
): DirectReplyLink[] {
  const merged: DirectReplyLink[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    for (const link of directRepliesByParentUri.get(seg.uri) ?? []) {
      if (!seen.has(link.uri)) {
        seen.add(link.uri);
        merged.push(link);
      }
    }
  }
  merged.sort((a, b) => a.postNumber - b.postNumber);
  return merged;
}

/** Maps every post URI in the merged thread (OP segments + comment segments) to its PostView and display post number. */
export function buildThreadPostIndex(thread: MergedThread): {
  postByUri: Map<string, PostView>;
  postNumberByUri: Map<string, number>;
} {
  const postByUri = new Map<string, PostView>();
  const postNumberByUri = new Map<string, number>();
  for (const seg of thread.forumPost.segments) {
    postByUri.set(seg.uri, seg);
    postNumberByUri.set(seg.uri, 1);
  }
  thread.comments.forEach((c, idx) => {
    const n = idx + 2;
    for (const seg of c.segments) {
      postByUri.set(seg.uri, seg);
      postNumberByUri.set(seg.uri, n);
    }
  });
  return { postByUri, postNumberByUri };
}

/**
 * Walk a ThreadViewPost tree and produce a forum-style view:
 * - OP self-reply chains become one merged ForumPost
 * - All other replies become chronological ForumComments
 */
export function mergeThread(thread: ThreadViewPost): MergedThread {
  // Check cache first
  const cached = getFromCache(thread);
  if (cached) return cached;

  const root = thread.post;
  const opDid = root.author.did;

  // Collect OP self-reply chain starting from root
  const opSegments: PostView[] = [root];
  collectSelfReplies(thread, opDid, opSegments);

  const forumPost: ForumPost = {
    segments: opSegments,
    text: opSegments.map(s => s.record.text).join('\n\n'),
    root,
  };

  // Collect all non-OP replies as comments
  const comments: ForumComment[] = [];
  const seenUris = new Set(opSegments.map(s => s.uri));
  collectComments(thread, seenUris, comments, 0);

  // Sort comments chronologically
  comments.sort((a, b) =>
    new Date(a.post.record.createdAt).getTime() -
    new Date(b.post.record.createdAt).getTime()
  );

  const commenterDids = new Set(comments.map(c => c.post.author.did));
  const lastActivity = comments.length > 0
    ? comments[comments.length - 1].post.record.createdAt
    : root.record.createdAt;

  const result: MergedThread = { forumPost, comments, commenterCount: commenterDids.size, lastActivity };
  setInCache(thread, result);
  return result;
}

/**
 * Walk down collecting direct self-replies from the same author.
 * Only follows the first self-reply at each level to maintain a linear chain.
 */
function collectSelfReplies(
  node: ThreadViewPost,
  opDid: string,
  segments: PostView[],
) {
  if (!node.replies) return;
  for (const reply of node.replies) {
    if (!isThreadViewPost(reply)) continue;
    if (reply.post.author.did === opDid) {
      segments.push(reply.post);
      collectSelfReplies(reply, opDid, segments);
      return; // only follow one self-reply branch
    }
  }
}

/**
 * Recursively collect all non-OP posts as comments.
 * Also merges self-reply chains within comments.
 */
function collectComments(
  node: ThreadViewPost,
  seenUris: Set<string>,
  comments: ForumComment[],
  depth: number,
) {
  if (!node.replies) return;
  for (const reply of node.replies) {
    if (!isThreadViewPost(reply)) continue;
    if (seenUris.has(reply.post.uri)) continue;
    seenUris.add(reply.post.uri);

    // Collect commenter's self-reply chain
    const commentSegments: PostView[] = [reply.post];
    const commentAuthor = reply.post.author.did;
    collectCommenterSelfReplies(reply, commentAuthor, commentSegments, seenUris);

    comments.push({
      post: reply.post,
      segments: commentSegments,
      text: commentSegments.map(s => s.record.text).join('\n\n'),
      depth,
    });

    // Continue collecting deeper replies
    collectComments(reply, seenUris, comments, depth + 1);
  }
}

function collectCommenterSelfReplies(
  node: ThreadViewPost,
  authorDid: string,
  segments: PostView[],
  seenUris: Set<string>,
) {
  if (!node.replies) return;
  for (const reply of node.replies) {
    if (!isThreadViewPost(reply)) continue;
    if (reply.post.author.did === authorDid && !seenUris.has(reply.post.uri)) {
      seenUris.add(reply.post.uri);
      segments.push(reply.post);
      collectCommenterSelfReplies(reply, authorDid, segments, seenUris);
      return;
    }
  }
}

/**
 * First community tag in post text (by UTF-8 byte order in facets), not facet array order.
 * Only supports !tag syntax (legacy #tag is not recognized as community posts).
 */
export function extractFirstHashtag(post: PostView): string | null {
  const segments = parseRichText(post.record.text, post.record.facets);
  for (const seg of segments) {
    if (seg.type === 'tag' && seg.tag && seg.text.startsWith('!')) return seg.tag;
  }
  if (post.record.tags?.length) {
    for (const tag of post.record.tags) {
      if (tag.startsWith('!')) return tag;
    }
  }
  const m = /!([a-zA-Z0-9_]+)/.exec(post.record.text);
  return m ? m[1] : null;
}

/** Thread root belongs in a community only when !tag matches the community name. */
export function postPrimaryHashtagMatches(post: PostView, communityTag: string): boolean {
  const first = extractFirstHashtag(post);
  if (!first) return false;
  return first.toLowerCase() === communityTag.trim().toLowerCase();
}

/** Clear the mergeThread cache - useful when thread data is known to have changed */
export function clearMergeCache(): void {
  mergeCache.clear();
  accessOrder.length = 0;
}

/** Get current cache size for debugging */
export function getMergeCacheSize(): number {
  return mergeCache.size;
}
