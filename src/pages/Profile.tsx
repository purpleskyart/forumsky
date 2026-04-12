import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'preact/hooks';
import { Avatar } from '@/components/Avatar';
import { FollowingFeedRow } from '@/components/FollowingFeedRow';
import { getProfile } from '@/api/actor';
import { getAuthorFeed, parseAtUri } from '@/api/feed';
import { followActor, unfollowByRecordUri } from '@/api/graph-follows';
import { XRPCError } from '@/api/xrpc';
import { swr, removeCacheEntry } from '@/lib/cache';
import { appPathname, hrefForAppPath } from '@/lib/app-base-path';
import { dominantVisibleListRowIndex } from '@/lib/dominant-visible-row';
import { navigate, threadUrl, SPA_ANCHOR_SHIELD } from '@/lib/router';
import { parseProfileRoutePath } from '@/lib/spa-route-params';
import { useRouter } from 'preact-router';
import { currentUser, showAuthDialog, showToast, followingDids } from '@/lib/store';
import { restoreScrollNow } from '@/lib/scroll-restore';
import { formatProfileJoined } from '@/lib/user-display';
import type { ProfileView, PostView, FeedViewPost } from '@/api/types';

interface ProfileProps {
  handle?: string;
}

export function Profile(props: ProfileProps) {
  const [routeCtx] = useRouter();
  const fromPath =
    typeof window !== 'undefined' ? parseProfileRoutePath(appPathname()) : {};
  const m = routeCtx.matches as Record<string, string | undefined> | null | undefined;
  const handle = props.handle ?? m?.handle ?? fromPath.handle;
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [feedItems, setFeedItems] = useState<FeedViewPost[]>([]);
  const [filter, setFilter] = useState<'posts' | 'replies' | 'all'>('posts');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [kbRow, setKbRow] = useState(0);
  const [kbRowOutlineActive, setKbRowOutlineActive] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [cursor, setCursor] = useState<string>('');
  const posts = useMemo(() => feedItems.map(f => f.post), [feedItems]);
  const [hasMore, setHasMore] = useState(true);
  const [profileAvatarFollowBusyDid, setProfileAvatarFollowBusyDid] = useState<string | null>(null);
  const postsRef = useRef<PostView[]>([]);
  const kbRowRef = useRef(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  postsRef.current = posts;
  kbRowRef.current = kbRow;

  const me = currentUser.value;

  const getFilterParam = useCallback((f: typeof filter): string => {
    switch (f) {
      case 'replies': return 'posts_with_replies';
      case 'all': return 'posts_with_media'; // Use posts_with_media to get everything including reposts
      default: return 'posts_no_replies';
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !cursor || !handle) return;
    setLoadingMore(true);
    try {
      const feedRes = await getAuthorFeed(handle!, { limit: 30, filter: getFilterParam(filter), cursor });
      setFeedItems(prev => [...prev, ...feedRes.feed]);
      setCursor(feedRes.cursor || '');
      setHasMore(!!feedRes.cursor);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to load more posts:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [handle, cursor, hasMore, loadingMore, filter, getFilterParam]);

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: '320px', threshold: 0 }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  /** Restore scroll when loadingMore completes (load more scenario). */
  const prevLoadingMoreRef = useRef(loadingMore);
  const scrollYBeforeLoadMoreRef = useRef(0);
  const wasAtBottomBeforeLoadMoreRef = useRef(false);
  useEffect(() => {
    const wasLoadingMore = prevLoadingMoreRef.current;
    prevLoadingMoreRef.current = loadingMore;

    // Save scroll state before loading more
    if (!wasLoadingMore && loadingMore) {
      scrollYBeforeLoadMoreRef.current = window.scrollY;
      wasAtBottomBeforeLoadMoreRef.current = window.scrollY + window.innerHeight >= document.body.scrollHeight - 100;
    }

    if (wasLoadingMore && !loadingMore) {
      // If user was at bottom before load, smoothly scroll to new bottom after content loads
      if (wasAtBottomBeforeLoadMoreRef.current) {
        window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: 'auto' });
      } else {
        restoreScrollNow();
      }
      // Only one additional restoration attempt to reduce jumping
      const t = window.setTimeout(() => {
        if (wasAtBottomBeforeLoadMoreRef.current) {
          window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: 'auto' });
        } else {
          restoreScrollNow();
        }
      }, 200);
      return () => {
        window.clearTimeout(t);
      };
    }
  }, [loadingMore]);

  useEffect(() => {
    if (!handle) return;
    setKbRowOutlineActive(false);
    setFeedItems([]);
    setCursor('');
    setHasMore(true);
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const sessionKey = me?.did ?? '_guest';
        const filterParam = getFilterParam(filter);
        const [profileRes, feedRes] = await Promise.all([
          swr(`profile_${handle}_${sessionKey}`, () => getProfile(handle!), 120_000),
          swr(`feed_${handle}_${filterParam}`, () => getAuthorFeed(handle!, { limit: 30, filter: filterParam }), 60_000),
        ]);
        if (cancelled) return;
        setProfile(profileRes);
        setFeedItems(feedRes.feed);
        setCursor(feedRes.cursor || '');
        setHasMore(!!feedRes.cursor);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [handle, me?.did, filter, getFilterParam]);

  useEffect(() => {
    setKbRow(i => Math.min(i, Math.max(0, posts.length - 1)));
  }, [posts.length]);


  const handleProfileAvatarFollow = useCallback(async (authorDid: string) => {
    const meDid = currentUser.value?.did;
    if (!meDid) {
      showAuthDialog.value = true;
      return;
    }
    setProfileAvatarFollowBusyDid(authorDid);
    try {
      await followActor(meDid, authorDid);
      followingDids.value = new Set(followingDids.value ?? []).add(authorDid);
    } catch (e) {
      showToast(e instanceof XRPCError ? e.message : 'Could not follow');
    } finally {
      setProfileAvatarFollowBusyDid(null);
    }
  }, []);

  useEffect(() => {
    const onPointerDown = () => {
      if (!appPathname().startsWith('/u/')) return;
      setKbRowOutlineActive(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (!appPathname().startsWith('/u/')) return;
      const tgt = e.target as HTMLElement;
      if (
        tgt.tagName === 'INPUT' ||
        tgt.tagName === 'TEXTAREA' ||
        tgt.tagName === 'SELECT' ||
        tgt.isContentEditable
      ) {
        return;
      }
      const list = postsRef.current;
      const down = e.key === 's' || e.key === 'ArrowDown' || e.key === 'd' || e.key === 'ArrowRight';
      const up = e.key === 'w' || e.key === 'ArrowUp' || e.key === 'a' || e.key === 'ArrowLeft';
      if (down || up) {
        e.preventDefault();
        setKbRowOutlineActive(true);
        const max = Math.max(0, list.length - 1);
        const anchor = dominantVisibleListRowIndex(
          list.length,
          i => `profile-feed-kb-${i}`,
          kbRowRef.current,
        );
        setKbRow(Math.min(max, Math.max(0, anchor + (down ? 1 : -1))));
        return;
      }
      if (e.key === 'e' || e.key === 'Enter') {
        e.preventDefault();
        const p = list[kbRowRef.current];
        if (!p) return;
        const parsed = parseAtUri(p.uri);
        if (!parsed) return;
        navigate(threadUrl(p.author.handle || p.author.did, parsed.rkey));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useLayoutEffect(() => {
    if (!kbRowOutlineActive) return;
    document.getElementById(`profile-feed-kb-${kbRow}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  }, [kbRow, kbRowOutlineActive]);

  const handleFollow = async () => {
    if (!me?.did) {
      showAuthDialog.value = true;
      return;
    }
    if (!profile) return;
    setFollowBusy(true);
    try {
      const res = await followActor(me.did, profile.did);
      removeCacheEntry(`profile_${handle}_${me.did}`);
      setProfile(p =>
        p
          ? {
              ...p,
              followersCount: (p.followersCount ?? 0) + 1,
              viewer: { ...p.viewer, following: res.uri },
            }
          : p,
      );
    } catch (e) {
      showToast(e instanceof XRPCError ? e.message : 'Could not follow');
    } finally {
      setFollowBusy(false);
    }
  };

  const handleUnfollow = async () => {
    if (!me?.did || !profile) return;
    const followUri = profile.viewer?.following;
    if (!followUri) return;
    setFollowBusy(true);
    try {
      await unfollowByRecordUri(me.did, followUri);
      removeCacheEntry(`profile_${handle}_${me.did}`);
      setProfile(p =>
        p
          ? {
              ...p,
              followersCount: Math.max(0, (p.followersCount ?? 0) - 1),
              viewer: { ...p.viewer, following: undefined },
            }
          : p,
      );
    } catch (e) {
      showToast(e instanceof XRPCError ? e.message : 'Could not unfollow');
    } finally {
      setFollowBusy(false);
    }
  };

  if (!handle) return <div class="empty"><p>No user specified</p></div>;

  if (error) return <div class="empty"><p>{error}</p></div>;

  const isOwnProfile = Boolean(me?.did && profile && profile.did === me.did);

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
        <span>{profile ? (profile.displayName || profile.handle) : `@${handle}`}</span>
      </div>

      <div class="panel" style="margin-bottom:16px">
        <div class="panel-body">
          {!profile && loading ? (
            <div class="loading" style="padding: 20px 0"><div class="spinner" /></div>
          ) : !profile ? (
            <div class="empty"><p>User not found</p></div>
          ) : (
            <div style="display:flex;gap:16px;align-items:center">
              <Avatar
                className="profile-header-avatar"
                src={profile.avatar}
                alt={profile.displayName || profile.handle}
                size={64}
                followPlus={
                  !isOwnProfile && !profile.viewer?.following
                    ? {
                        busy: followBusy,
                        onFollow: handleFollow,
                        title: `Follow @${profile.handle}`,
                      }
                    : undefined
                }
              />
              <div>
                <div style="font-size:1.1rem;font-weight:600;color:var(--accent)">
                  {profile.displayName || profile.handle}
                </div>
                <div style="font-size:0.82rem;color:var(--text-secondary)">@{profile.handle}</div>
                {profile.description && (
                  <div style="font-size:0.85rem;margin-top:6px;color:var(--text)">{profile.description}</div>
                )}
                <div class="profile-stats" style="display:flex;gap:12px;margin-top:6px;font-size:0.8rem;color:var(--text-muted);flex-wrap:wrap;align-items:center">
                  <span class="profile-joined">Joined {formatProfileJoined(profile.createdAt)}</span>
                  {!isOwnProfile && profile.viewer?.followedBy && (
                    <span class="profile-follows-you-badge">Follows you</span>
                  )}
                  {profile.labels && profile.labels.length > 0 && (
                    <>
                      {profile.labels.some(l => l.val === 'verified') && (
                        <span class="profile-badge-verified" title="Verified account">Verified</span>
                      )}
                      {profile.labels.some(l => l.val === 'bot') && (
                        <span class="profile-badge-bot" title="Automated account">Bot</span>
                      )}
                      {profile.labels.some(l => ['spam', 'spammy'].includes(l.val)) && (
                        <span class="profile-badge-warning" title="Flagged as spam">Spam</span>
                      )}
                      {profile.labels.some(l => ['sensitive', 'nsfw', 'adult'].includes(l.val)) && (
                        <span class="profile-badge-warning" title="Sensitive content">Sensitive</span>
                      )}
                      {profile.labels.some(l => l.val === 'impersonation') && (
                        <span class="profile-badge-warning" title="Possible impersonation">Impersonation</span>
                      )}
                    </>
                  )}
                </div>
                {!isOwnProfile && (
                  <div class="profile-follow-actions">
                    {profile.viewer?.following ? (
                      <button
                        type="button"
                        class="btn btn-outline btn-sm"
                        disabled={followBusy}
                        onClick={() => void handleUnfollow()}
                      >
                        Unfollow
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        disabled={followBusy}
                        onClick={() => void handleFollow()}
                      >
                        Follow
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div class="panel">
        <div class="panel-body" style="padding: 12px 16px; border-bottom: 1px solid var(--border)">
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button
              type="button"
              class={`btn btn-sm ${filter === 'posts' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilter('posts')}
            >
              Posts
            </button>
            <button
              type="button"
              class={`btn btn-sm ${filter === 'replies' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilter('replies')}
            >
              Posts & Replies
            </button>
            <button
              type="button"
              class={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilter('all')}
            >
              All (with Reposts)
            </button>
          </div>
        </div>
      </div>

      <div class="panel panel-following-feed-list">
        {loading && posts.length === 0 ? (
          <div class="loading" style="padding: 24px 0"><div class="spinner" /></div>
        ) : posts.length === 0 ? (
          <div class="empty"><p>No threads yet</p></div>
        ) : (
          <>
            {feedItems.map((item) => (
              <FollowingFeedRow
                key={item.post.uri}
                post={item.post}
                feedReason={item.reason}
                downvoteDisplayCount={0}
                onDownvotePost={() => {}}
                onAvatarFollow={handleProfileAvatarFollow}
                avatarFollowBusyDid={profileAvatarFollowBusyDid}
                followingAuthorDids={followingDids.value}
                viewerDid={me?.did}
              />
            ))}
            {hasMore && (
              <div ref={loadMoreRef} class="feed-load-more-wrap" style="padding: 16px; text-align: center;">
                <button
                  type="button"
                  class="btn btn-outline feed-load-more-btn"
                  disabled={loadingMore}
                  onClick={() => loadMore()}
                >
                  {loadingMore ? 'Loading\u2026' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
