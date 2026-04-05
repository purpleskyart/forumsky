import type { PostView } from '@/api/types';

/** Max length for the first line before list UI truncates with "…" (matches ThreadRow). */
export const THREAD_TITLE_PREVIEW_MAX_CHARS = 90;

/** Display string for a thread’s first line in lists and headers. */
export function formatThreadTitlePreviewLine(firstLine: string): string {
  if (!firstLine) return '(untitled)';
  if (firstLine.length > THREAD_TITLE_PREVIEW_MAX_CHARS) {
    return firstLine.slice(0, THREAD_TITLE_PREVIEW_MAX_CHARS - 3) + '...';
  }
  return firstLine;
}

/** Thread list title from the root post (first line of text). */
export function postThreadListTitle(post: PostView): string {
  const firstLine = post.record.text.split('\n')[0] ?? '';
  return formatThreadTitlePreviewLine(firstLine);
}
