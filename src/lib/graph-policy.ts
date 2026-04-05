import { xrpcSessionGet } from '@/api/xrpc';
import { mutedDids, blockedDids } from '@/lib/store';

interface MutesPage {
  mutes?: { did: string }[];
  cursor?: string;
}

interface BlocksPage {
  blocks?: { did: string }[];
  cursor?: string;
}

/** Load full mute + block lists into signals (best-effort). */
export async function refreshGraphPolicy(): Promise<void> {
  const m = new Set<string>();
  const b = new Set<string>();
  try {
    let cursor: string | undefined;
    do {
      const res = await xrpcSessionGet<MutesPage>('app.bsky.graph.getMutes', {
        limit: 100,
        cursor,
      });
      for (const raw of res.mutes ?? []) {
        const u = raw as { did?: string };
        if (u.did) m.add(u.did);
      }
      cursor = res.cursor;
    } while (cursor);
  } catch {
    /* guest or API error */
  }
  try {
    let cursor: string | undefined;
    do {
      const res = await xrpcSessionGet<BlocksPage>('app.bsky.graph.getBlocks', {
        limit: 100,
        cursor,
      });
      for (const raw of res.blocks ?? []) {
        const u = raw as { did?: string; subject?: { did?: string } };
        const did = u.did ?? u.subject?.did;
        if (did) b.add(did);
      }
      cursor = res.cursor;
    } while (cursor);
  } catch {
    /* guest or API error */
  }
  mutedDids.value = m;
  blockedDids.value = b;
}

export function clearGraphPolicy() {
  mutedDids.value = new Set();
  blockedDids.value = new Set();
}

export function isAuthorFiltered(did: string): boolean {
  return mutedDids.value.has(did) || blockedDids.value.has(did);
}
