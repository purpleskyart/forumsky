import { Fragment, createContext } from 'preact';
import { createPortal } from 'preact/compat';
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useContext,
} from 'preact/hooks';
import { useIosUpdate } from '@/hooks/useIosUpdate';
import { restoreScrollNow } from '@/lib/scroll-restore';
import { Avatar } from '@/components/Avatar';
import { AuthorFlair } from '@/components/AuthorFlair';
import { Composer } from '@/components/Composer';
import { QuotedPostEmbedCard } from '@/components/QuotedPostEmbedCard';
import { ThreadSkeleton } from '@/components/ThreadSkeleton';
import { getCachedThread } from '@/lib/thread-prefetch';
import {
  bskyPostWebUrl,
  PostDownvoteButton,
  PostLikeButton,
  PostRepostButton,
  PostShareButton,
} from '@/components/PostSocialButtons';
import { GifImage, GifImageFromEmbed } from '@/components/GifImage';
import { PostContentImage } from '@/components/PostContentImage';
import { HlsVideo } from '@/components/HlsVideo';
import { NsfwMediaWrap } from '@/components/NsfwMediaWrap';
import { getPostThread, getPostUri, parseAtUri, getPosts, searchPosts, getLikes } from '@/api/feed';
import { resolveHandle } from '@/api/actor';
import {
  mergeThread,
  buildThreadPostIndex,
  buildDirectRepliesByParentUri,
  buildNestedCommentTree,
  getChildRepliesForSegments,
  type MergedThread,
  type DirectReplyLink,
  type CommentTreeNode,
  extractFirstHashtag,
} from '@/lib/thread-merger';
import { getDownvoteCounts } from '@/lib/constellation';
import { postHasNsfwLabels } from '@/lib/nsfw-labels';
import { toneIndexForHandle, formatProfileJoined, formatProfileStatCount } from '@/lib/user-display';
import {
  renderPostContent,
  getPostImages,
  getPostExternal,
  getQuotedPostAggregatedMedia,
  getQuotedEmbedFromSegments,
  isGifImage,
  isNativeExternalEmbed,
  getExternalGifPlaybackSources,
  extractExternalUrlsFromPost,
} from '@/lib/richtext';
import {
  detectPostLanguageBcp47,
  navigatorLanguageTags,
  postLanguageDiffersFromUserLocales,
  translationTargetTagFromNavigator,
} from '@/lib/post-language';
import {
  showPlainTextTranslateOverlay,
  translateWithOnDeviceTranslator,
} from '@/lib/platform-translate';
import {
  translateWithThirdPartyServices,
  type ThirdPartyTranslationVia,
} from '@/lib/third-party-translate';
import { isThreadViewPost } from '@/api/types';
import { appPathname, hrefForAppPath } from '@/lib/app-base-path';
import { swr } from '@/lib/cache';
import { parseThreadRoutePath } from '@/lib/spa-route-params';
import { useRouter } from 'preact-router';
import {
  navigate,
  communityUrl,
  threadUrl,
  SPA_ANCHOR_SHIELD,
  spaNavigateClick,
} from '@/lib/router';
import { formatThreadTitlePreviewLine } from '@/lib/thread-title';
import { t } from '@/lib/i18n';
import { isLoggedIn, showAuthDialog, currentUser, showToast, mutedDids, blockedDids, followingDids, showGlobalComposer, globalComposerReplyTo, globalComposerCommunity } from '@/lib/store';
import { blockActor, muteActor } from '@/api/graph';
import { refreshGraphPolicy } from '@/lib/graph-policy';
import {
  toggleSavedThread,
  isThreadSaved,
  getLastReadPostUri,
  setLastReadPostUri,
  getLocallyHiddenPostUris,
  addLocallyHiddenSubtree,
  setLocalHideReason,
  clearLocallyHiddenForThread,
  getLocalHideReasons,
} from '@/lib/forumsky-local';
import { reportPost } from '@/api/moderation';
import { deletePost, createDownvote, deleteDownvote, listMyDownvotes } from '@/api/post';
import { followActor } from '@/api/graph-follows';
import { PostSubscribeButton } from '@/components/PostSubscribeButton';
import { ScrollNavigation } from '@/components/ScrollNavigation';
import { XRPCError } from '@/api/xrpc';
import type { PostView, StrongRef, ThreadViewPost } from '@/api/types';
import type { ComponentChildren } from 'preact';

interface ThreadProps {
  actor?: string;
  rkey?: string;
}

/** All post AT URIs in a merged thread for Constellation downvote counts (ArtSky-compatible). */
function collectMergedThreadPostUris(t: MergedThread): string[] {
  const out = new Set<string>();
  for (const seg of t.forumPost.segments) out.add(seg.uri);
  for (const c of t.comments) {
    for (const seg of c.segments) out.add(seg.uri);
  }
  return [...out];
}

type ThreadReplyTarget = {
  parent: StrongRef;
  summary: string;
};

type ThreadQuoteTarget = {
  post: PostView;
  postNumber: number;
};

type OwnPostDeletedDetail =
  | { scope: 'all' }
  | { scope: 'oneSegment'; deletedUri: string; survivorUrisOldestFirst: string[] };

const COMMENT_LAYOUT_STORAGE_KEY = 'forumsky-thread-comment-layout';
type ThreadCommentLayoutMode = 'nested' | 'forum';

function readStoredCommentLayout(): ThreadCommentLayoutMode {
  try {
    if (typeof localStorage === 'undefined') return 'forum';
    const v = localStorage.getItem(COMMENT_LAYOUT_STORAGE_KEY);
    return v === 'nested' ? 'nested' : 'forum';
  } catch {
    return 'forum';
  }
}

/** Shared main-body translation per AT URI (post header, >> preview, and post-content stay in sync). */
type ThreadPostMainTranslation = {
  mainCached: string | null;
  view: 'original' | 'translated';
};

type ThreadTranslationContextValue = {
  byUri: Record<string, ThreadPostMainTranslation>;
  patchMain: (uri: string, partial: Partial<ThreadPostMainTranslation>) => void;
  resetMain: (uri: string) => void;
};

const threadTranslationContextDefault: ThreadTranslationContextValue = {
  byUri: {},
  patchMain: () => {},
  resetMain: () => {},
};

const ThreadTranslationContext =
  createContext<ThreadTranslationContextValue>(threadTranslationContextDefault);

function ThreadTranslationProvider({
  threadRootUri,
  children,
}: {
  threadRootUri: string;
  children: ComponentChildren;
}) {
  const [byUri, setByUri] = useState<Record<string, ThreadPostMainTranslation>>({});
  useEffect(() => {
    setByUri({});
  }, [threadRootUri]);

  const patchMain = useCallback((uri: string, partial: Partial<ThreadPostMainTranslation>) => {
    setByUri(prev => {
      const cur = prev[uri] ?? { mainCached: null, view: 'original' as const };
      return { ...prev, [uri]: { ...cur, ...partial } };
    });
  }, []);

  const resetMain = useCallback((uri: string) => {
    setByUri(prev => {
      if (!(uri in prev)) return prev;
      const next = { ...prev };
      delete next[uri];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ byUri, patchMain, resetMain }),
    [byUri, patchMain, resetMain],
  );

  return (
    <ThreadTranslationContext.Provider value={value}>{children}</ThreadTranslationContext.Provider>
  );
}

/** Newest segment first avoids leaving self-replies pointing at already-deleted parents. */
async function deleteOwnBlueskySegments(segments: PostView[], viewerDid: string): Promise<void> {
  const sorted = [...segments].sort(
    (a, b) =>
      new Date(b.record.createdAt).getTime() - new Date(a.record.createdAt).getTime(),
  );
  for (const seg of sorted) {
    const p = parseAtUri(seg.uri);
    if (!p || p.repo !== viewerDid) {
      throw new Error('Cannot delete a segment that is not in your repository');
    }
    await deletePost(viewerDid, p.rkey);
  }
}

function CrossDiscussionPanel({ rootPost }: { rootPost: PostView }) {
  const [items, setItems] = useState<
    { uri: string; handle: string; rkey: string; snippet: string }[]
  >([]);

  useEffect(() => {
    const urls = extractExternalUrlsFromPost(rootPost).filter(u => u.length > 8);
    if (urls.length === 0) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const found: { uri: string; handle: string; rkey: string; snippet: string }[] = [];
      const seen = new Set<string>();
      for (const url of urls.slice(0, 2)) {
        try {
          const res = await searchPosts(url, { limit: 25, sort: 'latest' });
          if (cancelled) return;
          let host = '';
          try {
            host = new URL(url).hostname;
          } catch {
            /* ignore */
          }
          for (const p of res.posts) {
            if (p.uri === rootPost.uri || seen.has(p.uri)) continue;
            const body = p.record.text || '';
            if (!body.includes(url) && (!host || !body.includes(host))) continue;
            const parsed = parseAtUri(p.uri);
            if (!parsed) continue;
            seen.add(p.uri);
            found.push({
              uri: p.uri,
              handle: p.author.handle || p.author.did,
              rkey: parsed.rkey,
              snippet: body.slice(0, 100).replace(/\s+/g, ' '),
            });
            if (found.length >= 6) break;
          }
        } catch {
          /* ignore */
        }
        if (found.length >= 6) break;
      }
      if (!cancelled) setItems(found);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [rootPost.uri, rootPost.record.text, rootPost.record.facets]);

  if (items.length === 0) return null;
  return (
    <div class="thread-cross-discussion panel" role="region" aria-label="Related discussions">
      <div class="thread-cross-discussion-title">Also discussing linked URLs</div>
      <ul class="thread-cross-discussion-list">
        {items.map(p => (
          <li key={p.uri}>
            <a
              href={hrefForAppPath(threadUrl(p.handle, p.rkey))}
              {...SPA_ANCHOR_SHIELD}
              onClick={(e: Event) => {
                e.preventDefault();
                navigate(threadUrl(p.handle, p.rkey));
              }}
            >
              @{p.handle}
            </a>
            <span class="thread-cross-snippet"> — {p.snippet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Thread(props: ThreadProps) {
  const [routeCtx] = useRouter();
  const fromPath =
    typeof window !== 'undefined' ? parseThreadRoutePath(appPathname()) : {};
  const m = routeCtx.matches as Record<string, string | undefined> | null | undefined;
  const actor = props.actor ?? m?.actor ?? fromPath.actor;
  const rkey = props.rkey ?? m?.rkey ?? fromPath.rkey;

  const [thread, setThread] = useState<MergedThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /** Restore scroll when thread loads (back/forward navigation) */
  const prevLoadingForScrollRef = useRef(loading);

  useLayoutEffect(() => {
    if (!actor || !rkey) return;
    setLoading(true);
    setThread(null);
    setError('');
  }, [actor, rkey]);

  useLayoutEffect(() => {
    const wasLoading = prevLoadingForScrollRef.current;
    prevLoadingForScrollRef.current = loading;
    if (!wasLoading || loading) return;
    restoreScrollNow();
  }, [loading]);

  useEffect(() => {
    if (!actor || !rkey) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        // Try to construct URI and check cache immediately
        const did = actor.startsWith('did:') ? actor : null;
        const tentativeUri = did ? getPostUri(did, rkey) : null;
        
        // Check cache first - if we have it, show immediately and skip handle resolution
        let cachedThread: ThreadViewPost | null = null;
        if (tentativeUri) {
          const cached = getCachedThread(tentativeUri);
          if (cached && isThreadViewPost(cached.thread)) {
            cachedThread = cached.thread;
          }
        }
        
        // If no cache, we need to resolve handle first
        let resolvedDid = did;
        if (!resolvedDid) {
          const resolved = await swr(`resolve_${actor}`, () => resolveHandle(actor), 24 * 60 * 60 * 1000); // 24 hours
          resolvedDid = resolved.did;
        }
        
        if (!resolvedDid) {
          setError('Could not resolve handle');
          return;
        }
        
        const uri = getPostUri(resolvedDid, rkey);
        
        // If we have cached data, show it immediately
        if (cachedThread) {
          setThread(mergeThread(cachedThread));
          setLoading(false);
          // Background refresh disabled to prevent scroll jumps
          return;
        }
        
        // No cache - must fetch
        const res = await swr(`thread_${uri}`, () => getPostThread(uri, 100, 5), 5 * 60 * 1000); // 5 minutes
        if (cancelled) return;
        if (!isThreadViewPost(res.thread)) {
          setError('Thread not found');
          return;
        }
        // Log to check if API returns cursor for pagination
        console.log('Thread response cursor:', res.cursor, 'comment count:', res.thread.replies?.length);
        setThread(mergeThread(res.thread));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load thread');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [actor, rkey]);

  if (!actor || !rkey) return <div class="empty"><p>Invalid thread</p></div>;

  if (loading && !thread) return <ThreadSkeleton />;
  if (error) return <div class="empty"><p style="color:var(--danger)">{error}</p></div>;
  if (!thread) return <div class="empty"><p>Thread not found</p></div>;

  return <ThreadView thread={thread} setThread={setThread} actor={actor} rkey={rkey} />;
}

function ThreadView({
  thread,
  setThread,
  actor,
  rkey,
}: {
  thread: MergedThread;
  setThread: (t: MergedThread | null) => void;
  actor: string;
  rkey: string;
}) {
  const [replyTarget, setReplyTarget] = useState<ThreadReplyTarget | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<ThreadQuoteTarget | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [composerDismissed, setComposerDismissed] = useState(false);
  const [commentLayoutMode, setCommentLayoutMode] = useState<ThreadCommentLayoutMode>(readStoredCommentLayout);
  const [appendQuoteRequest, setAppendQuoteRequest] = useState({ id: 0, text: '' });
  const [myDownvotes, setMyDownvotes] = useState<Record<string, string>>({});
  const [downvoteCounts, setDownvoteCounts] = useState<Record<string, number>>({});
  const [downvoteCountOptimisticDelta, setDownvoteCountOptimisticDelta] = useState<Record<string, number>>(
    {},
  );
  const [downvoteLoadingUri, setDownvoteLoadingUri] = useState<string | null>(null);
  const downvoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const downvoteGenRef = useRef(0);
  const [kbFocusPost, setKbFocusPost] = useState(1);
  /** Outline only after W/S/A/D or arrows — not on initial load */
  const [kbOutlineActive, setKbOutlineActive] = useState(false);
  const [savedUi, setSavedUi] = useState(false);
  const [localHiddenList, setLocalHiddenList] = useState<string[]>([]);
  const [ariaLiveReplies, setAriaLiveReplies] = useState('');
  const [selectionQuote, setSelectionQuote] = useState<string | null>(null);
  /** Nested layout: comment `post.uri` → chain of replies under it is collapsed. */
  const [collapsedNestedChains, setCollapsedNestedChains] = useState<Set<string>>(() => new Set());
  const quoteToolbarRef = useRef<HTMLDivElement>(null);
  const threadStackRef = useRef<HTMLDivElement>(null);
  const kbFocusPostRef = useRef(1);
  /** Consume ?reply=1 / ?quote=1 once per thread navigation (following feed → composer). */
  const composeFromQueryConsumedRef = useRef(false);
  const replyCountAnnounceRef = useRef(-1);
  const [avatarFollowBusyDid, setAvatarFollowBusyDid] = useState<string | null>(null);
  // Track which comments the thread creator (OP) has liked
  const [threadCreatorLikedUris, setThreadCreatorLikedUris] = useState<Set<string>>(new Set());
  const threadViewerDid = currentUser.value?.did;
  // Use global followingDids signal for instant availability
  const threadFollowingDids = followingDids.value;

  const handleThreadAvatarFollow = useCallback(async (authorDid: string) => {
    const meDid = currentUser.value?.did;
    if (!meDid) {
      showAuthDialog.value = true;
      return;
    }
    setAvatarFollowBusyDid(authorDid);
    try {
      await followActor(meDid, authorDid);
      followingDids.value = new Set(followingDids.value ?? []).add(authorDid);
    } catch (e) {
      showToast(e instanceof XRPCError ? e.message : 'Could not follow');
    } finally {
      setAvatarFollowBusyDid(null);
    }
  }, []);

  useEffect(() => {
    setComposerDismissed(false);
    setReplyTarget(null);
    setQuoteTarget(null);
    setKbFocusPost(1);
    setKbOutlineActive(false);
    setSavedUi(isThreadSaved(thread.forumPost.root.uri));
    setLocalHiddenList(getLocallyHiddenPostUris(thread.forumPost.root.uri));
    setCollapsedNestedChains(new Set());
    composeFromQueryConsumedRef.current = false;
  }, [actor, rkey, thread.forumPost.root.uri]);

  const bumpLocalHidden = useCallback(() => {
    setLocalHiddenList(getLocallyHiddenPostUris(thread.forumPost.root.uri));
  }, [thread.forumPost.root.uri]);

  const toggleNestedChainCollapsed = useCallback((commentPostUri: string) => {
    setCollapsedNestedChains(prev => {
      const next = new Set(prev);
      if (next.has(commentPostUri)) next.delete(commentPostUri);
      else next.add(commentPostUri);
      return next;
    });
  }, []);

  useEffect(() => {
    kbFocusPostRef.current = kbFocusPost;
  }, [kbFocusPost]);

  const { forumPost, comments } = thread;
  const rootPost = forumPost.root;

  // When global composer is opened from this thread, set reply context to thread root
  useEffect(() => {
    if (showGlobalComposer.value && !globalComposerReplyTo.value && !globalComposerCommunity.value) {
      // Set reply to thread root when global composer is opened from a thread
      globalComposerReplyTo.value = {
        root: { uri: rootPost.uri, cid: rootPost.cid },
        parent: { uri: rootPost.uri, cid: rootPost.cid },
        summary: `Thread root · @${rootPost.author.handle} · post (1)`,
        record: rootPost.record as { text?: string; embed?: unknown } | undefined,
        author: {
          handle: rootPost.author.handle,
          displayName: rootPost.author.displayName,
          avatar: rootPost.author.avatar,
        },
      };
    }
  }, [showGlobalComposer.value, rootPost.uri, rootPost.cid, rootPost.author.handle, rootPost.record, rootPost.author.displayName, rootPost.author.avatar]);
  const hiddenLocal = new Set(localHiddenList);
  const rootMuted =
    mutedDids.value.has(rootPost.author.did) || blockedDids.value.has(rootPost.author.did);
  const visibleComments = comments.filter(
    c =>
      !hiddenLocal.has(c.post.uri) &&
      !mutedDids.value.has(c.post.author.did) &&
      !blockedDids.value.has(c.post.author.did),
  );

  // Virtual scrolling disabled for comments due to variable heights causing scroll glitches

  useEffect(() => {
    replyCountAnnounceRef.current = -1;
  }, [actor, rkey]);

  useEffect(() => {
    const gen = ++downvoteGenRef.current;
    setDownvoteCountOptimisticDelta({});
    if (downvoteTimerRef.current != null) {
      clearTimeout(downvoteTimerRef.current);
      downvoteTimerRef.current = null;
    }
    const uris = collectMergedThreadPostUris(thread);
    const scheduleBackground = (task: () => void, idleTimeout = 1200) => {
      if (typeof window === 'undefined') {
        task();
        return;
      }
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (w.requestIdleCallback) {
        w.requestIdleCallback(task, { timeout: idleTimeout });
        return;
      }
      window.setTimeout(task, 0);
    };
    const outer = window.setTimeout(() => {
      if (gen !== downvoteGenRef.current) return;
      if (uris.length > 0) {
        scheduleBackground(() => {
          if (gen !== downvoteGenRef.current) return;
          void getDownvoteCounts(uris)
            .then(counts => {
              if (gen !== downvoteGenRef.current) return;
              setDownvoteCounts(counts);
            })
            .catch(() => {});
        });
      } else {
        setDownvoteCounts({});
      }
      const did = currentUser.value?.did;
      if (isLoggedIn.value && did) {
        scheduleBackground(() => {
          if (gen !== downvoteGenRef.current) return;
          void listMyDownvotes(did)
            .then(votes => {
              if (gen !== downvoteGenRef.current) return;
              setMyDownvotes(votes);
            })
            .catch(() => {});
        });
      } else {
        setMyDownvotes({});
      }
    }, 2000);
    downvoteTimerRef.current = outer;
    return () => {
      downvoteGenRef.current += 1;
      if (downvoteTimerRef.current != null) {
        clearTimeout(downvoteTimerRef.current);
        downvoteTimerRef.current = null;
      }
    };
  }, [thread]);

  // Fetch likes for visible comments to check if thread creator (OP) liked them
  useEffect(() => {
    const threadCreatorDid = rootPost.author.did;
    const abortController = new AbortController();

    async function fetchThreadCreatorLikes() {
      const likedUris = new Set<string>();

      // Fetch likes for each visible comment (limited to first 20 to avoid too many requests)
      const commentsToCheck = visibleComments.slice(0, 20);

      await Promise.all(
        commentsToCheck.map(async (comment) => {
          try {
            const likesRes = await getLikes(comment.post.uri, {
              cid: comment.post.cid,
              limit: 50,
            });
            const threadCreatorLiked = likesRes.likes.some(
              (like) => like.actor.did === threadCreatorDid,
            );
            if (threadCreatorLiked) {
              likedUris.add(comment.post.uri);
            }
          } catch {
            // Silently ignore errors for individual comments
          }
        }),
      );

      if (!abortController.signal.aborted) {
        setThreadCreatorLikedUris(likedUris);
      }
    }

    if (visibleComments.length > 0) {
      void fetchThreadCreatorLikes();
    } else {
      setThreadCreatorLikedUris(new Set());
    }

    return () => abortController.abort();
  }, [visibleComments, rootPost.author.did]);

  useEffect(() => {
    const n = visibleComments.length;
    const prev = replyCountAnnounceRef.current;
    if (prev >= 0 && n > prev) {
      const d = n - prev;
      setAriaLiveReplies(`${d} new ${d === 1 ? 'reply' : 'replies'} loaded`);
      window.setTimeout(() => setAriaLiveReplies(''), 4000);
    }
    replyCountAnnounceRef.current = n;
  }, [visibleComments.length]);

  const threadIndex = buildThreadPostIndex(thread);

  // Handle ?focus=uri query param: scroll to the specific post on load
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const focusUri = params.get('focus');
    if (!focusUri) return;
    const postNumber = threadIndex.postNumberByUri.get(focusUri);
    if (!postNumber) return;
    // Small delay to ensure DOM is rendered
    const id = window.setTimeout(() => {
      scrollToThreadPost(postNumber);
      // Clean up the focus param from URL without reloading
      params.delete('focus');
      const qs = params.toString();
      window.history.replaceState(
        null,
        '',
        window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
      );
    }, 100);
    return () => window.clearTimeout(id);
  }, [threadIndex]);

  const communityTag = extractFirstHashtag(rootPost);
  const title = formatThreadTitlePreviewLine(rootPost.record.text.split('\n')[0]);
  const rootTone = toneIndexForHandle(rootPost.author.handle);
  const rootAuthorName = rootPost.author.displayName || rootPost.author.handle;

  const threadReplyTo = useMemo(
    (): { root: StrongRef; parent: StrongRef } => ({
      root: { uri: rootPost.uri, cid: rootPost.cid },
      parent: replyTarget?.parent ?? { uri: rootPost.uri, cid: rootPost.cid },
    }),
    [rootPost.uri, rootPost.cid, replyTarget],
  );
  const replyToForComposer = quoteTarget ? undefined : threadReplyTo;
  const quoteEmbedForComposer = quoteTarget
    ? { uri: quoteTarget.post.uri, cid: quoteTarget.post.cid }
    : undefined;

  const defaultReplySummary = `Thread root · @${rootPost.author.handle} · post (1)`;
  const replyTargetSummary = replyTarget?.summary ?? defaultReplySummary;

  const directRepliesByParentUri = useMemo(
    () => buildDirectRepliesByParentUri(visibleComments),
    [visibleComments],
  );

  const nestedCommentRoots = useMemo(
    () => buildNestedCommentTree(visibleComments, forumPost.segments),
    [visibleComments, forumPost.segments],
  );

  const postByKeyboardNumber = useMemo(() => {
    const m = new Map<number, PostView>();
    m.set(1, rootPost);
    // Use threadIndex which has correct numbering from unfiltered comments
    for (const [uri, postNum] of threadIndex.postNumberByUri) {
      if (postNum !== 1) {
        const pv = threadIndex.postByUri.get(uri);
        if (pv) m.set(postNum, pv);
      }
    }
    return m;
  }, [rootPost, threadIndex]);

  const maxKbPostNum = useMemo(() => {
    let max = 1;
    for (const n of threadIndex.postNumberByUri.values()) {
      if (n > max) max = n;
    }
    return max;
  }, [threadIndex]);

  const persistCommentLayout = (mode: ThreadCommentLayoutMode) => {
    setCommentLayoutMode(mode);
    try {
      localStorage.setItem(COMMENT_LAYOUT_STORAGE_KEY, mode);
    } catch {
      /* ignore quota / private mode */
    }
  };

  const handleReplyClick = useCallback((parent: StrongRef, authorHandle: string, postNumber: number) => {
    if (!isLoggedIn.value) {
      showAuthDialog.value = true;
      return;
    }
    setComposerDismissed(false);
    setQuoteTarget(null);
    setReplyTarget({
      parent,
      summary: `@${authorHandle} · post (${postNumber})`,
    });
    setComposerFocusRequest(n => n + 1);
  }, []);

  const handleQuoteRepostClick = (post: PostView, postNumber: number) => {
    if (!isLoggedIn.value) {
      showAuthDialog.value = true;
      return;
    }
    setComposerDismissed(false);
    setReplyTarget(null);
    setQuoteTarget({ post, postNumber });
    setComposerFocusRequest(n => n + 1);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const wantReply = params.get('reply') === '1';
    const wantQuote = params.get('quote') === '1';
    if (!wantReply && !wantQuote) return;
    if (composeFromQueryConsumedRef.current) return;
    composeFromQueryConsumedRef.current = true;
    params.delete('reply');
    params.delete('quote');
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    );
    if (!isLoggedIn.value) {
      showAuthDialog.value = true;
      return;
    }
    setComposerDismissed(false);
    if (wantQuote) {
      setReplyTarget(null);
      setQuoteTarget({ post: rootPost, postNumber: 1 });
    } else {
      setQuoteTarget(null);
      setReplyTarget({
        parent: { uri: rootPost.uri, cid: rootPost.cid },
        summary: `@${rootPost.author.handle} · post (1)`,
      });
    }
    setComposerFocusRequest(n => n + 1);
  }, [actor, rkey, rootPost.uri, rootPost.cid, rootPost.author.handle]);

  const handleDownvotePost = useCallback(
    async (subjectUri: string, subjectCid: string) => {
      if (!isLoggedIn.value) {
        showAuthDialog.value = true;
        return;
      }
      const did = currentUser.value?.did;
      if (!did) return;
      const currentRecord = myDownvotes[subjectUri];
      setDownvoteLoadingUri(subjectUri);
      try {
        if (currentRecord) {
          await deleteDownvote(currentRecord, did);
          setMyDownvotes(m => {
            const next = { ...m };
            delete next[subjectUri];
            return next;
          });
          setDownvoteCountOptimisticDelta(d => ({
            ...d,
            [subjectUri]: (d[subjectUri] ?? 0) - 1,
          }));
        } else {
          const res = await createDownvote(did, { uri: subjectUri, cid: subjectCid });
          setMyDownvotes(m => ({ ...m, [subjectUri]: res.uri }));
          setDownvoteCountOptimisticDelta(d => ({
            ...d,
            [subjectUri]: (d[subjectUri] ?? 0) + 1,
          }));
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not update downvote');
      } finally {
        setDownvoteLoadingUri(null);
      }
    },
    [myDownvotes],
  );

  const refreshThread = async () => {
    const res = await getPostThread(rootPost.uri);
    if (isThreadViewPost(res.thread)) setThread(mergeThread(res.thread));
  };

  const handleOwnPostDeleted = useCallback(
    async (deletedPostNumber: number, detail: OwnPostDeletedDetail) => {
      showToast('Post deleted');
      if (deletedPostNumber !== 1) {
        const res = await getPostThread(rootPost.uri);
        if (isThreadViewPost(res.thread)) setThread(mergeThread(res.thread));
        return;
      }
      if (detail.scope === 'all') {
        navigate(communityTag ? communityUrl(communityTag) : '/');
        return;
      }
      const { deletedUri, survivorUrisOldestFirst } = detail;
      if (survivorUrisOldestFirst.length === 0) {
        navigate(communityTag ? communityUrl(communityTag) : '/');
        return;
      }
      if (deletedUri !== rootPost.uri) {
        try {
          const res = await getPostThread(rootPost.uri);
          if (isThreadViewPost(res.thread)) {
            setThread(mergeThread(res.thread));
            return;
          }
        } catch {
          /* thread anchor may be gone */
        }
      }
      const focalUri = survivorUrisOldestFirst[0];
      try {
        const { posts } = await getPosts([focalUri]);
        const pv = posts[0];
        if (pv) {
          const pr = parseAtUri(pv.uri);
          if (pr) {
            navigate(threadUrl(pv.author.handle || pv.author.did, pr.rkey));
            return;
          }
        }
      } catch {
        /* fall through */
      }
      navigate(communityTag ? communityUrl(communityTag) : '/');
    },
    [communityTag, rootPost.uri, setThread],
  );

  useEffect(() => {
    document.title = `${title} · ForumSky`;
    const abs =
      typeof window !== 'undefined' ? `${window.location.origin}/t/${encodeURIComponent(actor)}/${encodeURIComponent(rkey)}` : '';
    const setMeta = (attrName: 'name' | 'property', key: string, content: string) => {
      if (typeof document === 'undefined') return;
      let el = document.querySelector(`meta[${attrName}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attrName, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };
    setMeta('property', 'og:title', `${title} · ForumSky`);
    const desc = rootPost.record.text.slice(0, 200).replace(/\s+/g, ' ').trim();
    setMeta('name', 'description', desc || 'Thread on ForumSky');
    setMeta('property', 'og:description', desc || 'Thread on ForumSky');
    if (abs) setMeta('property', 'og:url', abs);
    return () => {
      document.title = 'ForumSky';
    };
  }, [title, actor, rkey, rootPost.record.text]);

  useEffect(() => {
    const onMouseUp = () => {
      const stack = threadStackRef.current;
      if (!stack) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const t = sel.toString().trim();
      if (t.length < 3) {
        setSelectionQuote(null);
        return;
      }
      const a = sel.anchorNode;
      const node = a?.nodeType === Node.TEXT_NODE ? a.parentElement : (a as HTMLElement | null);
      if (!node || !stack.contains(node)) {
        setSelectionQuote(null);
        return;
      }
      const lines = t.split(/\n/).map(l => l.trim()).filter(Boolean);
      setSelectionQuote(lines.map(l => `> ${l}`).join('\n'));
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const tgt = e.target as HTMLElement;
      if (
        tgt.tagName === 'INPUT' ||
        tgt.tagName === 'TEXTAREA' ||
        tgt.tagName === 'SELECT' ||
        tgt.isContentEditable
      ) {
        if (e.key === 'Escape') tgt.blur();
        return;
      }
      const down =
        e.key === 's' || e.key === 'ArrowDown' || e.key === 'd' || e.key === 'ArrowRight';
      const up =
        e.key === 'w' || e.key === 'ArrowUp' || e.key === 'a' || e.key === 'ArrowLeft';
      if (down || up) {
        e.preventDefault();
        setKbOutlineActive(true);
        setKbFocusPost(
          Math.min(maxKbPostNum, Math.max(1, kbFocusPostRef.current + (down ? 1 : -1))),
        );
        return;
      }
      if (e.key === 'e' || e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('thread-reply-textarea')?.focus();
        return;
      }
      if (e.key === 'r') {
        e.preventDefault();
        const pv = postByKeyboardNumber.get(kbFocusPostRef.current);
        if (!pv || !isLoggedIn.value) {
          if (!isLoggedIn.value) showAuthDialog.value = true;
          return;
        }
        handleReplyClick(
          { uri: pv.uri, cid: pv.cid },
          pv.author.handle,
          kbFocusPostRef.current,
        );
        return;
      }
      if (e.key === 'f' || e.code === 'Space') {
        e.preventDefault();
        document
          .querySelector<HTMLButtonElement>(`#thread-post-${kbFocusPostRef.current} .post-like-btn`)
          ?.click();
        return;
      }
      if (e.key === 'm' || e.key === '`') {
        e.preventDefault();
        document
          .querySelector<HTMLButtonElement>(`#thread-post-${kbFocusPostRef.current} .post-overflow-btn`)
          ?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maxKbPostNum, postByKeyboardNumber, handleReplyClick]);

  useLayoutEffect(() => {
    if (!kbOutlineActive) return;
    scrollToThreadPost(kbFocusPost);
  }, [kbFocusPost, kbOutlineActive]);

  useLayoutEffect(() => {
    if (composerFocusRequest === 0) return;
    document.getElementById('thread-composer-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [composerFocusRequest]);

  const flatOrderUris = useMemo(
    () => [rootPost.uri, ...visibleComments.map(c => c.post.uri)],
    [rootPost.uri, visibleComments],
  );
  const lastReadUri = getLastReadPostUri(rootPost.uri);
  const jumpToNewTargetNum = useMemo(() => {
    if (!lastReadUri || flatOrderUris.length < 2) return null;
    const idx = flatOrderUris.indexOf(lastReadUri);
    if (idx < 0) return 2;
    const nextUri = flatOrderUris[idx + 1];
    if (!nextUri) return null;
    return flatOrderUris.indexOf(nextUri) + 1;
  }, [flatOrderUris, lastReadUri]);

  const lastCommentPost =
    visibleComments.length > 0 ? visibleComments[visibleComments.length - 1].post : null;

  const showComposerAfterPost = (post: PostView) => {
    if (composerDismissed) return false;
    if (quoteTarget && quoteTarget.post.uri === post.uri) return true;
    if (replyTarget === null) {
      // In nested view, bottom composer handles "reply to thread end" - no inline composers
      if (commentLayoutMode === 'nested') return false;
      if (lastCommentPost) {
        return post.uri === lastCommentPost.uri;
      }
      return post.uri === rootPost.uri;
    }
    return replyTarget.parent.uri === post.uri;
  };

  const dismissComposer = () => {
    setComposerDismissed(true);
    setReplyTarget(null);
    setQuoteTarget(null);
  };

  if (rootMuted) {
    return (
      <div class="empty" style="padding:24px">
        <p>This thread is from an account you have muted or blocked.</p>
        <button type="button" class="btn btn-primary" style="margin-top:12px" onClick={() => navigate('/')}>
          Home
        </button>
      </div>
    );
  }

  const mergedTextForPostNumber = useCallback(
    (postNum: number): string | null => {
      if (postNum === 1) {
        return forumPost.segments.map(s => s.record.text).join('\n\n');
      }
      // Find the comment with this post number in threadIndex
      for (const [uri, n] of threadIndex.postNumberByUri) {
        if (n === postNum) {
          const pv = threadIndex.postByUri.get(uri);
          // Check if this is a segmented post (forum comment)
          if (pv?.record.text != null) {
            // Need to find the full comment segments
            const comment = comments.find(c => c.post.uri === uri);
            if (comment) {
              return comment.segments.map(s => s.record.text).join('\n\n');
            }
            return pv.record.text;
          }
        }
      }
      return null;
    },
    [forumPost.segments, comments, threadIndex],
  );

  return (
    <ThreadTranslationProvider threadRootUri={rootPost.uri}>
    <div>
      <div class="thread-page-header">
        <div class="breadcrumb">
          {communityTag ? (
            <>
              <a
                href={hrefForAppPath('/')}
                {...SPA_ANCHOR_SHIELD}
                onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}
              >
                ForumSky
              </a>
              <span class="sep">&gt;</span>
              <a
                href={hrefForAppPath(communityUrl(communityTag))}
                {...SPA_ANCHOR_SHIELD}
                onClick={(e: Event) => { e.preventDefault(); navigate(communityUrl(communityTag)); }}
              >
                #{communityTag}
              </a>
            </>
          ) : (
            <a
              href={hrefForAppPath('/')}
              {...SPA_ANCHOR_SHIELD}
              onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}
            >
              ForumSky
            </a>
          )}
        </div>
        <div class="thread-page-title-block">
          <div class="thread-page-title">{title}</div>
          <div class={`thread-by-line username-tone-${rootTone}`}>
            by <span class="thread-by-name">{rootAuthorName}</span>
          </div>
          <div class="thread-title-actions-row">
            <div class="thread-toolbar" ref={quoteToolbarRef}>
              <button
                type="button"
                class="btn btn-sm btn-outline"
                onClick={async () => {
                  const on = await toggleSavedThread(rootPost.uri);
                  setSavedUi(on);
                  showToast(on ? 'Thread saved' : 'Removed from saved');
                }}
              >
                {savedUi ? 'Saved ★' : 'Save thread'}
              </button>
              {jumpToNewTargetNum != null && (
                <button
                  type="button"
                  class="btn btn-sm btn-outline"
                  onClick={() => scrollToThreadPost(jumpToNewTargetNum)}
                >
                  {t('thread.jumpToNew')}
                </button>
              )}
              {localHiddenList.length > 0 && (
                <button
                  type="button"
                  class="btn btn-sm btn-outline"
                  title={Object.entries(getLocalHideReasons(rootPost.uri))
                    .map(([u, r]) => `${u.slice(-12)}: ${r}`)
                    .join(' · ')}
                  onClick={() => {
                    if (!window.confirm('Show all posts you hid locally in this thread?')) return;
                    clearLocallyHiddenForThread(rootPost.uri);
                    bumpLocalHidden();
                    showToast('Local hides cleared');
                  }}
                >
                  Clear local hides ({localHiddenList.length})
                </button>
              )}
            </div>
            {comments.length > 0 && (
              <div class="thread-comment-layout" role="group" aria-label="Comment display order">
                <span class="thread-comment-layout-label">Comments</span>
                <div class="thread-comment-layout-toggle">
                  <button
                    type="button"
                    class={commentLayoutMode === 'forum' ? 'thread-layout-btn thread-layout-btn--active' : 'thread-layout-btn'}
                    onClick={() => persistCommentLayout('forum')}
                    aria-pressed={commentLayoutMode === 'forum'}
                  >
                    Forum
                  </button>
                  <button
                    type="button"
                    class={commentLayoutMode === 'nested' ? 'thread-layout-btn thread-layout-btn--active' : 'thread-layout-btn'}
                    onClick={() => persistCommentLayout('nested')}
                    aria-pressed={commentLayoutMode === 'nested'}
                  >
                    Nested
                  </button>
                </div>
              </div>
            )}
          </div>
          {selectionQuote && (
            <div class="thread-quote-selection-bar" role="region" aria-label="Quote selection">
              <span class="thread-quote-selection-hint">Quote this text in your reply?</span>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                onClick={() => {
                  setAppendQuoteRequest({ id: Date.now(), text: selectionQuote });
                  setSelectionQuote(null);
                  window.getSelection()?.removeAllRanges();
                  setComposerDismissed(false);
                  setComposerFocusRequest(n => n + 1);
                }}
              >
                Add to reply
              </button>
              <button type="button" class="btn btn-sm btn-outline" onClick={() => setSelectionQuote(null)}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>

      <div class="thread-aria-live-region" aria-live="polite" aria-atomic="true">
        {ariaLiveReplies}
      </div>

      <div class="thread-post-stack panel panel-following-feed-list" ref={threadStackRef}>
        <PostBlock
          segments={forumPost.segments}
          root={forumPost.root}
          postNumber={1}
          threadRootUri={rootPost.uri}
          threadIndex={threadIndex}
          mergedTextForPostNumber={mergedTextForPostNumber}
          kbFocusPost={kbFocusPost}
          kbOutlineActive={kbOutlineActive}
          onOwnPostDeleted={handleOwnPostDeleted}
          onReply={handleReplyClick}
          onQuoteRepost={handleQuoteRepostClick}
          onLocalHide={bumpLocalHidden}
          downvoteRecordUri={myDownvotes[forumPost.root.uri]}
          downvoteDisplayCount={Math.max(
            0,
            (downvoteCounts[forumPost.root.uri] ?? 0) +
              (downvoteCountOptimisticDelta[forumPost.root.uri] ?? 0),
          )}
          onDownvotePost={handleDownvotePost}
          downvoteBusy={downvoteLoadingUri === forumPost.root.uri}
          threadFollowingDids={threadFollowingDids}
          avatarFollowBusyDid={avatarFollowBusyDid}
          onThreadAvatarFollow={handleThreadAvatarFollow}
        />

        {showComposerAfterPost(forumPost.root) && (
          <ThreadInlineComposer
            key={`${replyTarget?.parent.uri ?? 'r'}-${quoteTarget?.post.uri ?? 'q'}`}
            replyTo={replyToForComposer}
            quoteEmbed={quoteEmbedForComposer}
            replyTargetSummary={replyTargetSummary}
            composerFocusRequest={composerFocusRequest}
            draftRootUri={rootPost.uri}
            appendTextRequest={appendQuoteRequest}
            onDismiss={dismissComposer}
            onPosted={async () => {
              await refreshThread();
              setReplyTarget(null);
              setQuoteTarget(null);
            }}
          />
        )}

        {commentLayoutMode === 'forum'
          ? (
            <div>
              {visibleComments.map((comment) => (
                <Fragment key={comment.post.uri}>
                  <PostBlock
                    segments={comment.segments}
                    root={comment.post}
                    postNumber={threadIndex.postNumberByUri.get(comment.post.uri) ?? 0}
                    threadRootUri={rootPost.uri}
                    threadIndex={threadIndex}
                    mergedTextForPostNumber={mergedTextForPostNumber}
                    childReplies={getChildRepliesForSegments(
                      comment.segments,
                      directRepliesByParentUri,
                    )}
                    kbFocusPost={kbFocusPost}
                    kbOutlineActive={kbOutlineActive}
                    onOwnPostDeleted={handleOwnPostDeleted}
                    onReply={handleReplyClick}
                    onQuoteRepost={handleQuoteRepostClick}
                    onLocalHide={bumpLocalHidden}
                    downvoteRecordUri={myDownvotes[comment.post.uri]}
                    downvoteDisplayCount={Math.max(
                      0,
                      (downvoteCounts[comment.post.uri] ?? 0) +
                        (downvoteCountOptimisticDelta[comment.post.uri] ?? 0),
                    )}
                    onDownvotePost={handleDownvotePost}
                    downvoteBusy={downvoteLoadingUri === comment.post.uri}
                    threadFollowingDids={threadFollowingDids}
                    avatarFollowBusyDid={avatarFollowBusyDid}
                    onThreadAvatarFollow={handleThreadAvatarFollow}
                    threadCreatorLiked={threadCreatorLikedUris.has(comment.post.uri)}
                    threadCreatorAvatar={rootPost.author.avatar}
                    threadCreatorDisplayName={rootPost.author.displayName || rootPost.author.handle}
                  />
                  {showComposerAfterPost(comment.post) && (
                    (() => {
                      const composer = (
                        <ThreadInlineComposer
                          key={`${replyTarget?.parent.uri ?? 'r'}-${quoteTarget?.post.uri ?? 'q'}`}
                          replyTo={replyToForComposer}
                          quoteEmbed={quoteEmbedForComposer}
                          replyTargetSummary={replyTargetSummary}
                          composerFocusRequest={composerFocusRequest}
                          draftRootUri={rootPost.uri}
                          appendTextRequest={appendQuoteRequest}
                          onDismiss={dismissComposer}
                          onPosted={async () => {
                            await refreshThread();
                            setReplyTarget(null);
                            setQuoteTarget(null);
                          }}
                        />
                      );
                      return replyTarget ? (
                        <div class="thread-composer-forum-indent">{composer}</div>
                      ) : composer;
                    })()
                  )}
                </Fragment>
              ))}
            </div>
          )
          : nestedCommentRoots.map((node, index) => {
              const topCommentId = `top-comment-${index}`;
              return (
                <div key={node.comment.post.uri} id={topCommentId} class="top-comment-wrapper">
                  <ThreadNestedCommentBranch
                    node={node}
                    threadRootUri={rootPost.uri}
                    threadIndex={threadIndex}
                    mergedTextForPostNumber={mergedTextForPostNumber}
                    kbFocusPost={kbFocusPost}
                    kbOutlineActive={kbOutlineActive}
                    draftRootUri={rootPost.uri}
                    appendQuoteRequest={appendQuoteRequest}
                    collapsedNestedChains={collapsedNestedChains}
                    onToggleNestedChainCollapse={toggleNestedChainCollapsed}
                    onOwnPostDeleted={handleOwnPostDeleted}
                    onReply={handleReplyClick}
                    onQuoteRepost={handleQuoteRepostClick}
                    showComposerAfterPost={showComposerAfterPost}
                    replyToForComposer={replyToForComposer}
                    quoteEmbedForComposer={quoteEmbedForComposer}
                    replyTargetSummary={replyTargetSummary}
                    composerFocusRequest={composerFocusRequest}
                    onDismissComposer={dismissComposer}
                    onPosted={async () => {
                      await refreshThread();
                      setReplyTarget(null);
                      setQuoteTarget(null);
                    }}
                    onLocalHide={bumpLocalHidden}
                    myDownvotes={myDownvotes}
                    downvoteCounts={downvoteCounts}
                    downvoteCountOptimisticDelta={downvoteCountOptimisticDelta}
                    downvoteLoadingUri={downvoteLoadingUri}
                    onDownvotePost={handleDownvotePost}
                    threadFollowingDids={threadFollowingDids}
                    avatarFollowBusyDid={avatarFollowBusyDid}
                    onThreadAvatarFollow={handleThreadAvatarFollow}
                    threadCreatorLiked={threadCreatorLikedUris.has(node.comment.post.uri)}
                    threadCreatorAvatar={rootPost.author.avatar}
                    threadCreatorDisplayName={rootPost.author.displayName || rootPost.author.handle}
                  />
                </div>
              );
            })}

        {/* Default reply box at bottom of thread in nested view (only when no active reply/quote) */}
        {commentLayoutMode === 'nested' && !replyTarget && !quoteTarget && !composerDismissed && (
          <ThreadInlineComposer
            key="nested-bottom-composer"
            replyTo={threadReplyTo}
            replyTargetSummary={defaultReplySummary}
            composerFocusRequest={composerFocusRequest}
            draftRootUri={rootPost.uri}
            appendTextRequest={appendQuoteRequest}
            onDismiss={dismissComposer}
            onPosted={async () => {
              await refreshThread();
              setReplyTarget(null);
              setQuoteTarget(null);
            }}
          />
        )}
      </div>

      <CrossDiscussionPanel rootPost={rootPost} />
      
      <ScrollNavigation 
        isNestedMode={commentLayoutMode === 'nested'}
        topCommentCount={nestedCommentRoots.length}
      />
    </div>
    </ThreadTranslationProvider>
  );
}

function ThreadInlineComposer({
  replyTo,
  quoteEmbed,
  replyTargetSummary,
  composerFocusRequest,
  draftRootUri,
  appendTextRequest,
  onDismiss,
  onPosted,
}: {
  replyTo?: { root: StrongRef; parent: StrongRef };
  quoteEmbed?: StrongRef;
  replyTargetSummary: string;
  composerFocusRequest: number;
  draftRootUri: string;
  appendTextRequest: { id: number; text: string };
  onDismiss: () => void;
  onPosted: () => Promise<void>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={wrapRef} id="thread-composer-anchor" class="thread-composer-wrap thread-composer-inline">
      <Composer
        replyTo={replyTo}
        quoteEmbed={quoteEmbed}
        replyTargetSummary={replyTargetSummary}
        focusRequest={composerFocusRequest}
        draftKey={`thread:${draftRootUri}`}
        appendTextRequest={appendTextRequest}
        textareaId="thread-reply-textarea"
        className="thread-composer"
        onPost={onPosted}
        onCancel={onDismiss}
      />
    </div>
  );
}

/** Total merged comment blocks under this node (recursive). */
function countNestedChainPosts(node: CommentTreeNode): number {
  return node.children.reduce((sum, ch) => sum + 1 + countNestedChainPosts(ch), 0);
}

/**
 * Handle of the post these nested replies actually reply to (`reply.parent`), same resolution as each
 * child’s ReplyToParentLine. When the tree groups a comment under the wrong anchor, the anchor author
 * can differ from the real parent (e.g. back-and-forth / orphaned branches).
 */
function nestedChainReplyTargetHandle(
  node: CommentTreeNode,
  threadIndex: ReturnType<typeof buildThreadPostIndex>,
): string {
  const fallback = node.comment.post.author.handle;
  if (node.children.length === 0) return fallback;

  const handles = new Set<string>();
  for (const ch of node.children) {
    const uri = ch.comment.post.record.reply?.parent?.uri;
    if (!uri) continue;
    const pv = threadIndex.postByUri.get(uri);
    if (pv?.author.handle) handles.add(pv.author.handle);
  }
  if (handles.size === 1) {
    return [...handles][0];
  }
  return fallback;
}

function ThreadNestedCommentBranch({
  node,
  threadRootUri,
  threadIndex,
  mergedTextForPostNumber,
  kbFocusPost,
  kbOutlineActive,
  draftRootUri,
  appendQuoteRequest,
  collapsedNestedChains,
  onToggleNestedChainCollapse,
  onOwnPostDeleted,
  onReply,
  onQuoteRepost,
  showComposerAfterPost,
  replyToForComposer,
  quoteEmbedForComposer,
  replyTargetSummary,
  composerFocusRequest,
  onDismissComposer,
  onPosted,
  onLocalHide,
  myDownvotes,
  downvoteCounts,
  downvoteCountOptimisticDelta,
  downvoteLoadingUri,
  onDownvotePost,
  threadFollowingDids,
  avatarFollowBusyDid,
  onThreadAvatarFollow,
  threadCreatorLiked,
  threadCreatorAvatar,
  threadCreatorDisplayName,
}: {
  node: CommentTreeNode;
  threadRootUri: string;
  threadIndex: ThreadPostIndex;
  mergedTextForPostNumber: (postNum: number) => string | null;
  kbFocusPost: number;
  kbOutlineActive: boolean;
  draftRootUri: string;
  appendQuoteRequest: { id: number; text: string };
  collapsedNestedChains: Set<string>;
  onToggleNestedChainCollapse: (commentPostUri: string) => void;
  onOwnPostDeleted: (postNumber: number, detail: OwnPostDeletedDetail) => void | Promise<void>;
  onReply: (parent: StrongRef, authorHandle: string, postNumber: number) => void;
  onQuoteRepost: (post: PostView, postNumber: number) => void;
  showComposerAfterPost: (post: PostView) => boolean;
  replyToForComposer?: { root: StrongRef; parent: StrongRef };
  quoteEmbedForComposer?: StrongRef;
  replyTargetSummary: string;
  composerFocusRequest: number;
  onDismissComposer: () => void;
  onPosted: () => Promise<void>;
  onLocalHide: () => void;
  myDownvotes: Record<string, string>;
  downvoteCounts: Record<string, number>;
  downvoteCountOptimisticDelta: Record<string, number>;
  downvoteLoadingUri: string | null;
  onDownvotePost: (uri: string, cid: string) => void | Promise<void>;
  threadFollowingDids: Set<string> | null;
  avatarFollowBusyDid: string | null;
  onThreadAvatarFollow: (authorDid: string) => void | Promise<void>;
  threadCreatorLiked?: boolean;
  threadCreatorAvatar?: string;
  threadCreatorDisplayName?: string;
}) {
  const c = node.comment;
  const postNumber = threadIndex.postNumberByUri.get(c.post.uri) ?? 0;
  /** Stripe = who direct children are replying to (Bluesky parent), same idea as their “Replying to …” line. */
  const threadBranchTone = toneIndexForHandle(nestedChainReplyTargetHandle(node, threadIndex));
  const threadBranchToneClass = `thread-nested-thread-tone-${threadBranchTone}`;
  const chainCollapsed = collapsedNestedChains.has(c.post.uri);
  const nestedCount = node.children.length > 0 ? countNestedChainPosts(node) : 0;
  const nestedRegionId = `thread-nested-chain-${postNumber}`;

  return (
    <Fragment>
      <PostBlock
        segments={c.segments}
        root={c.post}
        postNumber={postNumber}
        threadRootUri={threadRootUri}
        threadIndex={threadIndex}
        mergedTextForPostNumber={mergedTextForPostNumber}
        childReplies={[]}
        kbFocusPost={kbFocusPost}
        kbOutlineActive={kbOutlineActive}
        onOwnPostDeleted={onOwnPostDeleted}
        onReply={onReply}
        onQuoteRepost={onQuoteRepost}
        onLocalHide={onLocalHide}
        downvoteRecordUri={myDownvotes[c.post.uri]}
        downvoteDisplayCount={Math.max(
          0,
          (downvoteCounts[c.post.uri] ?? 0) + (downvoteCountOptimisticDelta[c.post.uri] ?? 0),
        )}
        onDownvotePost={onDownvotePost}
        downvoteBusy={downvoteLoadingUri === c.post.uri}
        threadFollowingDids={threadFollowingDids}
        avatarFollowBusyDid={avatarFollowBusyDid}
        onThreadAvatarFollow={onThreadAvatarFollow}
        threadCreatorLiked={threadCreatorLiked}
        threadCreatorAvatar={threadCreatorAvatar}
        threadCreatorDisplayName={threadCreatorDisplayName}
      />
      {showComposerAfterPost(c.post) && (
        <ThreadInlineComposer
          key={`${replyToForComposer?.parent.uri ?? 'r'}-${quoteEmbedForComposer?.uri ?? 'q'}`}
          replyTo={replyToForComposer}
          quoteEmbed={quoteEmbedForComposer}
          replyTargetSummary={replyTargetSummary}
          composerFocusRequest={composerFocusRequest}
          draftRootUri={draftRootUri}
          appendTextRequest={appendQuoteRequest}
          onDismiss={onDismissComposer}
          onPosted={onPosted}
        />
      )}
      {node.children.length > 0 && (
        chainCollapsed ? (
          <div class={`thread-nested-chain thread-nested-chain--collapsed ${threadBranchToneClass}`}>
            <button
              type="button"
              class="thread-nested-chain-rail"
              aria-hidden="true"
              tabIndex={-1}
              title="Show nested replies"
              onClick={() => onToggleNestedChainCollapse(c.post.uri)}
            >
            </button>
            <div class="thread-nested-chain-body">
              <button
                type="button"
                class="thread-nested-chain-expand"
                aria-expanded={false}
                aria-controls={nestedRegionId}
                onClick={() => onToggleNestedChainCollapse(c.post.uri)}
              >
                {nestedCount === 1
                  ? '1 reply hidden — show'
                  : `${nestedCount} replies hidden — show`}
              </button>
              <span class="thread-nested-chain-transparency-hint">
                Layout only — not moderated or removed.
              </span>
            </div>
          </div>
        ) : (
          <div class={`thread-nested-chain ${threadBranchToneClass}`}>
            <button
              type="button"
              class="thread-nested-chain-rail"
              aria-expanded={true}
              aria-controls={nestedRegionId}
              aria-label="Minimize nested reply chain"
              title="Minimize chain"
              onClick={() => onToggleNestedChainCollapse(c.post.uri)}
            >
            </button>
            <div class="thread-nested-chain-body">
              <div class="thread-nested-replies" id={nestedRegionId}>
                {node.children.map(child => (
                  <ThreadNestedCommentBranch
                    key={child.comment.post.uri}
                    node={child}
                    threadRootUri={threadRootUri}
                    threadIndex={threadIndex}
                    mergedTextForPostNumber={mergedTextForPostNumber}
                    kbFocusPost={kbFocusPost}
                    kbOutlineActive={kbOutlineActive}
                    draftRootUri={draftRootUri}
                    appendQuoteRequest={appendQuoteRequest}
                    collapsedNestedChains={collapsedNestedChains}
                    onToggleNestedChainCollapse={onToggleNestedChainCollapse}
                    onOwnPostDeleted={onOwnPostDeleted}
                    onReply={onReply}
                    onQuoteRepost={onQuoteRepost}
                    showComposerAfterPost={showComposerAfterPost}
                    replyToForComposer={replyToForComposer}
                    quoteEmbedForComposer={quoteEmbedForComposer}
                    replyTargetSummary={replyTargetSummary}
                    composerFocusRequest={composerFocusRequest}
                    onDismissComposer={onDismissComposer}
                    onPosted={onPosted}
                    onLocalHide={onLocalHide}
                    myDownvotes={myDownvotes}
                    downvoteCounts={downvoteCounts}
                    downvoteCountOptimisticDelta={downvoteCountOptimisticDelta}
                    downvoteLoadingUri={downvoteLoadingUri}
                    onDownvotePost={onDownvotePost}
                    threadFollowingDids={threadFollowingDids}
                    avatarFollowBusyDid={avatarFollowBusyDid}
                    onThreadAvatarFollow={onThreadAvatarFollow}
                    threadCreatorLiked={threadCreatorLiked}
                    threadCreatorAvatar={threadCreatorAvatar}
                    threadCreatorDisplayName={threadCreatorDisplayName}
                  />
                ))}
              </div>
            </div>
          </div>
        )
      )}
    </Fragment>
  );
}

function scrollToThreadPost(postNumber: number) {
  const el = document.getElementById(`thread-post-${postNumber}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('post-container--flash');
  window.setTimeout(() => el.classList.remove('post-container--flash'), 1600);
}

function quotePreviewSnippet(text: string, max = 240): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

type PostTranslateVia = 'on-device' | ThirdPartyTranslationVia;

function translationSourceLabel(via: PostTranslateVia): string {
  switch (via) {
    case 'on-device':
      return 'on-device translator (Chrome)';
    case 'mymemory':
      return 'MyMemory';
    case 'lingva':
      return 'Lingva';
  }
}

function translationSuccessToastMessage(
  viaPost: PostTranslateVia | null,
  viaReply: PostTranslateVia | null,
): string {
  if (viaPost && viaReply) {
    if (viaPost === viaReply) {
      return `Translated via ${translationSourceLabel(viaPost)}.`;
    }
    return `Translated via ${translationSourceLabel(viaPost)} (post) and ${translationSourceLabel(viaReply)} (quoted reply).`;
  }
  if (viaPost) return `Translated via ${translationSourceLabel(viaPost)}.`;
  if (viaReply) return `Translated via ${translationSourceLabel(viaReply)}.`;
  return 'Translated.';
}

/** Shared by thread post body + reply-preview translation (on-device then third-party). */
async function translatePostTextToTarget(
  text: string,
  sourceLang: string | null,
  target: string,
): Promise<{ ok: true; text: string; via: PostTranslateVia } | { ok: false }> {
  const src = sourceLang ?? 'en';
  const local = await translateWithOnDeviceTranslator(text, src, target);
  if (local.ok) return { ok: true, text: local.text, via: 'on-device' };
  const remote = await translateWithThirdPartyServices(text, src, target);
  if (remote.ok) return { ok: true, text: remote.text, via: remote.via };
  return { ok: false };
}

type ThreadPostIndex = ReturnType<typeof buildThreadPostIndex>;

/**
 * Hover preview + inline expand for a referenced thread post (same behavior as &gt;&gt; parent link).
 */
function ReferencedPostPeek({
  layout,
  targetUri,
  threadRootUri,
  threadIndex,
  buttonClassName,
  jumpPostNumber: jumpPostNumberProp,
  ariaKind,
  referencedHandle,
  children,
  onRemoteParentBody,
  syncTranslationView = 'original',
  syncReplyPreviewTranslation = null,
  replyPreviewSourceLang = null,
  peekMergedBodyText = null,
}: {
  layout: 'parent' | 'child';
  targetUri: string;
  threadRootUri: string;
  threadIndex: ThreadPostIndex;
  buttonClassName: string;
  jumpPostNumber?: number;
  ariaKind: 'parent' | 'child';
  /** Handle string when the post is not in the index yet (e.g. child reply label) */
  referencedHandle?: string;
  children?: ComponentChildren;
  /** When parent post is not in thread index, report fetched body for header Translate. */
  onRemoteParentBody?: (text: string | null) => void;
  /** Parent-line preview: sync with post header Original / Translation toggle. */
  syncTranslationView?: 'original' | 'translated';
  syncReplyPreviewTranslation?: string | null;
  replyPreviewSourceLang?: string | null;
  /** Forum-merged body for this post number (same string as the full post card). */
  peekMergedBodyText?: string | null;
}) {
  const threadTrCtx = useContext(ThreadTranslationContext);
  const [fetchedTarget, setFetchedTarget] = useState<PostView | null>(null);
  const [loadError, setLoadError] = useState(false);
  /** Parent (&gt;&gt;handle) line: show replied-to text immediately; child reply links stay collapsed until clicked. */
  const [unfurled, setUnfurled] = useState(() => layout === 'parent');
  const [postSnippetHover, setPostSnippetHover] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
    placement: 'above' | 'below';
  }>({ top: 0, left: 0, placement: 'above' });
  const [authorHover, setAuthorHover] = useState(false);
  const [authorPinned, setAuthorPinned] = useState(false);
  const [authorCardPos, setAuthorCardPos] = useState({ top: 0, left: 0 });
  const quoteRef = useRef<HTMLButtonElement>(null);
  const hoverCardRef = useRef<HTMLDivElement>(null);
  const authorBtnRef = useRef<HTMLButtonElement>(null);
  const authorCardRef = useRef<HTMLDivElement>(null);
  const authorLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Controls + inline expand (+ hover layer for parent); clicks outside collapse `unfurled`. */
  const peekDismissBoundaryRef = useRef<HTMLDivElement | null>(null);
  const [childRefTranslationBusy, setChildRefTranslationBusy] = useState(false);

  const targetInThread = threadIndex.postByUri.get(targetUri);
  const targetPostNumberFromIndex = threadIndex.postNumberByUri.get(targetUri);
  const jumpPostNumber = jumpPostNumberProp ?? targetPostNumberFromIndex ?? undefined;
  const targetPost = targetInThread ?? fetchedTarget;

  const childBodyTextForTranslation = useMemo(() => {
    if (layout !== 'child' || !targetPost) return '';
    if (peekMergedBodyText != null && peekMergedBodyText.trim().length > 0) {
      return peekMergedBodyText;
    }
    return targetPost.record.text;
  }, [layout, targetPost, peekMergedBodyText]);

  const childRefTranslateOffer = useMemo(() => {
    if (layout !== 'child' || !targetPost || !childBodyTextForTranslation.trim()) return null;
    if (typeof navigator === 'undefined') return null;
    const userLocales = navigatorLanguageTags();
    const sourceLang = detectPostLanguageBcp47(childBodyTextForTranslation);
    if (!postLanguageDiffersFromUserLocales(sourceLang, userLocales)) return null;
    return { sourceLang };
  }, [layout, targetPost, childBodyTextForTranslation]);

  const childRefTranslationTarget = useMemo(() => translationTargetTagFromNavigator(), []);

  const peekSharedMain = layout === 'child' ? threadTrCtx.byUri[targetUri] : undefined;
  const childRefCachedTranslation = peekSharedMain?.mainCached ?? null;
  const childRefTranslationView = peekSharedMain?.view ?? 'original';

  useEffect(() => {
    if (!onRemoteParentBody || targetInThread) return;
    onRemoteParentBody(targetPost?.record.text ?? null);
  }, [onRemoteParentBody, targetInThread, targetPost?.record.text]);

  useEffect(() => {
    if (targetUri === threadRootUri) return;
    if (targetInThread) return;
    let cancelled = false;
    getPosts([targetUri])
      .then(res => {
        if (cancelled) return;
        if (res.posts[0]) setFetchedTarget(res.posts[0]);
        else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => { cancelled = true; };
  }, [targetUri, threadRootUri, targetInThread]);

  const computeTooltipPosition = useCallback(() => {
    const el = quoteRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const maxW = 320;
    const rawH = hoverCardRef.current?.getBoundingClientRect().height ?? 0;
    const h = rawH > 12 ? rawH : 200;

    let top: number;
    let placement: 'above' | 'below';
    if (r.top - gap - h >= margin) {
      placement = 'above';
      top = r.top - gap;
    } else {
      placement = 'below';
      top = r.bottom + gap;
      if (top + h > window.innerHeight - margin) {
        top = Math.max(margin, window.innerHeight - h - margin);
      }
    }

    let left = r.left;
    if (left + maxW > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - maxW - margin);
    }
    if (left < margin) {
      left = margin;
    }
    setTooltipPos({ top, left, placement });
  }, []);

  const displayHandle =
    targetPost?.author.handle ?? referencedHandle ?? (loadError ? '???' : '…');
  const repliedAuthorLabel =
    targetPost?.author.displayName || targetPost?.author.handle || displayHandle;
  const handleForAria = displayHandle;

  const tooltipSnippet = targetPost
    ? quotePreviewSnippet(targetPost.record.text)
    : loadError
      ? 'Could not load this post.'
      : 'Loading…';

  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  const showPostSnippetCard =
    !isTouchDevice &&
    targetUri !== threadRootUri &&
    postSnippetHover &&
    (targetPost || loadError || !targetInThread);

  useLayoutEffect(() => {
    if (!showPostSnippetCard) return;
    computeTooltipPosition();
    const id = requestAnimationFrame(() => computeTooltipPosition());
    return () => cancelAnimationFrame(id);
  }, [showPostSnippetCard, tooltipSnippet, targetPost?.uri, loadError, computeTooltipPosition]);

  const clearAuthorLeaveTimer = useCallback(() => {
    if (authorLeaveTimerRef.current != null) {
      clearTimeout(authorLeaveTimerRef.current);
      authorLeaveTimerRef.current = null;
    }
  }, []);

  const scheduleCloseAuthorPopover = useCallback(() => {
    clearAuthorLeaveTimer();
    authorLeaveTimerRef.current = setTimeout(() => {
      setAuthorHover(false);
      authorLeaveTimerRef.current = null;
    }, 200);
  }, [clearAuthorLeaveTimer]);

  const openAuthorPopover = useCallback(() => {
    clearAuthorLeaveTimer();
    setAuthorHover(true);
  }, [clearAuthorLeaveTimer]);

  const showAuthorPopover =
    ariaKind === 'parent' && (authorHover || authorPinned) && !!targetPost;

  const updateAuthorCardPosition = useCallback(() => {
    if (!authorBtnRef.current) return;
    const r = authorBtnRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const cw = authorCardRef.current?.offsetWidth ?? 220;
    const ch = authorCardRef.current?.offsetHeight ?? 72;
    let top = r.bottom + gap;
    let left = r.left;
    if (top + ch > window.innerHeight - margin) {
      top = Math.max(margin, r.top - gap - ch);
    }
    if (left + cw > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - cw - margin);
    }
    if (left < margin) {
      left = margin;
    }
    setAuthorCardPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!showAuthorPopover) return;
    updateAuthorCardPosition();
    const id = requestAnimationFrame(() => updateAuthorCardPosition());
    return () => cancelAnimationFrame(id);
  }, [showAuthorPopover, targetPost?.uri, updateAuthorCardPosition]);

  useEffect(() => {
    if (!authorPinned) return;
    const onDoc = (e: Event) => {
      const t = e.target as Node;
      if (authorBtnRef.current?.contains(t) || authorCardRef.current?.contains(t)) return;
      setAuthorPinned(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [authorPinned]);


  const runChildRefTranslate = useCallback(async () => {
    if (layout !== 'child' || !childRefTranslateOffer || !targetPost) return;
    const cur = threadTrCtx.byUri[targetUri];
    if (cur?.mainCached != null) {
      threadTrCtx.patchMain(targetUri, {
        view: cur.view === 'translated' ? 'original' : 'translated',
      });
      return;
    }
    setChildRefTranslationBusy(true);
    try {
      const r = await translatePostTextToTarget(
        childBodyTextForTranslation,
        childRefTranslateOffer.sourceLang,
        childRefTranslationTarget,
      );
      if (!r.ok) {
        showPlainTextTranslateOverlay(childBodyTextForTranslation, childRefTranslationTarget);
        return;
      }
      threadTrCtx.patchMain(targetUri, { mainCached: r.text, view: 'translated' });
      showToast(`Translated via ${translationSourceLabel(r.via)}.`, 4000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Translation failed', 4000);
    } finally {
      setChildRefTranslationBusy(false);
    }
  }, [
    layout,
    childRefTranslateOffer,
    targetPost,
    targetUri,
    childBodyTextForTranslation,
    childRefTranslationTarget,
    threadTrCtx.patchMain,
    childRefCachedTranslation,
  ]);

  const clearExpandLeaveTimer = useCallback(() => {
    if (expandLeaveTimerRef.current != null) {
      clearTimeout(expandLeaveTimerRef.current);
      expandLeaveTimerRef.current = null;
    }
  }, []);

  const onQuoteClick = useCallback((e: Event) => {
    e.preventDefault();
    clearExpandLeaveTimer();
    // On desktop, clicking a child reply (>>) should jump to the post, like the (number) button
    if (layout === 'child' && !isTouchDevice && jumpPostNumber != null) {
      scrollToThreadPost(jumpPostNumber);
    }
    setUnfurled(v => !v);
  }, [layout, isTouchDevice, jumpPostNumber, clearExpandLeaveTimer]);


  const onQuoteHover = useCallback(() => {
    if (layout === 'child') {
      clearExpandLeaveTimer();
      setUnfurled(true);
    }
  }, [layout, clearExpandLeaveTimer]);

  const scheduleCloseExpand = useCallback(() => {
    clearExpandLeaveTimer();
    expandLeaveTimerRef.current = setTimeout(() => {
      setUnfurled(false);
      expandLeaveTimerRef.current = null;
    }, 200);
  }, [clearExpandLeaveTimer]);

  const onQuoteLeave = useCallback(() => {
    if (layout === 'child') {
      scheduleCloseExpand();
    }
  }, [layout, scheduleCloseExpand]);

  const onJumpClick = useCallback(
    (e: Event) => {
      e.preventDefault();
      if (jumpPostNumber != null) scrollToThreadPost(jumpPostNumber);
    },
    [jumpPostNumber],
  );

  const childQuoteAria = `Reply by @${handleForAria} (post ${jumpPostNumber ?? '?'}). Click to ${unfurled ? 'collapse' : 'expand'} inline.`;

  const quoteToggleAria = `${unfurled ? 'Hide' : 'Show'} quoted post`;

  const onAuthorNameClick = useCallback((e: Event) => {
    if (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches) {
      e.preventDefault();
      setAuthorPinned(p => !p);
    }
  }, []);

  const showExpandHint =
    ariaKind === 'parent' &&
    targetPostNumberFromIndex == null &&
    !targetInThread &&
    !targetPost &&
    !loadError;

  const labelInner =
    children ??
    <Fragment>
      @{displayHandle}
    </Fragment>;

  const jumpButton =
    jumpPostNumber != null ? (
      <button
        type="button"
        class="post-quote-jump"
        onClick={onJumpClick}
        title="Jump to this post"
      >
        ({jumpPostNumber})
      </button>
    ) : null;

  const expandHint =
    showExpandHint ? (
      <span class="post-reply-to-hint"> · click to show quoted post</span>
    ) : null;

  const parentControlsRow =
    ariaKind === 'parent' ? (
      <>
        <span class="post-reply-to-plain">Replying to </span>
        <button
          type="button"
          ref={authorBtnRef}
          class="post-reply-to-authorpeek-btn"
          onMouseEnter={openAuthorPopover}
          onMouseLeave={scheduleCloseAuthorPopover}
          onClick={onAuthorNameClick}
          aria-haspopup="dialog"
          aria-expanded={showAuthorPopover}
          aria-label={`${repliedAuthorLabel}, @${displayHandle}. Hover or tap for profile.`}
        >
          {repliedAuthorLabel}
        </button>
        <span class="post-reply-to-plain"> who wrote:</span>
        <button
          type="button"
          ref={quoteRef}
          class="post-reply-to-quote-toggle"
          onClick={onQuoteClick}
          aria-expanded={unfurled}
          aria-label={quoteToggleAria}
          title="Show or hide quoted text"
        >
          <span aria-hidden="true">{unfurled ? '▼' : '▶'}</span>
        </button>
        {jumpButton}
        {expandHint}
      </>
    ) : null;

  const controlsRow =
    ariaKind === 'parent' ? (
      parentControlsRow
    ) : (
      <span onMouseEnter={onQuoteHover} onMouseLeave={onQuoteLeave}>
        <button
          ref={quoteRef}
          type="button"
          class={buttonClassName}
          onClick={onQuoteClick}
          aria-expanded={unfurled}
          aria-label={childQuoteAria}
        >
          {labelInner}
        </button>
        {jumpButton}
        {expandHint}
      </span>
    );

  const hoverLayer =
    showPostSnippetCard && (
      <div
        ref={hoverCardRef}
        class="post-quote-hovercard"
        style={{
          top: `${tooltipPos.top}px`,
          left: `${tooltipPos.left}px`,
          transform: tooltipPos.placement === 'above' ? 'translateY(-100%)' : undefined,
        }}
        role="tooltip"
      >
        <div class="post-quote-hovercard-body">{tooltipSnippet}</div>
      </div>
    );

  const authorPopoverLayer =
    showAuthorPopover &&
    targetPost &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        ref={authorCardRef}
        class="post-reply-author-popover"
        style={{
          position: 'fixed',
          top: `${authorCardPos.top}px`,
          left: `${authorCardPos.left}px`,
          zIndex: 10050,
        }}
        onMouseEnter={() => {
          clearAuthorLeaveTimer();
          setAuthorHover(true);
        }}
        onMouseLeave={() => {
          scheduleCloseAuthorPopover();
        }}
        role="dialog"
        aria-label={`Profile: ${repliedAuthorLabel}`}
      >
        <Avatar
          src={targetPost.author.avatar}
          alt={repliedAuthorLabel}
          size={44}
        />
        <div class="post-reply-author-popover-text">
          <div class="post-reply-author-popover-name">{repliedAuthorLabel}</div>
          <div class="post-reply-author-popover-handle">@{targetPost.author.handle}</div>
        </div>
      </div>,
      document.body,
    );

  const expandShowsTranslated =
    layout === 'parent'
      ? syncTranslationView === 'translated' && syncReplyPreviewTranslation != null
      : childRefTranslationView === 'translated' && childRefCachedTranslation != null;

  const expandTranslatedPlain =
    layout === 'parent' ? syncReplyPreviewTranslation : childRefCachedTranslation;

  const expandBlockquoteLang =
    layout === 'parent'
      ? replyPreviewSourceLang && syncTranslationView === 'original'
        ? replyPreviewSourceLang
        : undefined
      : childRefTranslateOffer?.sourceLang && childRefTranslationView === 'original'
        ? childRefTranslateOffer.sourceLang
        : undefined;

  const expandLayer = unfurled && (
    <div class="post-ref-expand-wrap">
      {targetPost && (
        <Fragment>
          {layout === 'child' && childRefTranslateOffer && (
            <div class="post-ref-expand-toolbar">
              <button
                type="button"
                class="post-translate-btn post-ref-expand-translate-btn"
                onClick={() => void runChildRefTranslate()}
                disabled={childRefTranslationBusy}
                aria-label={
                  childRefCachedTranslation != null && childRefTranslationView === 'translated'
                    ? 'Show original language'
                    : childRefCachedTranslation != null
                      ? 'Show translation'
                      : 'Translate quoted post using your device or browser'
                }
              >
                {childRefTranslationBusy
                  ? '…'
                  : childRefCachedTranslation != null && childRefTranslationView === 'translated'
                    ? 'Original'
                    : childRefCachedTranslation != null
                      ? 'Translation'
                      : 'Translate'}
              </button>
            </div>
          )}
          <blockquote class="post-reply-to-preview" lang={expandBlockquoteLang}>
            {expandShowsTranslated && expandTranslatedPlain != null ? (
              <div class="post-translation-plain">
                {expandTranslatedPlain.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>
                    {para.split('\n').map((line, j) => (
                      <Fragment key={j}>
                        {j > 0 ? <br /> : null}
                        {line}
                      </Fragment>
                    ))}
                  </p>
                ))}
              </div>
            ) : layout === 'child' &&
              peekMergedBodyText != null &&
              peekMergedBodyText !== targetPost.record.text ? (
              <div class="post-translation-plain">
                {peekMergedBodyText.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>
                    {para.split('\n').map((line, j) => (
                      <Fragment key={j}>
                        {j > 0 ? <br /> : null}
                        {line}
                      </Fragment>
                    ))}
                  </p>
                ))}
              </div>
            ) : (
              renderPostContent(targetPost.record.text, targetPost.record.facets)
            )}
          </blockquote>
        </Fragment>
      )}
      {!targetPost && !loadError && (
        <p class="post-reply-to-loading">Loading…</p>
      )}
      {loadError && !targetPost && (
        <p class="post-reply-to-error">Could not load this post.</p>
      )}
    </div>
  );

  if (layout === 'parent') {
    return (
      <Fragment>
        <div ref={peekDismissBoundaryRef} style={{ display: 'contents' }}>
          <div class="post-reply-to post-reply-to--quotelink">{controlsRow}</div>
          {hoverLayer}
          {expandLayer}
        </div>
        {authorPopoverLayer}
      </Fragment>
    );
  }

  return (
    <div ref={peekDismissBoundaryRef} class="post-child-reply-item">
      <span class="post-child-reply-pair">{controlsRow}</span>
      {expandLayer && (
        <div onMouseEnter={clearExpandLeaveTimer} onMouseLeave={scheduleCloseExpand}>
          {expandLayer}
        </div>
      )}
      {hoverLayer}
    </div>
  );
}

function ReplyToParentLineInline({
  parentUri,
  threadRootUri,
  threadIndex,
}: {
  parentUri: string;
  threadRootUri: string;
  threadIndex: ThreadPostIndex;
}) {
  if (parentUri === threadRootUri) return null;
  const parentPost = threadIndex.postByUri.get(parentUri);
  if (!parentPost) return null;
  const handle = parentPost.author.handle;
  const displayName = parentPost.author.displayName || handle;
  const postNumber = threadIndex.postNumberByUri.get(parentUri);

  const scrollToParent = () => {
    if (postNumber) {
      scrollToThreadPost(postNumber);
    }
  };

  return (
    <span class="post-reply-to-inline">
      <span class="post-reply-to-inline-sep">·</span>
      <span class="post-reply-to-inline-label">Replying to </span>
      <button
        type="button"
        class="post-reply-to-inline-author"
        onClick={scrollToParent}
        title={`@${handle}${postNumber ? ` (post ${postNumber})` : ''}`}
      >
        {displayName}
      </button>
    </span>
  );
}

function QuotedPostPreview({
  parentUri,
  threadRootUri,
  threadIndex,
}: {
  parentUri: string;
  threadRootUri: string;
  threadIndex: ThreadPostIndex;
}) {
  if (parentUri === threadRootUri) return null;

  return (
    <div class="post-quoted-preview-wrapper">
      <ReferencedPostPeek
        layout="parent"
        targetUri={parentUri}
        threadRootUri={threadRootUri}
        threadIndex={threadIndex}
        buttonClassName="post-reply-to-ref--body"
        ariaKind="parent"
      />
    </div>
  );
}

function PostOverflowMenu({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: (close: () => void) => ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const updateMenuPosition = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const menuWidth = 220;
    const left = Math.min(
      Math.max(8, r.right - menuWidth),
      typeof window !== 'undefined' ? window.innerWidth - menuWidth - 8 : r.left,
    );
    setMenuPos({ top: r.bottom + 4, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const menuWidth = 220;
      const left = Math.min(
        Math.max(8, r.right - menuWidth),
        window.innerWidth - menuWidth - 8,
      );
      setMenuPos({ top: r.bottom + 4, left });
    }
    setOpen(true);
  };

  const menuPortal =
    open &&
    menuPos &&
    createPortal(
      <div
        ref={menuRef}
        class="post-overflow-menu post-overflow-menu--portal"
        style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
        role="menu"
        aria-label={ariaLabel}
      >
        {children(close)}
      </div>,
      document.body,
    );

  return (
    <div class="post-overflow-wrap">
      <button
        ref={btnRef}
        type="button"
        class="post-overflow-btn"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
      >
        <span aria-hidden="true">…</span>
      </button>
      {menuPortal}
    </div>
  );
}

function PostBlock({
  segments,
  root,
  postNumber,
  threadRootUri,
  threadIndex,
  mergedTextForPostNumber,
  childReplies = [],
  kbFocusPost,
  kbOutlineActive,
  onOwnPostDeleted,
  onReply,
  onQuoteRepost,
  onLocalHide,
  downvoteRecordUri,
  downvoteDisplayCount = 0,
  onDownvotePost,
  downvoteBusy = false,
  threadFollowingDids,
  avatarFollowBusyDid,
  onThreadAvatarFollow,
  threadCreatorLiked,
  threadCreatorAvatar,
  threadCreatorDisplayName,
}: {
  segments: PostView[];
  root: PostView;
  postNumber: number;
  threadRootUri?: string;
  threadIndex?: ThreadPostIndex;
  mergedTextForPostNumber?: (postNum: number) => string | null;
  childReplies?: DirectReplyLink[];
  kbFocusPost?: number;
  kbOutlineActive?: boolean;
  onOwnPostDeleted: (postNumber: number, detail: OwnPostDeletedDetail) => void | Promise<void>;
  onReply?: (parent: StrongRef, authorHandle: string, postNumber: number) => void;
  onQuoteRepost?: (post: PostView, postNumber: number) => void;
  onLocalHide?: () => void;
  downvoteRecordUri?: string;
  downvoteDisplayCount?: number;
  onDownvotePost?: (uri: string, cid: string) => void | Promise<void>;
  downvoteBusy?: boolean;
  threadFollowingDids?: Set<string> | null;
  avatarFollowBusyDid?: string | null;
  onThreadAvatarFollow?: (authorDid: string) => void | Promise<void>;
  threadCreatorLiked?: boolean;
  threadCreatorAvatar?: string;
  threadCreatorDisplayName?: string;
}) {
  const threadTrCtx = useContext(ThreadTranslationContext);
  // Per-segment media: compute once, render inline with each segment's text
  const perSegmentMedia = useMemo(() => segments.map(seg => {
    const images = getPostImages(seg);
    const { videos } = getQuotedPostAggregatedMedia(seg);
    const ext = getPostExternal(seg);
    const extGif = ext && isNativeExternalEmbed(ext) ? getExternalGifPlaybackSources(ext) : null;
    return { images, videos, external: ext, externalGifSrc: extGif };
  }), [segments]);
  const handle = root.author.handle;
  const displayName = root.author.displayName || handle;
  const tone = toneIndexForHandle(handle);
  const replyParentUri = root.record.reply?.parent?.uri;
  const showReplyContext =
    Boolean(threadRootUri && threadIndex && replyParentUri && replyParentUri !== threadRootUri);
  const viewerDid = currentUser.value?.did;
  const isOwnPost = Boolean(viewerDid && root.author.did === viewerDid);

  const kbRing = Boolean(kbOutlineActive) && kbFocusPost != null && kbFocusPost === postNumber;
  const bskyOpen = bskyPostWebUrl(root);

  const fullPostText = useMemo(
    () => segments.map(s => s.record.text).join('\n\n'),
    [segments],
  );
  const replyContextBodyText = useMemo(() => {
    if (!replyParentUri || !threadIndex) return null;
    const pv = threadIndex.postByUri.get(replyParentUri);
    return pv?.record.text ?? null;
  }, [replyParentUri, threadIndex]);

  const translateOffer = useMemo(() => {
    if (typeof navigator === 'undefined') return null;
    const userLocales = navigatorLanguageTags();
    const mainSourceLang = detectPostLanguageBcp47(fullPostText);
    const translateMain = postLanguageDiffersFromUserLocales(mainSourceLang, userLocales);
    let translateReply = false;
    let replySourceLang: string | null = null;
    if (replyContextBodyText && replyContextBodyText.trim().length > 0) {
      replySourceLang = detectPostLanguageBcp47(replyContextBodyText);
      translateReply = postLanguageDiffersFromUserLocales(replySourceLang, userLocales);
    }
    if (!translateMain && !translateReply) return null;
    return { translateMain, translateReply, mainSourceLang, replySourceLang };
  }, [fullPostText, replyContextBodyText]);
  const translationTarget = useMemo(() => translationTargetTagFromNavigator(), []);
  const sharedCard = threadTrCtx.byUri[root.uri];
  const cachedTranslationMain = sharedCard?.mainCached ?? null;
  const translationView = sharedCard?.view ?? 'original';
  const [cachedTranslationReply, setCachedTranslationReply] = useState<string | null>(null);
  const [translationBusy, setTranslationBusy] = useState(false);

  useEffect(() => {
    threadTrCtx.resetMain(root.uri);
    setCachedTranslationReply(null);
  }, [fullPostText, replyParentUri, root.uri, threadTrCtx.resetMain]);

  const runTranslate = useCallback(async () => {
    if (!translateOffer) return;
    const needMain = translateOffer.translateMain;
    const needReply =
      translateOffer.translateReply &&
      Boolean(replyContextBodyText && replyContextBodyText.trim().length > 0);
    const anyCache = cachedTranslationMain != null || cachedTranslationReply != null;
    const translationComplete =
      (!needMain || cachedTranslationMain != null) &&
      (!needReply || cachedTranslationReply != null);
    if (anyCache && translationComplete) {
      threadTrCtx.patchMain(root.uri, {
        view: translationView === 'translated' ? 'original' : 'translated',
      });
      return;
    }
    setTranslationBusy(true);
    try {
      let viaPost: PostTranslateVia | null = null;
      let viaReply: PostTranslateVia | null = null;
      if (needMain && cachedTranslationMain == null) {
        const r = await translatePostTextToTarget(
          fullPostText,
          translateOffer.mainSourceLang,
          translationTarget,
        );
        if (!r.ok) {
          showPlainTextTranslateOverlay(fullPostText, translationTarget);
          return;
        }
        threadTrCtx.patchMain(root.uri, { mainCached: r.text });
        viaPost = r.via;
      }
      if (needReply && replyContextBodyText && cachedTranslationReply == null) {
        const r = await translatePostTextToTarget(
          replyContextBodyText,
          translateOffer.replySourceLang,
          translationTarget,
        );
        if (!r.ok) {
          showPlainTextTranslateOverlay(replyContextBodyText, translationTarget);
          return;
        }
        setCachedTranslationReply(r.text);
        viaReply = r.via;
      }
      threadTrCtx.patchMain(root.uri, { view: 'translated' });
      showToast(translationSuccessToastMessage(viaPost, viaReply), 4000);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Translation failed', 4000);
    } finally {
      setTranslationBusy(false);
    }
  }, [
    cachedTranslationMain,
    cachedTranslationReply,
    fullPostText,
    replyContextBodyText,
    translateOffer,
    translationTarget,
    root.uri,
    translationView,
    threadTrCtx.patchMain,
  ]);

  const quotedEmbed = useMemo(() => getQuotedEmbedFromSegments(segments), [segments]);
  const segmentsNsfw = useMemo(() => segments.some(postHasNsfwLabels), [segments]);
  const segmentsLabels = useMemo(
    () => segments.flatMap(s => [...(s.labels ?? []), ...(s.author?.labels ?? [])]),
    [segments],
  );

  const isSelfAuthor = Boolean(viewerDid && root.author.did === viewerDid);
  const showAvatarFollowPlus = Boolean(
    onThreadAvatarFollow &&
      !isSelfAuthor &&
      threadFollowingDids != null &&
      !threadFollowingDids.has(root.author.did),
  );

  return (
    <div
      class={`post-container username-tone-${tone}${kbRing ? ' post-container--kb-focus' : ''}`}
      id={`thread-post-${postNumber}`}
    >
      <div class="post-author-card">
        <Avatar
          src={root.author.avatar}
          alt={displayName}
          followPlus={
            showAvatarFollowPlus
              ? {
                  busy: avatarFollowBusyDid === root.author.did,
                  onFollow: () => void onThreadAvatarFollow!(root.author.did),
                  title: `Follow @${handle}`,
                }
              : undefined
          }
        />
        <div class="post-author-meta">
          <div class="author-name">
            <a
              href={hrefForAppPath(`/u/${handle}`)}
              {...SPA_ANCHOR_SHIELD}
              onClick={spaNavigateClick(`/u/${handle}`)}
            >
              {displayName}
            </a>
          </div>
          <div class="author-handle-line">
            <a
              href={hrefForAppPath(`/u/${handle}`)}
              {...SPA_ANCHOR_SHIELD}
              onClick={spaNavigateClick(`/u/${handle}`)}
            >
              @{handle}
            </a>
            <AuthorFlair profile={root.author} postLabels={root.labels} />
          </div>
          <table class="author-stats-table">
            <tbody>
              <tr>
                <td>Joined</td>
                <td>{formatProfileJoined(root.author.createdAt)}</td>
              </tr>
              <tr>
                <td>Followers</td>
                <td class="author-accent-stat">{formatProfileStatCount(root.author.followersCount)}</td>
              </tr>
              <tr>
                <td>Posts</td>
                <td class="author-accent-stat">{formatProfileStatCount(root.author.postsCount)}</td>
              </tr>
            </tbody>
          </table>
          <div class="author-badges">
            {root.author.labels?.some(l => l.val === 'bot') && (
              <span class="author-badge author-badge-bot">Bot</span>
            )}
            {!isOwnPost && root.author.viewer?.following && root.author.viewer?.followedBy && (
              <span class="author-badge author-badge-mutuals">Mutuals</span>
            )}
            {!isOwnPost && root.author.viewer?.followedBy && !root.author.viewer?.following && (
              <span class="author-badge author-badge-follows-you">Follows you</span>
            )}
          </div>
        </div>
      </div>
      <div class="post-body">
        <div class="post-header">
          <div class="post-header-left">
            <PostHeaderDate createdAt={root.record.createdAt} />
            {showReplyContext && replyParentUri && threadRootUri && threadIndex && (
              <ReplyToParentLineInline
                parentUri={replyParentUri}
                threadRootUri={threadRootUri}
                threadIndex={threadIndex}
              />
            )}
          </div>
          <div class="post-header-right">
            {threadCreatorLiked && (
              <div
                class="thread-creator-like-indicator"
                title={`Liked by ${threadCreatorDisplayName || 'thread creator'}`}
              >
                <span class="thread-creator-like-heart" aria-hidden>
                  ♥
                </span>
                {threadCreatorAvatar && (
                  <img
                    src={threadCreatorAvatar}
                    alt=""
                    class="thread-creator-like-avatar"
                    loading="lazy"
                  />
                )}
              </div>
            )}
            {translateOffer && (
              <button
                type="button"
                class="post-translate-btn"
                onClick={() => void runTranslate()}
                disabled={translationBusy}
                aria-label={
                  (cachedTranslationMain != null || cachedTranslationReply != null) &&
                  translationView === 'translated'
                    ? 'Show original language'
                    : cachedTranslationMain != null || cachedTranslationReply != null
                      ? 'Show translation'
                      : 'Translate post and quoted reply using your device or browser'
                }
              >
                {translationBusy
                  ? '…'
                  : (cachedTranslationMain != null || cachedTranslationReply != null) &&
                      translationView === 'translated'
                    ? 'Original'
                    : cachedTranslationMain != null || cachedTranslationReply != null
                      ? 'Translation'
                      : 'Translate'}
              </button>
            )}
            {threadRootUri && <PostSubscribeButton threadRootUri={threadRootUri} />}
            <PostOverflowMenu ariaLabel={`Post ${postNumber} menu`}>
              {close => (
                <div class="post-overflow-menu-inner">
                  <button
                    type="button"
                    role="menuitem"
                    class="post-overflow-menu-item"
                    onClick={() => {
                      void (async () => {
                        const primary = bskyPostWebUrl(root);
                        const url =
                          primary ??
                          (typeof window !== 'undefined'
                            ? `${window.location.origin}${window.location.pathname}#thread-post-${postNumber}`
                            : '');
                        if (!url) {
                          showToast('Could not build link');
                          return;
                        }
                        try {
                          await navigator.clipboard.writeText(url);
                          showToast('Link copied');
                        } catch {
                          showToast('Could not copy link');
                        }
                      })();
                      close();
                    }}
                  >
                    Copy link
                  </button>
                  <div class="post-overflow-menu-divider" role="separator" />
                  {isOwnPost && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        class="post-overflow-menu-item post-overflow-menu-item--danger"
                        onClick={() => {
                          if (!isLoggedIn.value) {
                            showAuthDialog.value = true;
                            close();
                            return;
                          }
                          const did = currentUser.value?.did;
                          if (!did) {
                            close();
                            return;
                          }
                          const n = segments.length;
                          const msg =
                            n === 1
                              ? 'Delete this post? This cannot be undone.'
                              : `ForumSky shows this as one post, but it is ${n} separate Bluesky records (self-thread). Delete all ${n}? This cannot be undone.`;
                          if (!window.confirm(msg)) return;
                          close();
                          void (async () => {
                            try {
                              await deleteOwnBlueskySegments(segments, did);
                              await onOwnPostDeleted(postNumber, { scope: 'all' });
                            } catch (err) {
                              showToast(err instanceof Error ? err.message : 'Could not delete post');
                            }
                          })();
                        }}
                      >
                        {segments.length === 1
                          ? 'Delete post'
                          : `Delete post (${segments.length} on Bluesky)`}
                      </button>
                      {segments.length > 1 && (
                        <>
                          <div class="post-overflow-menu-label" id={`post-${postNumber}-delete-part-hint`}>
                            Or delete a single Bluesky record
                          </div>
                          {segments.map((seg, idx) => {
                            const part = idx + 1;
                            const snippet = quotePreviewSnippet(seg.record.text, 72);
                            return (
                              <button
                                key={seg.uri}
                                type="button"
                                role="menuitem"
                                class="post-overflow-menu-item post-overflow-menu-item--danger"
                                aria-describedby={`post-${postNumber}-delete-part-hint`}
                                onClick={() => {
                                  if (!isLoggedIn.value) {
                                    showAuthDialog.value = true;
                                    close();
                                    return;
                                  }
                                  const did = currentUser.value?.did;
                                  if (!did) {
                                    close();
                                    return;
                                  }
                                  if (
                                    !window.confirm(
                                      `Delete only part ${part} of ${segments.length} on Bluesky?\n\n“${snippet}”\n\nOther parts of this block stay. This cannot be undone.`,
                                    )
                                  ) {
                                    return;
                                  }
                                  close();
                                  void (async () => {
                                    try {
                                      const p = parseAtUri(seg.uri);
                                      if (!p || p.repo !== did) {
                                        throw new Error(
                                          'Cannot delete a segment that is not in your repository',
                                        );
                                      }
                                      await deletePost(did, p.rkey);
                                      const survivorUrisOldestFirst = segments
                                        .filter(s => s.uri !== seg.uri)
                                        .sort(
                                          (a, b) =>
                                            new Date(a.record.createdAt).getTime() -
                                            new Date(b.record.createdAt).getTime(),
                                        )
                                        .map(s => s.uri);
                                      await onOwnPostDeleted(postNumber, {
                                        scope: 'oneSegment',
                                        deletedUri: seg.uri,
                                        survivorUrisOldestFirst,
                                      });
                                    } catch (err) {
                                      showToast(
                                        err instanceof Error ? err.message : 'Could not delete post',
                                      );
                                    }
                                  })();
                                }}
                              >
                                {`Delete part ${part} only…`}
                              </button>
                            );
                          })}
                        </>
                      )}
                    </>
                  )}
                  {!isOwnPost && (
                    <>
                      {bskyOpen && (
                        <a
                          role="menuitem"
                          class="post-overflow-menu-item"
                          href={bskyOpen}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => close()}
                        >
                          Open in Bluesky
                        </a>
                      )}
                      {threadRootUri && onLocalHide && (
                        <button
                          type="button"
                          role="menuitem"
                          class="post-overflow-menu-item"
                          onClick={() => {
                            const why =
                              window.prompt(
                                'Hide this post only on your device. Optional reason (saved locally):',
                              ) ?? '';
                            addLocallyHiddenSubtree(threadRootUri, [root.uri]);
                            setLocalHideReason(
                              threadRootUri,
                              root.uri,
                              why.trim() || 'Hidden locally',
                            );
                            showToast('Post hidden here — use “Clear local hides” in the thread header to undo.');
                            onLocalHide();
                            close();
                          }}
                        >
                          Hide post locally…
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        class="post-overflow-menu-item"
                        onClick={() => {
                          if (!isLoggedIn.value) {
                            showAuthDialog.value = true;
                            close();
                            return;
                          }
                          void (async () => {
                            try {
                              await muteActor(root.author.handle);
                              showToast(`Muted @${root.author.handle}`);
                              void refreshGraphPolicy();
                              close();
                            } catch (err) {
                              showToast(err instanceof Error ? err.message : 'Could not mute user');
                            }
                          })();
                        }}
                      >
                        Mute user
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        class="post-overflow-menu-item"
                        onClick={() => {
                          if (!isLoggedIn.value) {
                            showAuthDialog.value = true;
                            close();
                            return;
                          }
                          if (
                            !window.confirm(
                              'Report this post via AT Protocol?',
                            )
                          ) {
                            return;
                          }
                          void (async () => {
                            try {
                              await reportPost({
                                reasonType: 'com.atproto.moderation.defs#reasonViolation',
                                subject: { uri: root.uri, cid: root.cid },
                              });
                              showToast('Thanks — report submitted');
                              close();
                            } catch (err) {
                              showToast(err instanceof Error ? err.message : 'Could not submit report');
                            }
                          })();
                        }}
                      >
                        Report post
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        class="post-overflow-menu-item post-overflow-menu-item--danger"
                        onClick={() => {
                          if (!isLoggedIn.value) {
                            showAuthDialog.value = true;
                            close();
                            return;
                          }
                          if (
                            !viewerDid ||
                            !window.confirm(
                              `Block @${handle}? You will not see each other’s posts or replies.`,
                            )
                          ) {
                            return;
                          }
                          void (async () => {
                            try {
                              await blockActor(viewerDid, root.author.did);
                              showToast(`Blocked @${handle}`);
                              void refreshGraphPolicy();
                              close();
                            } catch (err) {
                              showToast(err instanceof Error ? err.message : 'Could not block account');
                            }
                          })();
                        }}
                      >
                        {`Block @${handle}`}
                      </button>
                    </>
                  )}
                </div>
              )}
            </PostOverflowMenu>
            <span class="post-number">{postNumber}</span>
          </div>
        </div>
        <div
          class="post-content"
          lang={
            translateOffer?.translateMain &&
            translationView === 'original' &&
            translateOffer.mainSourceLang
              ? translateOffer.mainSourceLang
              : undefined
          }
        >
          {showReplyContext && replyParentUri && threadRootUri && threadIndex && (
            <QuotedPostPreview
              parentUri={replyParentUri}
              threadRootUri={threadRootUri}
              threadIndex={threadIndex}
            />
          )}
          {translationView === 'translated' && cachedTranslationMain != null ? (
            <div class="post-translation-plain">
              {cachedTranslationMain.split(/\n{2,}/).map((para, i) => (
                <p key={i}>
                  {para.split('\n').map((line, j) => (
                    <Fragment key={j}>
                      {j > 0 ? <br /> : null}
                      {line}
                    </Fragment>
                  ))}
                </p>
              ))}
            </div>
          ) : (
            segments.map((seg, segIdx) => {
              const content = renderPostContent(seg.record.text, seg.record.facets);
              const segMedia = perSegmentMedia[segIdx];
              const segImages = segMedia?.images ?? [];
              const segVideos = segMedia?.videos ?? [];
              const segExternal = segMedia?.external ?? null;
              const segExtGif = segMedia?.externalGifSrc ?? null;
              const segMediaCount = segImages.length + segVideos.length;
              const segMediaNodes = (
                <Fragment>
                  {segImages.map((img, i) =>
                    isGifImage(img) ? (
                      <NsfwMediaWrap key={i} isNsfw={segmentsNsfw} labels={segmentsLabels}>
                        <GifImageFromEmbed
                          img={img}
                          className="post-content-media post-content-media--gif"
                        />
                      </NsfwMediaWrap>
                    ) : (
                      <NsfwMediaWrap key={i} isNsfw={segmentsNsfw} labels={segmentsLabels}>
                        <PostContentImage
                          src={img.fullsize || img.thumb}
                          alt={img.alt ?? ''}
                          aspectRatio={img.aspectRatio}
                          allImages={segImages}
                          currentIndex={i}
                        />
                      </NsfwMediaWrap>
                    ),
                  )}
                  {segVideos.map((vid, i) => (
                    <NsfwMediaWrap key={`${vid.playlist}-${i}`} isNsfw={segmentsNsfw} labels={segmentsLabels}>
                      <HlsVideo
                        playlist={vid.playlist}
                        poster={vid.thumbnail}
                        aspectRatio={vid.aspectRatio}
                        className="post-content-media"
                        aria-label={vid.alt || 'Video'}
                      />
                    </NsfwMediaWrap>
                  ))}
                </Fragment>
              );
              return (
                <div key={seg.uri}>
                  {content}
                  {segMediaCount > 0 ? (
                    segMediaCount > 1 ? <div class="post-content-media-stack">{segMediaNodes}</div> : segMediaNodes
                  ) : null}
                  {segExternal &&
                    (segExtGif ? (
                      <NsfwMediaWrap isNsfw={segmentsNsfw} labels={segmentsLabels}>
                        <GifImage
                          thumb={segExtGif.thumb}
                          fullsize={segExtGif.fullsize}
                          alt=""
                          className="post-external-gif"
                          aria-hidden="true"
                        />
                      </NsfwMediaWrap>
                    ) : (
                      <NsfwMediaWrap isNsfw={segmentsNsfw} labels={segmentsLabels}>
                        <a
                          href={segExternal.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          class="post-external-card"
                        >
                          {segExternal.thumb && (
                            <div class="post-external-card-media">
                              <img
                                class="post-external-thumb"
                                src={segExternal.thumb}
                                alt=""
                                loading="lazy"
                                aria-hidden="true"
                              />
                            </div>
                          )}
                          <div class="post-external-card-body">
                            <div class="post-external-card-host">
                              {(() => {
                                try {
                                  return new URL(segExternal.uri).hostname;
                                } catch {
                                  return 'Link';
                                }
                              })()}
                            </div>
                            <div class="post-external-title">{segExternal.title || segExternal.uri}</div>
                            {segExternal.description ? (
                              <div class="post-external-desc">{segExternal.description}</div>
                            ) : null}
                          </div>
                        </a>
                      </NsfwMediaWrap>
                    ))}
                </div>
              );
            })
          )}

          {quotedEmbed?.kind === 'post' && <QuotedPostEmbedCard quoted={quotedEmbed.post} />}
          {quotedEmbed?.kind === 'notFound' && (
            <p class="post-quoted-embed-fallback">Quoted post could not be found.</p>
          )}
          {quotedEmbed?.kind === 'blocked' && (
            <div class="post-quoted-embed-fallback post-quoted-embed-fallback--blocked">
              <p>
                Quoted post is unavailable (blocked, filtered by a labeler, or restricted). ForumSky only
                shows what the Bluesky network returns for your account.
              </p>
              {isLoggedIn.value && (
                <button
                  type="button"
                  class="btn btn-sm btn-outline"
                  onClick={() => {
                    const note =
                      window.prompt(
                        'Optional note for moderators (submitted as a report on this post):',
                      ) ?? '';
                    void (async () => {
                      try {
                        await reportPost({
                          reasonType: 'com.atproto.moderation.defs#reasonViolation',
                          reason: `User appeal / context (quoted content hidden): ${note}`.slice(0, 2000),
                          subject: { uri: root.uri, cid: root.cid },
                        });
                        showToast('Report submitted — thank you.');
                      } catch (err) {
                        showToast(err instanceof Error ? err.message : 'Could not submit');
                      }
                    })();
                  }}
                >
                  Request review (report)
                </button>
              )}
            </div>
          )}
          {quotedEmbed?.kind === 'detached' && (
            <p class="post-quoted-embed-fallback">Quoted post is no longer available.</p>
          )}
        </div>
        <div class="post-footer">
          <div class="post-actions">
            <PostLikeButton post={root} />
            <button
              type="button"
              class="post-reply-btn post-reply-btn--social"
              onClick={() => onReply?.({ uri: root.uri, cid: root.cid }, handle, postNumber)}
            >
              <span class="post-reply-btn-icon" aria-hidden>
                <svg
                  class="post-reply-btn-icon-svg"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </span>
              {childReplies.length > 0 && (
                <span class="post-reply-btn-count">{childReplies.length}</span>
              )}
            </button>
            <PostRepostButton
              post={root}
              onQuoteRepost={() => onQuoteRepost?.(root, postNumber)}
            />
            {onDownvotePost && (
              <PostDownvoteButton
                downvoteRecordUri={downvoteRecordUri}
                displayCount={downvoteDisplayCount}
                busy={downvoteBusy}
                onToggle={() => void onDownvotePost(root.uri, root.cid)}
              />
            )}
            <PostShareButton post={root} postNumber={postNumber} />
          </div>
        </div>
        {childReplies.length > 0 && threadRootUri && threadIndex && (
          <div class="post-child-replies-wrap">
            <div
              class="post-child-replies"
              role="navigation"
              aria-label={`Replies to post ${postNumber}`}
            >
              <div class="post-child-replies-links">
                {childReplies.map((r) => (
                  <Fragment key={r.uri}>
                    <span class="post-child-replies-prefix" aria-hidden="true">&gt;&gt;</span>
                    <ReferencedPostPeek
                      layout="child"
                      targetUri={r.uri}
                      threadRootUri={threadRootUri}
                      threadIndex={threadIndex}
                      buttonClassName="post-child-reply-link"
                      jumpPostNumber={r.postNumber}
                      ariaKind="child"
                      referencedHandle={r.handle}
                      peekMergedBodyText={mergedTextForPostNumber?.(r.postNumber) ?? null}
                    >
                      @{r.handle}
                    </ReferencedPostPeek>
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return formatDateTime(dateStr);
  const diffMs = Date.now() - d.getTime();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const past = diffMs >= 0;
  const absSec = Math.floor(Math.abs(diffMs) / 1000);
  if (absSec < 45) return past ? 'just now' : 'in a moment';

  const absMin = Math.floor(absSec / 60);
  if (absMin < 60) {
    return past ? rtf.format(-absMin, 'minute') : rtf.format(absMin, 'minute');
  }
  const absHrs = Math.floor(absMin / 60);
  if (absHrs < 24) {
    return past ? rtf.format(-absHrs, 'hour') : rtf.format(absHrs, 'hour');
  }
  const absDays = Math.floor(absHrs / 24);
  if (absDays < 7) {
    return past ? rtf.format(-absDays, 'day') : rtf.format(absDays, 'day');
  }
  const absWeeks = Math.floor(absDays / 7);
  if (absWeeks < 5) {
    return past ? rtf.format(-absWeeks, 'week') : rtf.format(absWeeks, 'week');
  }
  const absMonths = Math.floor(absDays / 30);
  if (absMonths < 12) {
    return past ? rtf.format(-absMonths, 'month') : rtf.format(absMonths, 'month');
  }
  const absYears = Math.floor(absDays / 365);
  return past ? rtf.format(-absYears, 'year') : rtf.format(absYears, 'year');
}

function PostHeaderDate({ createdAt }: { createdAt: string }) {
  const [showExact, setShowExact] = useState(false);
  const exactLabel = formatDateTime(createdAt);
  const relativeLabel = formatRelativeTime(createdAt);
  return (
    <button
      type="button"
      class="post-header-date post-header-date--toggle"
      onClick={() => setShowExact(v => !v)}
      title={showExact ? 'Show relative time' : `Exact: ${exactLabel}`}
      aria-label={
        showExact
          ? `Posted ${exactLabel}. Show relative time.`
          : `Posted ${relativeLabel}. Show exact date and time.`
      }
    >
      {showExact ? exactLabel : relativeLabel}
    </button>
  );
}

