import { useState, useEffect } from 'preact/hooks';
import { listNotifications, type NotificationItem } from '@/api/notifications';
import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, threadUrl } from '@/lib/router';
import { parseAtUri } from '@/api/feed';
import { showToast, currentUser, isLoggedIn, authInitDone, sessionRestorePending } from '@/lib/store';
import { getSubscribedThreadRoots } from '@/lib/forumsky-local';
import { formatListDateTime } from '@/lib/i18n';

function notificationThreadPath(n: NotificationItem): string | null {
  const sub = n.reasonSubject;
  if (!sub) return null;
  const parsed = parseAtUri(sub);
  if (!parsed || parsed.collection !== 'app.bsky.feed.post') return null;
  return threadUrl(parsed.repo, parsed.rkey);
}

function notificationMatchesSubscribedThreads(n: NotificationItem, subs: Set<string>): boolean {
  const root = n.record?.reply?.root?.uri;
  if (root && subs.has(root)) return true;
  const subj = n.reasonSubject;
  if (subj && subs.has(subj)) return true;
  return false;
}

export function Activity() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const authReady = authInitDone.value;
  const viewerDid = currentUser.value?.did;

  useEffect(() => {
    if (!authReady) return;
    if (!isLoggedIn.value || !viewerDid) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await listNotifications({ limit: 40 });
        if (!cancelled) {
          const replyLike =
            res.notifications?.filter(x =>
              x.reason === 'reply' ||
              x.reason === 'mention' ||
              x.reason === 'quote' ||
              x.reason === 'like',
            ) ?? [];
          setItems(replyLike);
        }
      } catch (e) {
        if (!cancelled) {
          showToast(e instanceof Error ? e.message : 'Could not load notifications');
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authReady, viewerDid]);

  const subscribedRoots = new Set(getSubscribedThreadRoots());

  const filteredItems = subscribedOnly
    ? items.filter(n => notificationMatchesSubscribedThreads(n, subscribedRoots))
    : items;

  if (sessionRestorePending()) {
    return (
      <div class="panel" style={{ padding: '48px 24px', display: 'flex', justifyContent: 'center' }}>
        <div class="loading">
          <div class="spinner" />
        </div>
      </div>
    );
  }

  if (!isLoggedIn.value) {
    return (
      <div class="panel empty" style="padding:24px">
        <p>Sign in to see replies, mentions, and likes.</p>
      </div>
    );
  }

  return (
    <div>
      <div class="breadcrumb">
        <a href={hrefForAppPath('/')} onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}>ForumSky</a>
        <span class="sep">&gt;</span>
        <span>Activity</span>
      </div>

      <div class="panel">
        <div class="panel-header activity-panel-header">
          <span>Recent activity</span>
          <label class="activity-subscribe-filter community-checkbox-label">
            <input
              type="checkbox"
              checked={subscribedOnly}
              onChange={(e: Event) => setSubscribedOnly((e.target as HTMLInputElement).checked)}
            />
            <span>Subscribed threads only</span>
          </label>
        </div>
        {loading ? (
          <div class="loading">
            <div class="spinner" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div class="empty">
            <p>
              {subscribedOnly
                ? 'No activity in subscribed threads yet. Use “Subscribe” on a thread to add it here.'
                : 'No recent replies or mentions.'}
            </p>
          </div>
        ) : (
          <ul class="activity-list">
            {filteredItems.map(n => {
              const path = notificationThreadPath(n);
              const label =
                n.reason === 'like'
                  ? 'liked a post'
                  : n.reason === 'reply'
                    ? 'replied'
                    : n.reason === 'mention'
                      ? 'mentioned you'
                      : n.reason;
              return (
                <li key={n.uri} class="activity-item">
                  <span class="activity-reason">{label}</span>
                  {' · '}
                  <span class="activity-author">@{n.author.handle}</span>
                  {path && (
                    <>
                      {' · '}
                      <a
                        href={hrefForAppPath(path)}
                        onClick={(e: Event) => {
                          e.preventDefault();
                          navigate(path);
                        }}
                      >
                        Open thread
                      </a>
                    </>
                  )}
                  <div class="activity-time">{formatListDateTime(n.indexedAt)}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
