import type { PostView } from '@/api/types';

/**
 * All comment post URIs that are reachable as (transitive) replies under `fromPostUri`
 * within this flat comment list (Bluesky reply parent chain).
 */
export function collectDescendantCommentUris(
  comments: { post: PostView }[],
  fromPostUri: string,
): string[] {
  const byParent = new Map<string, string[]>();
  for (const c of comments) {
    const parent = c.post.record.reply?.parent?.uri;
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(c.post.uri);
  }
  const out = new Set<string>();
  const queue = [fromPostUri];
  while (queue.length) {
    const p = queue.pop()!;
    const kids = byParent.get(p);
    if (!kids) continue;
    for (const k of kids) {
      if (!out.has(k)) {
        out.add(k);
        queue.push(k);
      }
    }
  }
  return [...out];
}
