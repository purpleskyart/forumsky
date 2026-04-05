import { xrpcPost } from './xrpc';
import type { CreateRecordResponse } from './types';

/** Mutes an account (handle or DID). Mutes are private on Bluesky. */
export async function muteActor(actor: string): Promise<void> {
  await xrpcPost('app.bsky.graph.muteActor', { actor });
}

export async function blockActor(
  viewerDid: string,
  subjectDid: string,
): Promise<CreateRecordResponse> {
  return xrpcPost<CreateRecordResponse>('com.atproto.repo.createRecord', {
    repo: viewerDid,
    collection: 'app.bsky.graph.block',
    record: {
      $type: 'app.bsky.graph.block',
      subject: subjectDid,
      createdAt: new Date().toISOString(),
    },
  });
}
