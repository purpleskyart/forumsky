import { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'preact/hooks';
import { ThreadRow, threadRowUnreadReplies } from '@/components/ThreadRow';
import { FollowingFeedRow } from '@/components/FollowingFeedRow';
import { Composer } from '@/components/Composer';
import { searchByTag, getTimeline } from '@/api/feed';
import { FollowingFeedMixPanel } from '@/components/FollowingFeedMixPanel';
import { postPrimaryHashtagMatches } from '@/lib/thread-merger';
import {
  isThreadHidden, hideThread,
  getCommunities, FOLLOWED_COMMUNITY, FOLLOWED_COMMUNITY_TAG,
  getCommunityThreadSort, setCommunityThreadSort,
  getFollowingFeedBlend,
  TIMELINE_BLEND_SOURCE_ID,
} from '@/lib/preferences';
import {
  activeBlendSources,
  createFollowingBlendRuntime,
  createFollowingMergeRuntime,
  dedupeFeedRootItemsByUri,
  extendMergedFollowingPool,
  extendRecentBlendedPool,
  followingBlendHasMore,
} from '@/lib/following-feed-blend';
import {
  touchCommunityLastLeftAt,
} from '@/lib/forumsky-local';
import { sortFeedRootItems, sortThreads, type CommunityThreadSort } from '@/lib/thread-sort';
import { getDownvoteCounts } from '@/lib/constellation';
import { createDownvote, deleteDownvote, listMyDownvotes } from '@/api/post';
import { followActor } from '@/api/graph-follows';
import { XRPCError } from '@/api/xrpc';
import { showAuthDialog, showToast, currentUser, isLoggedIn, followingDids } from '@/lib/store';
import { appPathname, hrefForAppPath } from '@/lib/app-base-path';
import { navigate, threadUrl, SPA_ANCHOR_SHIELD } from '@/lib/router';
import { parseCommunityRoutePath } from '@/lib/spa-route-params';
import { useRouter } from 'preact-router';
import { parseAtUri } from '@/api/feed';
import { isAuthorFiltered } from '@/lib/graph-policy';
import { dominantVisibleListRowIndex } from '@/lib/dominant-visible-row';
import { restoreScrollNow } from '@/lib/scroll-restore';
import type { FeedBlendSourceMeta, FeedRootItem, PostView, ProfileView } from '@/api/types';

const THREADS_PER_PAGE = 25;
/** Max timeline pages to scan on first paint (each ~100 items; not all are thread roots). */
const TIMELINE_INITIAL_MAX_ROUNDS = 3;
/** Bluesky search returns any post mentioning #tag; scan this many batches to fill a page after filtering to primary tag only. */
const FILTER_MAX_ROUNDS = 15;

/** Cached feed state so back-navigation renders instantly (scroll restoration needs content in the DOM). */
interface FeedSnapshot {
  posts: PostView[];
  page: number;
  totalHits: number;
  sortMode: CommunityThreadSort;
  followingPool: FeedRootItem[];
  /** Recent / likes / author: overflow + API cursor so "load more" continues after restore. */
  matchedBuffer?: PostView[];
  searchApiCursor?: string;
  /** Replies sort: same for continuation. */
  replyPool?: PostView[];
  replyApiCursor?: string;
}
const feedSnapshots = new Map<string, FeedSnapshot>();

function initialCursorFromFeedSnapshot(s: FeedSnapshot | undefined): string | undefined {
  if (!s) return undefined;
  return s.sortMode === 'replies' ? s.replyApiCursor : s.searchApiCursor;
}

interface CommunityProps {
  tag?: string;
}

function useCommunityTagProp(propsTag?: string): string | undefined {
  const [routeCtx] = useRouter();
  const fromPath =
    typeof window !== 'undefined' ? parseCommunityRoutePath(appPathname()) : {};
  const m = routeCtx.matches as Record<string, string | undefined> | null | undefined;
  return propsTag ?? m?.tag ?? fromPath.tag;
}

function isRootPost(p: PostView): boolean {
  return !p.record?.reply;
}

function dedupeByUri(posts: PostView[]): PostView[] {
  const seen = new Set<string>();
  return posts.filter(p => {
    if (seen.has(p.uri)) return false;
    seen.add(p.uri);
    return true;
  });
}

/** Observes the load-more row so the next page loads before the user reaches the button. */
function FeedLoadMoreSection({
  loadingMore,
  onLoadMore,
}: {
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (loadingMore) return;
    const el = wrapRef.current;
    if (!el) return;

    const trigger = () => onLoadMoreRef.current();

    const obs = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) trigger();
      },
      { root: null, rootMargin: '320px 0px', threshold: 0 },
    );
    obs.observe(el);

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight + 320) trigger();
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      obs.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [loadingMore]);

  return (
    <div class="feed-load-more-wrap" ref={wrapRef}>
      <button
        type="button"
        class="btn btn-outline feed-load-more-btn"
        disabled={loadingMore}
        onClick={() => onLoadMoreRef.current()}
      >
        {loadingMore ? 'Loading\u2026' : 'Load more'}
      </button>
    </div>
  );
}

export function Community({ tag: tagProp }: CommunityProps) {
  const tag = useCommunityTagProp(tagProp);

  const snapshot = tag ? feedSnapshots.get(tag) : undefined;
  const validSnapshot =
    snapshot && snapshot.sortMode === (tag ? getCommunityThreadSort(tag) : 'recent')
      ? snapshot
      : undefined;

  const [posts, setPosts] = useState<PostView[]>(validSnapshot?.posts ?? []);
  const [loading, setLoading] = useState(!validSnapshot);
  const [loadingMore, setLoadingMore] = useState(false);
  const fetchLockRef = useRef(false);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(() =>
    initialCursorFromFeedSnapshot(validSnapshot),
  );
  const [page, setPage] = useState(validSnapshot?.page ?? 1);
  /** Keeps fetchPage/loadMore in sync when advancing pages (avoids stale `page` in async closures). */
  const pageRef = useRef(page);
  pageRef.current = page;
  const [totalHits, setTotalHits] = useState(validSnapshot?.totalHits ?? 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<CommunityThreadSort>(
    validSnapshot?.sortMode ?? (tag ? getCommunityThreadSort(tag) : 'recent'),
  );

  const [followingPool, setFollowingPool] = useState<FeedRootItem[]>(validSnapshot?.followingPool ?? []);
  const [replyPool, setReplyPool] = useState<PostView[]>(() => validSnapshot?.replyPool ?? []);
  const [replyApiCursor, setReplyApiCursor] = useState<string | undefined>(() =>
    validSnapshot?.replyApiCursor,
  );
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [listVersion, setListVersion] = useState(0);
  const [kbRow, setKbRow] = useState(0);
  const [kbRowOutlineActive, setKbRowOutlineActive] = useState(false);
  /** Matched roots waiting for the next page (recent / likes; search returns non-primary #tag hits too). */
  const [matchedBuffer, setMatchedBuffer] = useState<PostView[]>(() => validSnapshot?.matchedBuffer ?? []);
  const [feedMyDownvotes, setFeedMyDownvotes] = useState<Record<string, string>>({});
  const [feedDownvoteCounts, setFeedDownvoteCounts] = useState<Record<string, number>>({});
  const [feedDownvoteOptimistic, setFeedDownvoteOptimistic] = useState<Record<string, number>>({});
  const [feedDownvoteLoadingUri, setFeedDownvoteLoadingUri] = useState<string | null>(null);
  const feedDownvoteGenRef = useRef(0);
  const feedDownvoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [feedAvatarFollowBusyDid, setFeedAvatarFollowBusyDid] = useState<string | null>(null);

  const loadGen = useRef(0);
  /** Distinguish remount/back-nav (keep feed visible) from tag/sort change (full reset). */
  const prevFeedIdentityRef = useRef('');
  const prevListVersionForLoadRef = useRef<number | null>(null);
  /** True when Following + Recent uses only the default timeline (legacy chronological load). */
  const followingSingleTimelineRecentRef = useRef(false);
  const followingBlendRtRef = useRef<ReturnType<typeof createFollowingBlendRuntime> | null>(null);
  const followingMergeRtRef = useRef<ReturnType<typeof createFollowingMergeRuntime> | null>(null);
  const followingTimelineCursorRef = useRef<string | undefined>(undefined);
  const seenCommunityUris = useRef(new Set<string>());
  const matchedBufferRef = useRef<PostView[]>(validSnapshot?.matchedBuffer ?? []);
  const searchCursorRef = useRef<string | undefined>(initialCursorFromFeedSnapshot(validSnapshot));
  /** Following feed needs live blend/timeline refs; skipping fetch leaves those null and breaks load more. */
  const skipInitialFetchRef = useRef(
    Boolean(validSnapshot && tag !== FOLLOWED_COMMUNITY_TAG),
  );

  useEffect(() => {
    matchedBufferRef.current = matchedBuffer;
  }, [matchedBuffer]);

  useEffect(() => {
    searchCursorRef.current = cursor;
  }, [cursor]);

  /** After async refetch the page is short when scroll restore runs; re-apply saved Y once content exists. */
  const prevLoadingForScrollRef = useRef(loading);
  useEffect(() => {
    const wasLoading = prevLoadingForScrollRef.current;
    prevLoadingForScrollRef.current = loading;
    if (!wasLoading || loading) return;
    restoreScrollNow();
    const t1 = window.setTimeout(() => restoreScrollNow(), 350);
    const t2 = window.setTimeout(() => restoreScrollNow(), 700);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [loading]);

  /** Restore scroll when returning to page with valid snapshot (e.g., back from thread). */
  const prevValidSnapshotRef = useRef(validSnapshot);
  useEffect(() => {
    const hadValidSnapshot = !!prevValidSnapshotRef.current;
    prevValidSnapshotRef.current = validSnapshot;
    if (hadValidSnapshot && validSnapshot) {
      restoreScrollNow();
      const t1 = window.setTimeout(() => restoreScrollNow(), 350);
      const t2 = window.setTimeout(() => restoreScrollNow(), 700);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
  }, [validSnapshot]);

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

  async function pullFilteredRoots(
    communityTag: string,
    sort: 'latest' | 'top',
    prevBuffer: PostView[],
    apiCursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ page: PostView[]; buffer: PostView[]; nextCursor: string | undefined }> {
    const collected: PostView[] = [];
    const buf = [...prevBuffer];
    let cur = apiCursor;
    let rounds = 0;
    const seen = seenCommunityUris.current;

    while (collected.length < THREADS_PER_PAGE && rounds++ < FILTER_MAX_ROUNDS) {
      while (buf.length > 0 && collected.length < THREADS_PER_PAGE) {
        collected.push(buf.shift()!);
      }
      if (collected.length >= THREADS_PER_PAGE) break;

      const res = await searchByTag(communityTag, { limit: 100, cursor: cur, sort, signal });
      for (const p of res.posts) {
        if (!postPrimaryHashtagMatches(p, communityTag)) continue;
        if (seen.has(p.uri)) continue;
        seen.add(p.uri);
        if (collected.length < THREADS_PER_PAGE) collected.push(p);
        else buf.push(p);
      }
      cur = res.cursor;
      if (!res.cursor) break;
    }

    return { page: collected, buffer: buf, nextCursor: cur };
  }

  async function accumulateFilteredForReplies(
    communityTag: string,
    minRoots: number,
    startCursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ posts: PostView[]; nextCursor: string | undefined }> {
    const acc: PostView[] = [];
    const seen = seenCommunityUris.current;
    let cur = startCursor;
    let rounds = 0;
    while (acc.length < minRoots && rounds++ < FILTER_MAX_ROUNDS) {
      const res = await searchByTag(communityTag, { limit: 100, cursor: cur, sort: 'latest', signal });
      for (const p of res.posts) {
        if (!postPrimaryHashtagMatches(p, communityTag)) continue;
        if (seen.has(p.uri)) continue;
        seen.add(p.uri);
        acc.push(p);
      }
      cur = res.cursor;
      if (!res.cursor) break;
    }
    return { posts: acc, nextCursor: cur };
  }

  const user = currentUser.value;
  const isFollowing = tag === FOLLOWED_COMMUNITY_TAG;

  const followingFeedReasonByUri = useMemo((): Record<
    string,
    NonNullable<FeedRootItem['reason']>
  > => {
    if (!isFollowing) return {};
    const m: Record<string, NonNullable<FeedRootItem['reason']>> = {};
    for (const it of followingPool) {
      if (it.reason) m[it.post.uri] = it.reason;
    }
    return m;
  }, [isFollowing, followingPool]);

  const followingBlendSourceByUri = useMemo((): Record<string, FeedBlendSourceMeta> => {
    if (!isFollowing) return {};
    const m: Record<string, FeedBlendSourceMeta> = {};
    for (const it of followingPool) {
      if (it.blendSource) m[it.post.uri] = it.blendSource;
    }
    return m;
  }, [isFollowing, followingPool]);

  const followingFeedActivityByUri = useMemo((): Record<string, string> => {
    if (!isFollowing) return {};
    const m: Record<string, string> = {};
    for (const it of followingPool) {
      if (it.lastActivity) m[it.post.uri] = it.lastActivity;
    }
    return m;
  }, [isFollowing, followingPool]);

  const followingFeedActivityAuthorByUri = useMemo((): Record<string, ProfileView> => {
    if (!isFollowing) return {};
    const m: Record<string, ProfileView> = {};
    for (const it of followingPool) {
      if (it.lastActivityAuthor) m[it.post.uri] = it.lastActivityAuthor;
    }
    return m;
  }, [isFollowing, followingPool]);


  const handleFollowingAvatarFollow = useCallback(async (authorDid: string) => {
    const meDid = currentUser.value?.did;
    if (!meDid) {
      showAuthDialog.value = true;
      return;
    }
    setFeedAvatarFollowBusyDid(authorDid);
    try {
      await followActor(meDid, authorDid);
      followingDids.value = new Set(followingDids.value ?? []).add(authorDid);
    } catch (e) {
      showToast(e instanceof XRPCError ? e.message : 'Could not follow');
    } finally {
      setFeedAvatarFollowBusyDid(null);
    }
  }, []);

  useEffect(() => {
    if (!tag) return;
    setSortMode(getCommunityThreadSort(tag));
  }, [tag]);

  useEffect(() => {
    if (!tag) return;
    return () => {
      touchCommunityLastLeftAt(tag);
    };
  }, [tag]);

  useEffect(() => {
    setComposerOpen(false);
    setKbRowOutlineActive(false);
  }, [tag]);

  useEffect(() => {
    setKbRowOutlineActive(false);
  }, [page, searchQuery, sortMode, listVersion]);

  useEffect(() => {
    const onPointerDown = () => {
      const path = appPathname();
      if (!path.startsWith('/c/') && path !== '/followed' && path !== '/' && path !== '') return;
      setKbRowOutlineActive(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    if (!tag) return;
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false;
      if (tag && tag !== FOLLOWED_COMMUNITY_TAG) {
        const snap = feedSnapshots.get(tag);
        if (snap) {
          for (const p of snap.posts) seenCommunityUris.current.add(p.uri);
          for (const p of snap.matchedBuffer ?? []) seenCommunityUris.current.add(p.uri);
          for (const p of snap.replyPool ?? []) seenCommunityUris.current.add(p.uri);
        }
      }
      return;
    }
    const gen = ++loadGen.current;
    const controller = new AbortController();
    const signal = controller.signal;

    const run = async () => {
      if (isFollowing && !user?.did) {
        setLoading(false);
        setPosts([]);
        setError('');
        return;
      }

      const feedIdentity = `${tag}|${sortMode}|${isFollowing}`;
      const prevIdentity = prevFeedIdentityRef.current;
      const feedIdentityChanged = prevIdentity !== '' && prevIdentity !== feedIdentity;
      prevFeedIdentityRef.current = feedIdentity;

      const mixChanged =
        prevListVersionForLoadRef.current !== null &&
        prevListVersionForLoadRef.current !== listVersion;
      prevListVersionForLoadRef.current = listVersion;

      const softFollowingRefetch =
        isFollowing &&
        posts.length > 0 &&
        !feedIdentityChanged &&
        !mixChanged;

      if (!softFollowingRefetch) {
        setLoading(true);
      }
      setError('');
      if (!softFollowingRefetch) {
        setPage(1);
        setCursor(undefined);
        setFollowingPool([]);
        setReplyPool([]);
        setReplyApiCursor(undefined);
        setMatchedBuffer([]);
        seenCommunityUris.current.clear();
        matchedBufferRef.current = [];
        searchCursorRef.current = undefined;
      }
      followingBlendRtRef.current = null;
      followingMergeRtRef.current = null;
      followingTimelineCursorRef.current = undefined;
      followingSingleTimelineRecentRef.current = false;

      try {
        if (isFollowing) {
          let active = activeBlendSources(getFollowingFeedBlend());
          if (active.length === 0) {
            active = [
              {
                id: TIMELINE_BLEND_SOURCE_ID,
                kind: 'timeline',
                label: 'Following',
                enabled: true,
                weight: 100,
              },
            ];
          }

          const singleTimelineRecent =
            sortMode === 'recent' &&
            active.length === 1 &&
            active[0].kind === 'timeline';
          followingSingleTimelineRecentRef.current = singleTimelineRecent;

          if (singleTimelineRecent) {
            followingBlendRtRef.current = null;
            followingMergeRtRef.current = null;
            const raw: FeedRootItem[] = [];
            const seenUri = new Set<string>();
            let apiCursor: string | undefined;
            for (let i = 0; i < TIMELINE_INITIAL_MAX_ROUNDS; i++) {
              const res = await getTimeline({ limit: 100, cursor: apiCursor, signal });
              if (signal.aborted || gen !== loadGen.current) return;
              for (const item of res.feed) {
                const p = item.post;
                if (!isRootPost(p) || seenUri.has(p.uri)) continue;
                seenUri.add(p.uri);
                raw.push({ post: p, reason: item.reason });
              }
              apiCursor = res.cursor;
              if (!res.cursor) break;
              if (raw.length >= THREADS_PER_PAGE) break;
            }
            const roots = sortFeedRootItems(raw, 'recent');
            if (signal.aborted || gen !== loadGen.current) return;
            followingTimelineCursorRef.current = apiCursor;
            setFollowingPool(roots);
            setPosts(roots.slice(0, THREADS_PER_PAGE).map(r => r.post));
            setTotalHits(roots.length + (apiCursor ? THREADS_PER_PAGE : 0));
            return;
          }

          if (sortMode === 'recent') {
            const rt = createFollowingBlendRuntime(active);
            followingBlendRtRef.current = rt;
            followingMergeRtRef.current = null;
            followingTimelineCursorRef.current = undefined;
            const pool: FeedRootItem[] = [];
            await extendRecentBlendedPool(
              rt,
              isRootPost,
              pool,
              THREADS_PER_PAGE,
              100,
              () => signal.aborted || gen !== loadGen.current,
            );
            if (signal.aborted || gen !== loadGen.current) return;
            setFollowingPool(pool);
            setPosts(pool.slice(0, THREADS_PER_PAGE).map(r => r.post));
            const more = followingBlendHasMore(rt);
            setTotalHits(pool.length + (more ? THREADS_PER_PAGE : 0));
            return;
          }

          const mrt = createFollowingMergeRuntime(active);
          followingMergeRtRef.current = mrt;
          followingBlendRtRef.current = null;
          followingTimelineCursorRef.current = undefined;
          await extendMergedFollowingPool(
            mrt,
            isRootPost,
            THREADS_PER_PAGE,
            100,
            () => signal.aborted || gen !== loadGen.current,
          );
          if (signal.aborted || gen !== loadGen.current) return;
          const sorted = sortFeedRootItems(mrt.raw, sortMode);
          setFollowingPool(sorted);
          setPosts(sorted.slice(0, THREADS_PER_PAGE).map(r => r.post));
          const more = mrt.fetch.some(f => !f.done);
          setTotalHits(sorted.length + (more ? THREADS_PER_PAGE : 0));
          return;
        }

        if (sortMode === 'likes') {
          const { page: pagePosts, buffer, nextCursor } = await pullFilteredRoots(tag, 'top', [], undefined, signal);
          if (signal.aborted || gen !== loadGen.current) return;
          matchedBufferRef.current = buffer;
          searchCursorRef.current = nextCursor;
          setMatchedBuffer(buffer);
          setPosts(pagePosts);
          setCursor(nextCursor);
          setTotalHits(0);
          return;
        }

        if (sortMode === 'replies') {
          const { posts: acc, nextCursor } = await accumulateFilteredForReplies(tag, THREADS_PER_PAGE, undefined, signal);
          if (signal.aborted || gen !== loadGen.current) return;
          const pool = sortThreads(acc, 'replies');
          setReplyPool(pool);
          setReplyApiCursor(nextCursor);
          setPosts(pool.slice(0, THREADS_PER_PAGE));
          setTotalHits(pool.length + (nextCursor ? 100 : 0));
          setCursor(nextCursor);
          return;
        }

        const { page: pagePosts, buffer, nextCursor } = await pullFilteredRoots(tag, 'latest', [], undefined, signal);
        if (signal.aborted || gen !== loadGen.current) return;
        matchedBufferRef.current = buffer;
        searchCursorRef.current = nextCursor;
        setMatchedBuffer(buffer);
        setPosts(pagePosts);
        setCursor(nextCursor);
        setTotalHits(0);
      } catch (err) {
        if (signal.aborted || gen !== loadGen.current) return;
        const msg = err instanceof Error ? err.message : 'Failed to load community';
        setError(msg);
        showToast(msg);
      } finally {
        if (!signal.aborted && gen === loadGen.current) setLoading(false);
      }
    };

    void run();
    return () => { controller.abort(); };
  }, [tag, sortMode, isFollowing, user?.did, listVersion]);

  useEffect(() => {
    if (!tag || loading) return;
    feedSnapshots.set(tag, {
      posts, page, totalHits, sortMode, followingPool,
      matchedBuffer,
      searchApiCursor: cursor,
      replyPool,
      replyApiCursor,
    });
  }, [tag, posts, page, totalHits, sortMode, followingPool, loading, matchedBuffer, cursor, replyPool, replyApiCursor]);

  useLayoutEffect(() => {
    if (composerFocusRequest === 0) return;
    document.getElementById('community-new-thread-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [composerFocusRequest]);

  const openNewThreadComposer = () => {
    setComposerOpen(true);
    setComposerFocusRequest(n => n + 1);
  };

  const fetchPageRef = useRef<((newPage: number) => Promise<void>) | null>(null);

  if (!tag) {
    return <div class="empty"><p>No community specified</p></div>;
  }

  const communityConfig = isFollowing
    ? undefined
    : getCommunities().find(c => c.tag === tag);
  const communityName = isFollowing
    ? FOLLOWED_COMMUNITY.name
    : (communityConfig?.name || `#${tag}`);

  const persistSort = (next: CommunityThreadSort) => {
    setSortMode(next);
    setCommunityThreadSort(tag, next);
  };

  const fetchPage = async (newPage: number) => {
    const curPage = pageRef.current;
    if (newPage < curPage) return;
    const isLoadMore = newPage > curPage;
    const scrollFeedToTop = () => {
      window.scrollTo(0, 0);
    };

    if (isLoadMore) {
      fetchLockRef.current = true;
      setLoadingMore(true);
    }
    try {
    if (isFollowing) {
      if (newPage === curPage) {
        scrollFeedToTop();
        return;
      }

      const needEnd = newPage * THREADS_PER_PAGE;

      if (followingSingleTimelineRecentRef.current && sortMode === 'recent') {
        let pool = [...followingPool];
        let apiCursor = followingTimelineCursorRef.current;

        let iterations = 0;
        const MAX_ITERATIONS = 100;
        while (pool.length < needEnd && apiCursor && iterations++ < MAX_ITERATIONS) {
          const res = await getTimeline({ limit: 100, cursor: apiCursor });
          const merged: FeedRootItem[] = [...pool];
          for (const item of res.feed) {
            const p = item.post;
            if (!isRootPost(p)) continue;
            merged.push({ post: p, reason: item.reason });
          }
          pool = sortFeedRootItems(dedupeFeedRootItemsByUri(merged), 'recent');
          apiCursor = res.cursor;
          followingTimelineCursorRef.current = apiCursor;
          setFollowingPool(pool);
          if (!res.cursor) break;
        }

        const slice = pool.slice(0, Math.min(needEnd, pool.length)).map(r => r.post);
        setPosts(slice);
        setPage(newPage);
        pageRef.current = newPage;
        setTotalHits(pool.length + (apiCursor ? THREADS_PER_PAGE : 0));
        if (!isLoadMore) scrollFeedToTop();
        return;
      }

      if (sortMode === 'recent') {
        const rt = followingBlendRtRef.current;
        if (!rt) return;
        const pool = [...followingPool];
        await extendRecentBlendedPool(
          rt,
          isRootPost,
          pool,
          needEnd,
          120,
          () => false,
        );
        setFollowingPool(pool);
        setPosts(pool.slice(0, Math.min(needEnd, pool.length)).map(r => r.post));
        setPage(newPage);
        pageRef.current = newPage;
        const more = followingBlendHasMore(rt);
        setTotalHits(pool.length + (more ? THREADS_PER_PAGE : 0));
        if (!isLoadMore) scrollFeedToTop();
        return;
      }

      const mrt = followingMergeRtRef.current;
      if (!mrt) return;
      await extendMergedFollowingPool(mrt, isRootPost, needEnd, 120, () => false);
      const sorted = sortFeedRootItems(mrt.raw, sortMode);
      setFollowingPool(sorted);
      setPosts(sorted.slice(0, Math.min(needEnd, sorted.length)).map(r => r.post));
      setPage(newPage);
      pageRef.current = newPage;
      const more = mrt.fetch.some(f => !f.done);
      setTotalHits(sorted.length + (more ? THREADS_PER_PAGE : 0));
      if (!isLoadMore) scrollFeedToTop();
      return;
    }

    if (sortMode === 'replies') {
      let pool = replyPool;
      let rc = replyApiCursor;
      const needEnd = newPage * THREADS_PER_PAGE;
      try {
        let iterations = 0;
        const MAX_ITERATIONS = 100;
        while (pool.length < needEnd && rc && iterations++ < MAX_ITERATIONS) {
          const res = await searchByTag(tag!, { limit: 100, cursor: rc, sort: 'latest' });
          const filtered = res.posts.filter(p => postPrimaryHashtagMatches(p, tag!));
          pool = dedupeByUri([...pool, ...filtered]);
          pool = sortThreads(pool, 'replies');
          rc = res.cursor;
          setReplyPool(pool);
          setReplyApiCursor(rc);
          if (!res.cursor) break;
        }
        setPosts(pool.slice(0, Math.min(needEnd, pool.length)));
        setPage(newPage);
        pageRef.current = newPage;
        setCursor(rc);
        setTotalHits(pool.length + (rc ? 100 : 0));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load';
        if (!isLoadMore) setError(msg);
        showToast(msg);
      }
      if (!isLoadMore) scrollFeedToTop();
      return;
    }

    if (sortMode === 'likes' || sortMode === 'recent' || sortMode === 'author') {
      if (newPage === curPage) {
        scrollFeedToTop();
        return;
      }
      if (!isLoadMore) setError('');
      try {
        const sort = sortMode === 'likes' ? 'top' : 'latest';
        let buf = matchedBufferRef.current;
        let cur = searchCursorRef.current;

        const batches = Math.max(0, newPage - curPage);
        const chunks: PostView[] = [];
        for (let s = 0; s < batches; s++) {
          const r = await pullFilteredRoots(tag!, sort, buf, cur);
          chunks.push(...r.page);
          buf = r.buffer;
          cur = r.nextCursor;
        }

        matchedBufferRef.current = buf;
        searchCursorRef.current = cur;
        setMatchedBuffer(buf);
        setPosts(prev => dedupeByUri([...prev, ...chunks]));
        setCursor(cur);
        setTotalHits(0);
        setPage(newPage);
        pageRef.current = newPage;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load';
        if (!isLoadMore) setError(msg);
        showToast(msg);
      }
      if (!isLoadMore) scrollFeedToTop();
    }
    } finally {
      if (isLoadMore) {
        fetchLockRef.current = false;
        setLoadingMore(false);
      }
    }
  };

  fetchPageRef.current = fetchPage;

  const loadMore = () => {
    if (fetchLockRef.current) return;
    const fp = fetchPageRef.current;
    if (!fp) return;
    void fp(pageRef.current + 1);
  };

  const handleHide = (uri: string) => {
    hideThread(uri);
    setPosts(posts.filter(p => p.uri !== uri));
    showToast('Thread hidden');
  };

  const visiblePosts = posts.filter(p => !isThreadHidden(p.uri));
  const searchNeedle = searchQuery.trim().toLowerCase();
  const matchesSearchText = (p: PostView) => {
    if (!searchNeedle) return true;
    return (
      p.record.text.toLowerCase().includes(searchNeedle) ||
      (p.author.displayName || p.author.handle).toLowerCase().includes(searchNeedle)
    );
  };

  /** Order in `posts` so “Search threads” + load more appends new hits after prior hits (avoids re-sort inserting rows above the fold). */
  const postLoadOrder = new Map<string, number>();
  posts.forEach((p, i) => {
    if (!postLoadOrder.has(p.uri)) postLoadOrder.set(p.uri, i);
  });

  let displayPosts: PostView[];
  if (!searchNeedle) {
    displayPosts = sortThreads(visiblePosts, sortMode).filter(p => !isAuthorFiltered(p.author.did));
  } else {
    const matching = visiblePosts.filter(p => matchesSearchText(p));
    matching.sort(
      (a, b) => (postLoadOrder.get(a.uri) ?? 0) - (postLoadOrder.get(b.uri) ?? 0),
    );
    displayPosts = matching.filter(p => !isAuthorFiltered(p.author.did));
  }

  const displayPostsRef = useRef<PostView[]>([]);
  const kbRowRef = useRef(0);
  displayPostsRef.current = displayPosts;
  kbRowRef.current = kbRow;

  useEffect(() => {
    setKbRow(i => Math.min(i, Math.max(0, displayPosts.length - 1)));
  }, [displayPosts.length]);

  useEffect(() => {
    if (!isFollowing || !user?.did) {
      feedDownvoteGenRef.current += 1;
      setFeedDownvoteCounts({});
      setFeedMyDownvotes({});
      setFeedDownvoteOptimistic({});
      if (feedDownvoteTimerRef.current != null) {
        clearTimeout(feedDownvoteTimerRef.current);
        feedDownvoteTimerRef.current = null;
      }
      return;
    }
    const uris = displayPostsRef.current.map(p => p.uri);
    const gen = ++feedDownvoteGenRef.current;
    setFeedDownvoteOptimistic({});
    if (feedDownvoteTimerRef.current != null) {
      clearTimeout(feedDownvoteTimerRef.current);
      feedDownvoteTimerRef.current = null;
    }
    const outer = window.setTimeout(() => {
      if (gen !== feedDownvoteGenRef.current) return;
      if (uris.length > 0) {
        void getDownvoteCounts(uris)
          .then(counts => {
            if (gen !== feedDownvoteGenRef.current) return;
            setFeedDownvoteCounts(counts);
          })
          .catch(() => {});
      } else {
        setFeedDownvoteCounts({});
      }
      const did = currentUser.value?.did;
      if (isLoggedIn.value && did) {
        void listMyDownvotes(did)
          .then(votes => {
            if (gen !== feedDownvoteGenRef.current) return;
            setFeedMyDownvotes(votes);
          })
          .catch(() => {});
      } else {
        setFeedMyDownvotes({});
      }
    }, 2000);
    feedDownvoteTimerRef.current = outer;
    return () => {
      feedDownvoteGenRef.current += 1;
      if (feedDownvoteTimerRef.current != null) {
        clearTimeout(feedDownvoteTimerRef.current);
        feedDownvoteTimerRef.current = null;
      }
    };
  }, [isFollowing, user?.did, posts, searchQuery, sortMode, tag, page, listVersion]);

  const handleDownvoteFeedPost = useCallback(
    async (subjectUri: string, subjectCid: string) => {
      if (!isLoggedIn.value) {
        showAuthDialog.value = true;
        return;
      }
      const did = currentUser.value?.did;
      if (!did) return;
      const currentRecord = feedMyDownvotes[subjectUri];
      setFeedDownvoteLoadingUri(subjectUri);
      try {
        if (currentRecord) {
          await deleteDownvote(currentRecord, did);
          setFeedMyDownvotes(m => {
            const next = { ...m };
            delete next[subjectUri];
            return next;
          });
          setFeedDownvoteOptimistic(d => ({
            ...d,
            [subjectUri]: (d[subjectUri] ?? 0) - 1,
          }));
        } else {
          const res = await createDownvote(did, { uri: subjectUri, cid: subjectCid });
          setFeedMyDownvotes(m => ({ ...m, [subjectUri]: res.uri }));
          setFeedDownvoteOptimistic(d => ({
            ...d,
            [subjectUri]: (d[subjectUri] ?? 0) + 1,
          }));
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not update downvote');
      } finally {
        setFeedDownvoteLoadingUri(null);
      }
    },
    [feedMyDownvotes],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const path = appPathname();
      if (!path.startsWith('/c/') && path !== '/followed' && path !== '/' && path !== '') return;
      const tgt = e.target as HTMLElement;
      if (
        tgt.tagName === 'INPUT' ||
        tgt.tagName === 'TEXTAREA' ||
        tgt.tagName === 'SELECT' ||
        tgt.isContentEditable
      ) {
        return;
      }
      const list = displayPostsRef.current;
      const down = e.key === 's' || e.key === 'ArrowDown' || e.key === 'd' || e.key === 'ArrowRight';
      const up = e.key === 'w' || e.key === 'ArrowUp' || e.key === 'a' || e.key === 'ArrowLeft';
      if (down || up) {
        e.preventDefault();
        setKbRowOutlineActive(true);
        const max = Math.max(0, list.length - 1);
        const anchor = dominantVisibleListRowIndex(
          list.length,
          i => `community-feed-kb-${i}`,
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
    document.getElementById(`community-feed-kb-${kbRow}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });
  }, [kbRow, kbRowOutlineActive]);

  const tagSearchSort =
    !isFollowing && (sortMode === 'recent' || sortMode === 'likes' || sortMode === 'author');
  const tagSearchHasMore = matchedBuffer.length > 0 || Boolean(cursor);
  const totalPages = isFollowing
    ? Math.max(1, Math.ceil(totalHits / THREADS_PER_PAGE))
    : sortMode === 'replies'
      ? Math.max(1, Math.ceil(replyPool.length / THREADS_PER_PAGE) + (replyApiCursor ? 1 : 0))
      : tagSearchSort
        ? Math.max(1, page + (tagSearchHasMore ? 1 : 0))
        : Math.max(1, Math.ceil(totalHits / THREADS_PER_PAGE));

  // Removed early return for guest users to prevent UI jumps; guests will see the login prompt inside the panel.

  return (
    <div>
      <div class="community-header-row">
        <div class="community-header-left">
          <div class="community-title">{communityName}</div>
          {!isFollowing && communityConfig?.description && (
            <div class="community-title-desc">
              {communityConfig.description}
            </div>
          )}
        </div>
        <div class="community-header-right">
          <div class="breadcrumb">
            <a
              href={hrefForAppPath('/')}
              {...SPA_ANCHOR_SHIELD}
              onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}
            >
              ForumSky
            </a>
            <span class="sep">&gt;</span>
            <span>{communityName}</span>
          </div>
        </div>
      </div>

      <div class="community-toolbar">
        {isFollowing && user?.did && (
          <FollowingFeedMixPanel onConfigChanged={() => setListVersion(v => v + 1)} />
        )}
        {!isFollowing && (
          <button
            type="button"
            class="btn btn-primary community-new-thread-btn"
            onClick={openNewThreadComposer}
          >
            New thread
          </button>
        )}
        <div class="search-threads" style="flex:1;margin:0">
          <input
            type="text"
            placeholder="Search threads"
            value={searchQuery}
            onInput={(e: Event) => setSearchQuery((e.target as HTMLInputElement).value)}
          />
        </div>
        <label class="community-sort">
          <span>Sort</span>
          <select
            value={sortMode}
            onChange={(e: Event) => {
              persistSort((e.target as HTMLSelectElement).value as CommunityThreadSort);
            }}
          >
            <option value="recent">Recent activity</option>
            <option value="replies">Most replies</option>
            <option value="likes">Most likes</option>
            <option value="author">Author (A–Z)</option>
          </select>
        </label>
      </div>

      {!isFollowing && composerOpen && (
        <div id="community-new-thread-anchor" class="community-new-thread-section">
          <Composer
            key={tag}
            community={tag}
            draftKey={tag ? `community:${tag}` : undefined}
            focusRequest={composerFocusRequest}
            textareaId="community-thread-composer"
            className="community-thread-composer"
            onPost={() => setListVersion(v => v + 1)}
            onCancel={() => setComposerOpen(false)}
          />
        </div>
      )}

      <div class={isFollowing ? 'panel panel-following-feed-list' : 'panel'}>
        {!isFollowing && (
          <div class="thread-list-header">
            <div style="flex:1"></div>
            <div style="width:60px;text-align:center">Replies</div>
            <div style="width:180px;text-align:right">Last Reply</div>
          </div>
        )}

        {isFollowing && !user?.did ? (
          <div class="empty" style="padding:24px">
            <p>Sign in with your Bluesky account to see posts from people you follow.</p>
            <button
              type="button"
              class="btn btn-primary"
              style="margin-top:12px"
              onClick={() => {
                showAuthDialog.value = true;
              }}
            >
              Login
            </button>
          </div>
        ) : (
          <>

        {loading ? (
          <div class="loading"><div class="spinner" /></div>
        ) : error ? (
          <div class="error-msg">
            <p>{error}</p>
            <button class="btn btn-outline" style="margin-top:10px" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        ) : displayPosts.length === 0 ? (
          <div class="empty">
            <p>{isFollowing ? 'No posts from people you follow yet.' : `No threads found in #${tag}`}</p>
            {!isFollowing && (
              <p>Only threads whose root post has #{tag} as its first hashtag are listed here.</p>
            )}
          </div>
        ) : (
          displayPosts.map((post, i) => (
            <div
              key={post.uri}
              id={`community-feed-kb-${i}`}
              class={kbRowOutlineActive && i === kbRow ? 'thread-row-kb-focus' : undefined}
            >
              {isFollowing ? (
                <FollowingFeedRow
                  post={post}
                  onHide={() => handleHide(post.uri)}
                  showUnreadReplies={threadRowUnreadReplies(post)}
                  feedReason={followingFeedReasonByUri[post.uri]}
                  lastActivity={followingFeedActivityByUri[post.uri]}
                  lastActivityAuthor={followingFeedActivityAuthorByUri[post.uri]}
                  blendSource={followingBlendSourceByUri[post.uri]}
                  downvoteRecordUri={feedMyDownvotes[post.uri]}
                  downvoteDisplayCount={Math.max(
                    0,
                    (feedDownvoteCounts[post.uri] ?? 0) + (feedDownvoteOptimistic[post.uri] ?? 0),
                  )}
                  onDownvotePost={handleDownvoteFeedPost}
                  downvoteBusy={feedDownvoteLoadingUri === post.uri}
                  onAvatarFollow={handleFollowingAvatarFollow}
                  avatarFollowBusyDid={feedAvatarFollowBusyDid}
                  followingAuthorDids={followingDids.value}
                  viewerDid={user?.did}
                />
              ) : (
                <ThreadRow
                  post={post}
                  onHide={() => handleHide(post.uri)}
                  showUnreadReplies={threadRowUnreadReplies(post)}
                  feedReason={followingFeedReasonByUri[post.uri]}
                  lastActivity={followingFeedActivityByUri[post.uri]}
                  lastActivityAuthor={followingFeedActivityAuthorByUri[post.uri]}
                  blendSource={followingBlendSourceByUri[post.uri]}
                />
              )}
            </div>
          ))
        )}
        </>
        )}
      </div>

      {!loading && page < totalPages && (
        <FeedLoadMoreSection loadingMore={loadingMore} onLoadMore={loadMore} />
      )}
    </div>
  );
}
