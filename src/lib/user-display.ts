/** Deterministic accent index for consistent username coloring per handle. */

export function toneIndexForHandle(handle: string): number {
  let h = 0;
  for (let i = 0; i < handle.length; i++) {
    h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  }
  return h % 5;
}

/** Profile sidebar stats (thread view + following feed). */
export function formatProfileStatCount(n?: number): string {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString();
}

export function formatProfileJoined(createdAt?: string): string {
  if (!createdAt) return '—';
  const d = new Date(createdAt);
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}
