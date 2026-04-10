import { useState, useEffect } from 'preact/hooks';
import { listNotifications, type NotificationItem } from '@/api/notifications';
import { getPosts, parseAtUri } from '@/api/feed';
import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, threadUrl, communityUrl, SPA_ANCHOR_SHIELD } from '@/lib/router';
import { showToast, currentUser, isLoggedIn, authInitDone, sessionRestorePending } from '@/lib/store';
import { getSubscribedThreadRoots } from '@/lib/forumsky-local';
import { formatRelativeTime, formatListDateTime } from '@/lib/i18n';
import { Avatar } from '@/components/Avatar';
import { postThreadListTitle } from '@/lib/thread-title';
import { extractFirstHashtag } from '@/lib/thread-merger';
import type { PostView } from '@/api/types';

const NOTIFICATION_LIMIT = 50;
const POSTS_CHUNK = 25;
const PREVIEW_MAX = 140;

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

function isPostAtUri(uri: string | undefined): uri is string {
  if (!uri) return false;
  const p = parseAtUri(uri);
  return p?.collection === 'app.bsky.feed.post';
}

function collectPostUrisForHydration(items: NotificationItem[]): string[] {
  const uris = new Set<string>();
  for (const n of items) {
    if (isPostAtUri(n.reasonSubject)) uris.add(n.reasonSubject);
    const root = n.record?.reply?.root?.uri;
    if (isPostAtUri(root)) uris.add(root);
  }
  return [...uris];
}

function reasonMeta(reason: string): { cls: string; label: string; verb: string } {
  switch (reason) {
    case 'reply':
      return { cls: 'activity-kind--reply', label: 'Reply', verb: 'replied in thread' };
    case 'like':
      return { cls: 'activity-kind--like', label: 'Like', verb: 'liked your post' };
    case 'mention':
      return { cls: 'activity-kind--mention', label: 'Mention', verb: 'mentioned you' };
    case 'quote':
      return { cls: 'activity-kind--quote', label: 'Quote', verb: 'quoted you' };
    default:
      return { cls: 'activity-kind--other', label: reason, verb: '' };
  }
}

function truncatePreview(text: string | undefined, max: number): string | null {
  if (!text) return null;
  const line = text.replace(/\s+/g, ' ').trim().split('\n')[0] ?? '';
  if (!line) return null;
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

export function Activity() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [postByUri, setPostByUri] = useState<Record<string, PostView>>({});
  const [loading, setLoading] = useState(true);
  const [hydratingPosts, setHydratingPosts] = useState(false);
  const [subscribedOnly, setSubscribedOnly] = useState(false);
  const [exactTimeItems, setExactTimeItems] = useState<Set<string>>(new Set());
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
        const res = await listNotifications({ limit: NOTIFICATION_LIMIT });
        if (!cancelled) {
          const filtered =
            res.notifications?.filter(x =>
              x.reason === 'reply' ||
              x.reason === 'mention' ||
              x.reason === 'quote' ||
              x.reason === 'like',
            ) ?? [];
          setItems(filtered);
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

  useEffect(() => {
    if (items.length === 0) {
      setPostByUri({});
      setHydratingPosts(false);
      return;
    }
    const list = collectPostUrisForHydration(items);
    if (list.length === 0) {
      setPostByUri({});
      return;
    }
    let cancelled = false;
    setHydratingPosts(true);
    (async () => {
      const map: Record<string, PostView> = {};
      try {
        for (let i = 0; i < list.length; i += POSTS_CHUNK) {
          const chunk = list.slice(i, i + POSTS_CHUNK);
          const { posts } = await getPosts(chunk);
          if (cancelled) return;
          for (const p of posts) map[p.uri] = p;
        }
        if (!cancelled) setPostByUri(map);
      } catch {
        if (!cancelled) setPostByUri({});
      } finally {
        if (!cancelled) setHydratingPosts(false);
      }
    })();
    return () => { cancelled = true; };
  }, [items]);

  const subscribedRoots = new Set(getSubscribedThreadRoots());

  const filteredItems = subscribedOnly
    ? items.filter(n => notificationMatchesSubscribedThreads(n, subscribedRoots))
    : items;

  if (!isLoggedIn.value) {
    return (
      <div>
        <div class="breadcrumb">
          <a
            href={hrefForAppPath('/')}
            {...SPA_ANCHOR_SHIELD}
            onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}
          >
            ForumSky
          </a>
          <span class="sep">&gt;</span>
          <span>Activity</span>
        </div>
        <div class="panel empty activity-empty-panel">
          <p>Sign in to see replies, mentions, quotes, and likes from your notifications.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div class="breadcrumb">
        <a
          href={hrefForAppPath('/')}
          {...SPA_ANCHOR_SHIELD}
          onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}
        >
          ForumSky
        </a>
        <span class="sep">&gt;</span>
        <span>Activity</span>
      </div>

      <div class="panel activity-panel">
        <div class="activity-head">
          <div class="activity-head-row">
            <p class="activity-intro">
              Bluesky notifications with thread titles and post text where available. Rows open the post in ForumSky.
            </p>
            {hydratingPosts && filteredItems.length > 0 && (
              <span class="activity-hydrate-hint" aria-live="polite">
                Resolving threads…
              </span>
            )}
          </div>
          <div class="activity-filters" role="group" aria-label="Which notifications to show">
            <button
              type="button"
              class={subscribedOnly ? 'activity-filter-btn' : 'activity-filter-btn activity-filter-btn--active'}
              onClick={() => setSubscribedOnly(false)}
            >
              All
            </button>
            <button
              type="button"
              class={subscribedOnly ? 'activity-filter-btn activity-filter-btn--active' : 'activity-filter-btn'}
              onClick={() => setSubscribedOnly(true)}
            >
              Subscribed threads
            </button>
          </div>
        </div>

        {loading ? (
          <div class="activity-loading">
            <div class="spinner" />
            <span>Loading notifications…</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div class="empty activity-empty">
            <p>
              {subscribedOnly
                ? 'Nothing yet from threads you subscribe to. Use “Subscribe” on a thread to watch it here.'
                : 'No recent replies, mentions, quotes, or likes in your notifications.'}
            </p>
          </div>
        ) : (
          <ul class="activity-list">
            {filteredItems.map(n => {
              const path = notificationThreadPath(n);
              const handle = n.author.handle;
              const who = n.author.displayName || `@${handle}`;
              const { cls, label, verb } = reasonMeta(n.reason);
              const unread = n.isRead === false;
              const inSubscribed = notificationMatchesSubscribedThreads(n, subscribedRoots);
              const showSubscribedChip = !subscribedOnly && inSubscribed;

              const rootUri = n.record?.reply?.root?.uri;
              const subjectUri = n.reasonSubject;
              const rootPost =
                rootUri && isPostAtUri(rootUri) ? postByUri[rootUri] : undefined;
              const subjectPost =
                subjectUri && isPostAtUri(subjectUri) ? postByUri[subjectUri] : undefined;

              const threadAnchorPost = rootPost ?? subjectPost;
              const threadTitle = threadAnchorPost ? postThreadListTitle(threadAnchorPost) : null;
              const primaryTag = threadAnchorPost ? extractFirstHashtag(threadAnchorPost) : null;

              let previewLabel = '';
              let previewText: string | null = null;
              if (n.reason === 'like') {
                previewLabel = 'Liked post';
                previewText = subjectPost
                  ? truncatePreview(subjectPost.record.text, PREVIEW_MAX)
                  : null;
              } else {
                previewLabel =
                  n.reason === 'reply' ? 'Their reply' : n.reason === 'quote' ? 'Quote post' : 'Message';
                previewText = truncatePreview(n.record?.text, PREVIEW_MAX);
              }

              const inner = (
                <>
                  <Avatar src={n.author.avatar} alt="" size={32} className="activity-cell-avatar" />
                  <div class="activity-cell-body">
                    <div class="activity-cell-top">
                      <span class={`activity-kind ${cls}`} title={label}>
                        {label}
                      </span>
                      {showSubscribedChip && (
                        <span class="activity-subscribed-chip" title="In a thread you subscribe to">
                          Subscribed
                        </span>
                      )}
                      {unread && <span class="activity-unread-pill" aria-label="Unread">New</span>}
                      <time
                        class="activity-cell-time"
                        dateTime={n.indexedAt}
                        title={n.indexedAt}
                        onClick={() => {
                          setExactTimeItems(prev => {
                            const next = new Set(prev);
                            if (next.has(n.uri)) {
                              next.delete(n.uri);
                            } else {
                              next.add(n.uri);
                            }
                            return next;
                          });
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        {exactTimeItems.has(n.uri) ? formatListDateTime(n.indexedAt) : formatRelativeTime(n.indexedAt)}
                      </time>
                    </div>
                    <div class="activity-cell-actor">
                      <span class="activity-cell-name">{who}</span>
                      {verb ? <span class="activity-cell-verb"> {verb}</span> : null}
                      <span class="activity-cell-handle"> @{handle}</span>
                    </div>
                    {threadTitle && (
                      <div class="activity-cell-thread">
                        <span class="activity-cell-thread-label">Thread</span>
                        <span class="activity-cell-thread-title">{threadTitle}</span>
                        {primaryTag && (
                          <>
                            <span class="activity-cell-thread-sep" aria-hidden>
                              ·
                            </span>
                            <span
                              class="activity-cell-tag"
                              role="link"
                              tabIndex={0}
                              title={`Open #${primaryTag}`}
                              onClick={(e: MouseEvent) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate(communityUrl(primaryTag));
                              }}
                              onKeyDown={(e: KeyboardEvent) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  navigate(communityUrl(primaryTag));
                                }
                              }}
                            >
                              #{primaryTag}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    {previewText && (
                      <div class="activity-cell-preview">
                        <span class="activity-cell-preview-label">{previewLabel}</span>
                        {previewText}
                      </div>
                    )}
                  </div>
                </>
              );

              if (path) {
                return (
                  <li key={n.uri} class="activity-item">
                    <a
                      href={hrefForAppPath(path)}
                      class="activity-item-link"
                      {...SPA_ANCHOR_SHIELD}
                      onClick={(e: Event) => {
                        e.preventDefault();
                        navigate(path);
                      }}
                    >
                      {inner}
                    </a>
                  </li>
                );
              }
              return (
                <li key={n.uri} class="activity-item">
                  <div class="activity-item-static">{inner}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
