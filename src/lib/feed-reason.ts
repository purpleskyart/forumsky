import type { FeedViewPost, ProfileView } from '@/api/types';

const REASON_REPOST = 'app.bsky.feed.defs#reasonRepost';

/** Profile of the account whose repost surfaced this post in Following (timeline / feeds). */
export function repostAttributionFromReason(
  reason?: FeedViewPost['reason'],
): ProfileView | undefined {
  if (!reason || reason.$type !== REASON_REPOST || !reason.by) return undefined;
  return reason.by;
}
