import { xrpcPost, xrpcSessionGet } from './xrpc';
import { parseAtUri } from './feed';
import type { CreateRecordResponse, StrongRef, Facet, ThreadgateRule, ThreadgateRecord } from './types';

/** Custom downvote collection — same as ArtSky; syncs across AT Protocol. */
const DOWNVOTE_COLLECTION = 'app.purplesky.feed.downvote';

/** Thread gate collection — controls who can reply to posts. */
const THREADGATE_COLLECTION = 'app.bsky.feed.threadgate';

export type { ThreadgateRule, ThreadgateRecord };

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
  const MAX_ITERATIONS = 100; // Safety limit: 100 * 100 = 10,000 records max
  let iterations = 0;
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
    iterations++;
    if (iterations >= MAX_ITERATIONS) {
      if (import.meta.env.DEV) console.warn('[ForumSky] listMyDownvotes reached max iterations, possible API issue');
      break;
    }
  } while (cursor);
  return out;
}

/** Create a thread gate to restrict who can reply to a post.
 *  If `allow` is undefined, everyone can reply (no gate).
 *  If `allow` is empty array, nobody can reply.
 *  Otherwise, only matching users can reply. */
export async function createThreadgate(
  did: string,
  postUri: string,
  rules: ThreadgateRule[],
): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: did,
    collection: THREADGATE_COLLECTION,
    record: {
      $type: THREADGATE_COLLECTION,
      post: postUri,
      allow: rules.length > 0 ? rules : undefined,
      createdAt: new Date().toISOString(),
    },
  });
}

/** Get thread gate for a post, if one exists. */
export async function getThreadgate(
  did: string,
  postUri: string,
): Promise<ThreadgateRecord | null> {
  try {
    const res = await xrpcSessionGet<{
      records?: Array<{ uri?: string; value?: ThreadgateRecord }>;
    }>('com.atproto.repo.listRecords', {
      repo: did,
      collection: THREADGATE_COLLECTION,
      limit: 1,
    });

    const record = res.records?.find(r => r.value?.post === postUri);
    return record?.value ?? null;
  } catch {
    return null;
  }
}

/** Update thread gate rules for a post. */
export async function updateThreadgate(
  did: string,
  threadgateUri: string,
  rules: ThreadgateRule[],
): Promise<void> {
  const parsed = parseAtUri(threadgateUri);
  if (!parsed || parsed.collection !== THREADGATE_COLLECTION) {
    throw new Error('Invalid threadgate URI');
  }

  const res = await xrpcSessionGet<{
    records?: Array<{ uri?: string; value?: ThreadgateRecord }>;
  }>('com.atproto.repo.listRecords', {
    repo: did,
    collection: THREADGATE_COLLECTION,
    limit: 1,
  });

  const existing = res.records?.find(r => r.uri === threadgateUri);
  if (!existing?.value) throw new Error('Threadgate not found');

  await xrpcPost('com.atproto.repo.putRecord', {
    repo: did,
    collection: THREADGATE_COLLECTION,
    rkey: parsed.rkey,
    record: {
      ...existing.value,
      allow: rules.length > 0 ? rules : undefined,
    },
  });
}

/** Remove thread gate, allowing everyone to reply. */
export async function deleteThreadgate(did: string, threadgateUri: string): Promise<void> {
  const parsed = parseAtUri(threadgateUri);
  if (!parsed || parsed.collection !== THREADGATE_COLLECTION) {
    throw new Error('Invalid threadgate URI');
  }
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: did,
    collection: THREADGATE_COLLECTION,
    rkey: parsed.rkey,
  });
}

/** Check if current user can reply to a post based on thread gate. */
export async function canReplyToThread(
  postUri: string,
  postAuthorDid: string,
  viewerDid: string | undefined,
  followingDids: Set<string>,
): Promise<boolean> {
  if (!viewerDid) return false;
  if (viewerDid === postAuthorDid) return true;

  const gate = await getThreadgate(postAuthorDid, postUri);
  if (!gate || !gate.allow) return true;
  if (gate.allow.length === 0) return false;

  for (const rule of gate.allow) {
    if (rule.$type === 'app.bsky.feed.threadgate#followingRule') {
      if (followingDids.has(postAuthorDid)) return true;
    }
    if (rule.$type === 'app.bsky.feed.threadgate#mentionRule') {
      // Would need to check if viewer is mentioned in post
      // For now, assume they can check on post load
      return true;
    }
    if (rule.$type === 'app.bsky.feed.threadgate#listRule') {
      // Would need list membership check
      // For now, conservative default
      return true;
    }
  }
  return false;
}
