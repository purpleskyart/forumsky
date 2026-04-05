import { xrpcSessionGet } from './xrpc';

export interface NotificationItem {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName?: string; avatar?: string };
  reason: string;
  reasonSubject?: string;
  record?: { text?: string; reply?: { root?: { uri: string }; parent?: { uri: string } } };
  indexedAt: string;
  isRead?: boolean;
}

export interface ListNotificationsResponse {
  notifications: NotificationItem[];
  cursor?: string;
}

export async function listNotifications(
  opts?: { limit?: number; cursor?: string },
): Promise<ListNotificationsResponse> {
  return xrpcSessionGet<ListNotificationsResponse>('app.bsky.notification.listNotifications', {
    limit: opts?.limit ?? 30,
    cursor: opts?.cursor,
  });
}
