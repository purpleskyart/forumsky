import type { Label, PostView } from '@/api/types';

function labelValIndicatesNsfw(val: string): boolean {
  const c = val.replace(/^[!]+/, '').toLowerCase().trim();
  if (!c) return false;
  if (['adult', 'sexual', 'nudity', 'nsfw'].includes(c)) return true;
  if (c.includes('sexual') || c.includes('nsfw')) return true;
  if (c === 'graphic-media' || c.includes('graphic-media')) return true;
  return false;
}

export function labelsIncludeNsfw(labels: Label[] | undefined): boolean {
  if (!labels?.length) return false;
  return labels.some(L => L.val && labelValIndicatesNsfw(L.val));
}

/** True when the post or its author carries a moderation label treated as adult / sensitive media. */
export function postHasNsfwLabels(post: Pick<PostView, 'labels' | 'author'>): boolean {
  if (labelsIncludeNsfw(post.labels)) return true;
  if (labelsIncludeNsfw(post.author?.labels)) return true;
  return false;
}
