import { xrpcPost, xrpcSessionGet } from './xrpc';
import { parseAtUri } from './feed';
import type { CreateRecordResponse, StrongRef, Facet } from './types';

/** Custom downvote collection — same as ArtSky; syncs across AT Protocol. */
const DOWNVOTE_COLLECTION = 'app.purplesky.feed.downvote';

export async function createPost(opts: {
  text: string;
  reply?: { root: StrongRef; parent: StrongRef };
  facets?: Facet[];
  embed?: unknown;
}): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: '', // filled by session DID
    collection: 'app.bsky.feed.post',
    record: {
      $type: 'app.bsky.feed.post',
      text: opts.text,
      createdAt: new Date().toISOString(),
      reply: opts.reply,
      facets: opts.facets,
      embed: opts.embed,
    },
  });
}

export async function createPostWithDid(
  did: string,
  opts: {
    text: string;
    reply?: { root: StrongRef; parent: StrongRef };
    facets?: Facet[];
    embed?: unknown;
  },
): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: did,
    collection: 'app.bsky.feed.post',
    record: {
      $type: 'app.bsky.feed.post',
      text: opts.text,
      createdAt: new Date().toISOString(),
      reply: opts.reply,
      facets: opts.facets,
      embed: opts.embed,
    },
  });
}

export async function deletePost(did: string, rkey: string): Promise<void> {
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: did,
    collection: 'app.bsky.feed.post',
    rkey,
  });
}

export async function likePost(
  did: string,
  subject: StrongRef,
): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: did,
    collection: 'app.bsky.feed.like',
    record: {
      $type: 'app.bsky.feed.like',
      subject,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function unlikePost(did: string, rkey: string): Promise<void> {
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: did,
    collection: 'app.bsky.feed.like',
    rkey,
  });
}

export async function repostPost(
  did: string,
  subject: StrongRef,
): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: did,
    collection: 'app.bsky.feed.repost',
    record: {
      $type: 'app.bsky.feed.repost',
      subject,
      createdAt: new Date().toISOString(),
    },
  });
}

export async function unrepostPost(did: string, rkey: string): Promise<void> {
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: did,
    collection: 'app.bsky.feed.repost',
    rkey,
  });
}

/** Create a downvote record for a post. Returns the new record URI. */
export async function createDownvote(did: string, subject: StrongRef): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: did,
    collection: DOWNVOTE_COLLECTION,
    record: {
      $type: DOWNVOTE_COLLECTION,
      subject,
      createdAt: new Date().toISOString(),
    },
  });
}

/** Remove a downvote by full AT URI of the downvote record. */
export async function deleteDownvote(downvoteRecordUri: string, actorDid: string): Promise<void> {
  const parsed = parseAtUri(downvoteRecordUri);
  if (!parsed || parsed.collection !== DOWNVOTE_COLLECTION) {
    throw new Error('Invalid downvote URI');
  }
  if (parsed.repo !== actorDid) {
    throw new Error('You can only remove your own downvotes');
  }
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: parsed.repo,
    collection: DOWNVOTE_COLLECTION,
    rkey: parsed.rkey,
  });
}

/** Subject post URI → downvote record URI for the signed-in user. */
export async function listMyDownvotes(did: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let cursor: string | undefined;
  do {
    const res = await xrpcSessionGet<{
      records?: Array<{ uri?: string; value?: { subject?: { uri?: string } } }>;
      cursor?: string;
    }>('com.atproto.repo.listRecords', {
      repo: did,
      collection: DOWNVOTE_COLLECTION,
      limit: 100,
      cursor,
    });
    for (const r of res.records ?? []) {
      const subjectUri = r.value?.subject?.uri;
      if (subjectUri && r.uri) out[subjectUri] = r.uri;
    }
    cursor = res.cursor;
  } while (cursor);
  return out;
}
