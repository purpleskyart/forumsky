import type { FeedRootItem, PostView } from '@/api/types';

export type CommunityThreadSort = 'recent' | 'replies' | 'likes' | 'author';

export function sortFeedRootItems(items: FeedRootItem[], mode: CommunityThreadSort): FeedRootItem[] {
  const arr = [...items];
  if (mode === 'recent') {
    return arr.sort(
      (a, b) =>
        new Date(b.post.indexedAt).getTime() - new Date(a.post.indexedAt).getTime(),
    );
  }
  if (mode === 'replies') {
    return arr.sort((a, b) => (b.post.replyCount ?? 0) - (a.post.replyCount ?? 0));
  }
  if (mode === 'author') {
    return arr.sort((a, b) => {
      const ap = a.post;
      const bp = b.post;
      const ah = (ap.author.handle || ap.author.did).toLowerCase();
      const bh = (bp.author.handle || bp.author.did).toLowerCase();
      const c = ah.localeCompare(bh);
      if (c !== 0) return c;
      return new Date(bp.indexedAt).getTime() - new Date(ap.indexedAt).getTime();
    });
  }
  return arr.sort((a, b) => (b.post.likeCount ?? 0) - (a.post.likeCount ?? 0));
}

export function sortThreads(posts: PostView[], mode: CommunityThreadSort): PostView[] {
  const arr = [...posts];
  if (mode === 'recent') {
    return arr.sort((a, b) => new Date(b.indexedAt).getTime() - new Date(a.indexedAt).getTime());
  }
  if (mode === 'replies') {
    return arr.sort((a, b) => (b.replyCount ?? 0) - (a.replyCount ?? 0));
  }
  if (mode === 'author') {
    return arr.sort((a, b) => {
      const ah = (a.author.handle || a.author.did).toLowerCase();
      const bh = (b.author.handle || b.author.did).toLowerCase();
      const c = ah.localeCompare(bh);
      if (c !== 0) return c;
      return new Date(b.indexedAt).getTime() - new Date(a.indexedAt).getTime();
    });
  }
  return arr.sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0));
}
