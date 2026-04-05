import { xrpcPost } from './xrpc';
import type { StrongRef } from './types';

export async function reportPost(opts: {
  reasonType: string;
  reason?: string;
  subject: StrongRef;
}): Promise<void> {
  await xrpcPost('com.atproto.moderation.createReport', {
    reasonType: opts.reasonType,
    reason: opts.reason,
    subject: {
      $type: 'com.atproto.repo.strongRef',
      uri: opts.subject.uri,
      cid: opts.subject.cid,
    },
  });
}
