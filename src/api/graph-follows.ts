import { xrpcPost, xrpcSessionGet } from './xrpc';
import { parseAtUri } from './feed';
import type { CreateRecordResponse } from './types';
import { currentUser } from '@/lib/store';

interface FollowsPage {
  follows?: { did: string; handle: string }[];
  cursor?: string;
}

export async function listAllFollowingDids(): Promise<Set<string>> {
  const self = currentUser.value?.did;
  if (!self) return new Set();
  const out = new Set<string>();
  let cursor: string | undefined;
  do {
    const res = await xrpcSessionGet<FollowsPage>('app.bsky.graph.getFollows', {
      actor: self,
      limit: 100,
      cursor,
    });
    for (const f of res.follows ?? []) out.add(f.did);
    cursor = res.cursor;
  } while (cursor);
  return out;
}

export async function followActor(
  selfDid: string,
  subjectDid: string,
): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: selfDid,
    collection: 'app.bsky.graph.follow',
    record: {
      $type: 'app.bsky.graph.follow',
      subject: subjectDid,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function unfollowByRecordUri(selfDid: string, followRecordUri: string): Promise<void> {
  const parsed = parseAtUri(followRecordUri);
  if (!parsed?.rkey) throw new Error('Invalid follow record URI');
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: selfDid,
    collection: 'app.bsky.graph.follow',
    rkey: parsed.rkey,
  });
}
