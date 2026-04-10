import { xrpcSessionGet } from '@/api/xrpc';
import { mutedDids, blockedDids, followingDids, currentUser } from '@/lib/store';

interface MutesPage {
  mutes?: { did: string }[];
  cursor?: string;
}

interface BlocksPage {
  blocks?: { did: string }[];
  cursor?: string;
}

interface FollowsPage {
  follows?: { did: string }[];
  cursor?: string;
}

async function fetchAllMutes(): Promise<Set<string>> {
  const m = new Set<string>();
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
  return m;
}

async function fetchAllBlocks(): Promise<Set<string>> {
  const b = new Set<string>();
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
  return b;
}

async function fetchAllFollows(selfDid: string | undefined): Promise<Set<string>> {
  const f = new Set<string>();
  if (!selfDid) return f;
  try {
    let cursor: string | undefined;
    do {
      const res = await xrpcSessionGet<FollowsPage>('app.bsky.graph.getFollows', {
        actor: selfDid,
        limit: 100,
        cursor,
      });
      for (const raw of res.follows ?? []) {
        const u = raw as { did?: string };
        if (u.did) f.add(u.did);
      }
      cursor = res.cursor;
    } while (cursor);
  } catch {
    /* guest or API error */
  }
  return f;
}

/** Load full mute + block + following lists into signals concurrently (best-effort). */
export async function refreshGraphPolicy(): Promise<void> {
  const self = currentUser.value?.did;
  const [m, b, f] = await Promise.all([
    fetchAllMutes(),
    fetchAllBlocks(),
    fetchAllFollows(self),
  ]);
  mutedDids.value = m;
  blockedDids.value = b;
  followingDids.value = f;
}

export function clearGraphPolicy() {
  mutedDids.value = new Set();
  blockedDids.value = new Set();
  followingDids.value = new Set();
}

export function isAuthorFiltered(did: string): boolean {
  return mutedDids.value.has(did) || blockedDids.value.has(did);
}
