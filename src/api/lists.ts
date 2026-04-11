import { xrpcPost, xrpcSessionGet } from './xrpc';
import { parseAtUri } from './feed';
import type { CreateRecordResponse, ProfileView, ListRecord, ListItemRecord, ListView, ListItemView, ListPurpose } from './types';

/** Graph list collection — curated groups of users. */
const LIST_COLLECTION = 'app.bsky.graph.list';
const LIST_ITEM_COLLECTION = 'app.bsky.graph.listitem';
const LIST_BLOCK_COLLECTION = 'app.bsky.graph.listblock';

export type { ListRecord, ListItemRecord, ListView, ListItemView, ListPurpose };

/** Create a new list (curation or moderation). */
export async function createList(
  did: string,
  opts: {
    name: string;
    purpose: ListPurpose;
    description?: string;
    avatar?: ListRecord['avatar'];
  },
): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: did,
    collection: LIST_COLLECTION,
    record: {
      $type: LIST_COLLECTION,
      name: opts.name,
      purpose: opts.purpose,
      description: opts.description,
      avatar: opts.avatar,
      createdAt: new Date().toISOString(),
    },
  });
}

/** Update list metadata. */
export async function updateList(
  did: string,
  listUri: string,
  opts: {
    name?: string;
    description?: string;
    avatar?: ListRecord['avatar'];
  },
): Promise<void> {
  const parsed = parseAtUri(listUri);
  if (!parsed || parsed.collection !== LIST_COLLECTION) {
    throw new Error('Invalid list URI');
  }

  const res = await xrpcSessionGet<{
    records?: Array<{ uri?: string; value?: ListRecord }>;
  }>('com.atproto.repo.listRecords', {
    repo: did,
    collection: LIST_COLLECTION,
    limit: 1,
  });

  const existing = res.records?.find(r => r.uri === listUri);
  if (!existing?.value) throw new Error('List not found');

  await xrpcPost('com.atproto.repo.putRecord', {
    repo: did,
    collection: LIST_COLLECTION,
    rkey: parsed.rkey,
    record: {
      ...existing.value,
      ...(opts.name && { name: opts.name }),
      ...(opts.description !== undefined && { description: opts.description }),
      ...(opts.avatar && { avatar: opts.avatar }),
    },
  });
}

/** Delete a list and all its items. */
export async function deleteList(did: string, listUri: string): Promise<void> {
  const parsed = parseAtUri(listUri);
  if (!parsed || parsed.collection !== LIST_COLLECTION) {
    throw new Error('Invalid list URI');
  }
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: did,
    collection: LIST_COLLECTION,
    rkey: parsed.rkey,
  });
}

/** Get all lists for a user. */
export async function getLists(did: string): Promise<ListView[]> {
  try {
    const res = await xrpcSessionGet<{
      lists?: ListView[];
    }>('app.bsky.graph.getLists', {
      actor: did,
      limit: 100,
    });
    return res.lists ?? [];
  } catch {
    return [];
  }
}

/** Get a single list with its items. */
export async function getList(listUri: string, opts?: { cursor?: string; limit?: number }): Promise<{
  list: ListView | null;
  items: ListItemView[];
  cursor?: string;
}> {
  try {
    const res = await xrpcSessionGet<{
      list?: ListView;
      items?: ListItemView[];
      cursor?: string;
    }>('app.bsky.graph.getList', {
      list: listUri,
      limit: opts?.limit ?? 100,
      cursor: opts?.cursor,
    });
    return {
      list: res.list ?? null,
      items: res.items ?? [],
      cursor: res.cursor,
    };
  } catch {
    return { list: null, items: [] };
  }
}

/** Add a user to a list. */
export async function addUserToList(
  did: string,
  listUri: string,
  subjectDid: string,
): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: did,
    collection: LIST_ITEM_COLLECTION,
    record: {
      $type: LIST_ITEM_COLLECTION,
      subject: subjectDid,
      list: listUri,
      createdAt: new Date().toISOString(),
    },
  });
}

/** Remove a user from a list. */
export async function removeUserFromList(did: string, itemUri: string): Promise<void> {
  const parsed = parseAtUri(itemUri);
  if (!parsed || parsed.collection !== LIST_ITEM_COLLECTION) {
    throw new Error('Invalid list item URI');
  }
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: did,
    collection: LIST_ITEM_COLLECTION,
    rkey: parsed.rkey,
  });
}

/** Block all users in a list (moderation list). */
export async function blockList(did: string, listUri: string): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: did,
    collection: LIST_BLOCK_COLLECTION,
    record: {
      $type: LIST_BLOCK_COLLECTION,
      subject: listUri,
      createdAt: new Date().toISOString(),
    },
  });
}

/** Unblock a list. */
export async function unblockList(did: string, blockUri: string): Promise<void> {
  const parsed = parseAtUri(blockUri);
  if (!parsed || parsed.collection !== LIST_BLOCK_COLLECTION) {
    throw new Error('Invalid list block URI');
  }
  await xrpcPost('com.atproto.repo.deleteRecord', {
    repo: did,
    collection: LIST_BLOCK_COLLECTION,
    rkey: parsed.rkey,
  });
}

/** Check if a user is in a list (requires fetching all items). */
export async function isUserInList(listUri: string, targetDid: string): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await getList(listUri, { cursor, limit: 100 });
    for (const item of page.items) {
      if (item.subject.did === targetDid) return true;
    }
    cursor = page.cursor;
  } while (cursor);
  return false;
}

/** Get all moderation lists that a user is blocked by. */
export async function getListBlocks(did: string): Promise<string[]> {
  try {
    const res = await xrpcSessionGet<{
      blocks?: Array<{ uri: string; subject: string }>;
    }>('app.bsky.graph.getListBlocks', {
      limit: 100,
    });
    return res.blocks?.map(b => b.subject) ?? [];
  } catch {
    return [];
  }
}
