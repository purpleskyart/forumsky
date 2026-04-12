import { createPortal } from 'preact/compat';
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'preact/hooks';
import { parseAtUri } from '@/api/feed';
import { likePost, unlikePost, repostPost, unrepostPost } from '@/api/post';
import type { PostView } from '@/api/types';
import { isLoggedIn, showAuthDialog, currentUser, showToast } from '@/lib/store';

export function bskyPostWebUrl(post: PostView): string | null {
  const parsed = parseAtUri(post.uri);
  if (!parsed?.rkey) return null;
  const profile = post.author.handle || post.author.did;
  if (!profile) return null;
  return `https://bsky.app/profile/${encodeURIComponent(profile)}/post/${parsed.rkey}`;
}

function shouldUseNativeShare(): boolean {
  if (typeof navigator.share !== 'function') return false;
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(max-width: 768px)').matches) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

async function shareOrCopyPostUrl(url: string, forceToast = false): Promise<void> {
  if (shouldUseNativeShare() && !forceToast) {
    try {
      await navigator.share({ url, title: 'Bluesky post' });
      return;
    } catch (e: unknown) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied');
  } catch {
    showToast('Could not copy link');
  }
}

export function PostShareButton({
  post,
  postNumber,
  forumskyPath,
}: {
  post: PostView;
  /** On thread page: anchor to #thread-post-N */
  postNumber?: number;
  /** e.g. /t/handle/rkey when sharing from outside the thread route */
  forumskyPath?: string;
}) {
  const [busy, setBusy] = useState(false);

  const onShare = async () => {
    let forumskyUrl = '';
    if (typeof window !== 'undefined') {
      if (forumskyPath) {
        forumskyUrl = `${window.location.origin}${forumskyPath}`;
      } else if (postNumber != null) {
        forumskyUrl = `${window.location.origin}${window.location.pathname}#thread-post-${postNumber}`;
      }
    }
    const primary = forumskyUrl || bskyPostWebUrl(post);
    const url = primary;
    if (!url) {
      showToast('Could not build link');
      return;
    }
    setBusy(true);
    try {
      await shareOrCopyPostUrl(url);
    } catch {
      showToast('Could not share link');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      class="post-share-btn"
      onClick={() => void onShare()}
      disabled={busy}
      aria-label="Share post"
    >
      <span class="post-share-btn-icon" aria-hidden>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </span>
    </button>
  );
}

export function PostRepostButton({ post, onQuoteRepost }: { post: PostView; onQuoteRepost: () => void }) {
  const [count, setCount] = useState(post.repostCount ?? 0);
  const [repostRecordUri, setRepostRecordUri] = useState<string | undefined>(post.viewer?.repost);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCount(post.repostCount ?? 0);
    setRepostRecordUri(post.viewer?.repost);
  }, [post.uri, post.repostCount, post.viewer?.repost]);

  const updateMenuPosition = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, left: r.left });
  }, []);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPosition();
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: Event) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const reposted = Boolean(repostRecordUri);

  const doRepostToggle = async () => {
    if (!isLoggedIn.value) {
      showAuthDialog.value = true;
      return;
    }
    const did = currentUser.value?.did;
    if (!did) return;
    setBusy(true);
    try {
      if (reposted && repostRecordUri) {
        const parsed = parseAtUri(repostRecordUri);
        if (!parsed?.rkey) throw new Error('Could not resolve repost record');
        await unrepostPost(did, parsed.rkey);
        setRepostRecordUri(undefined);
        setCount(c => Math.max(0, c - 1));
      } else {
        const res = await repostPost(did, { uri: post.uri, cid: post.cid });
        setRepostRecordUri(res.uri);
        setCount(c => c + 1);
      }
      setMenuOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update repost');
    } finally {
      setBusy(false);
    }
  };

  const doQuote = () => {
    setMenuOpen(false);
    if (!isLoggedIn.value) {
      showAuthDialog.value = true;
      return;
    }
    onQuoteRepost();
  };

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, left: r.left });
    }
    setMenuOpen(true);
  };

  const menuPortal =
    menuOpen &&
    menuPos &&
    createPortal(
      <div
        ref={menuRef}
        class="post-repost-menu post-repost-menu--portal"
        style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
        role="menu"
      >
        <button
          type="button"
          role="menuitem"
          class="post-repost-menu-item"
          onClick={() => void doRepostToggle()}
          disabled={busy}
        >
          {reposted ? 'Undo repost' : 'Repost'}
        </button>
        <button type="button" role="menuitem" class="post-repost-menu-item" onClick={doQuote}>
          Quote repost
        </button>
      </div>,
      document.body,
    );

  return (
    <div class="post-repost-wrap">
      <button
        ref={btnRef}
        type="button"
        class={`post-repost-btn${reposted ? ' post-repost-btn--active' : ''}`}
        onClick={toggleMenu}
        disabled={busy}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label={reposted ? `Repost options (${count}), reposted` : `Repost (${count})`}
      >
        <span class="post-repost-btn-icon" aria-hidden>
          ↻
        </span>
        <span class="post-repost-btn-count">{count}</span>
      </button>
      {menuPortal}
    </div>
  );
}

export function PostLikeButton({ post }: { post: PostView }) {
  const [count, setCount] = useState(post.likeCount ?? 0);
  const [likeRecordUri, setLikeRecordUri] = useState<string | undefined>(post.viewer?.like);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCount(post.likeCount ?? 0);
    setLikeRecordUri(post.viewer?.like);
  }, [post.uri, post.likeCount, post.viewer?.like]);

  const liked = Boolean(likeRecordUri);

  const onToggle = async () => {
    if (!isLoggedIn.value) {
      showAuthDialog.value = true;
      return;
    }
    const did = currentUser.value?.did;
    if (!did) return;
    setBusy(true);
    try {
      if (liked && likeRecordUri) {
        const parsed = parseAtUri(likeRecordUri);
        if (!parsed?.rkey) throw new Error('Could not resolve like record');
        await unlikePost(did, parsed.rkey);
        setLikeRecordUri(undefined);
        setCount(c => Math.max(0, c - 1));
      } else {
        const res = await likePost(did, { uri: post.uri, cid: post.cid });
        setLikeRecordUri(res.uri);
        setCount(c => c + 1);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update like');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      class={`post-like-btn${liked ? ' post-like-btn--liked' : ''}`}
      onClick={() => void onToggle()}
      disabled={busy}
      aria-pressed={liked}
      aria-label={liked ? `Unlike (${count})` : `Like (${count})`}
    >
      <span class="post-like-btn-icon" aria-hidden>
        {liked ? '♥' : '♡'}
      </span>
      <span class="post-like-btn-count">{count}</span>
    </button>
  );
}

export function PostDownvoteButton({
  downvoteRecordUri,
  displayCount,
  busy,
  onToggle,
}: {
  downvoteRecordUri?: string;
  displayCount: number;
  busy: boolean;
  onToggle: () => void | Promise<void>;
}) {
  const downvoted = Boolean(downvoteRecordUri);
  return (
    <button
      type="button"
      class={`post-downvote-btn${downvoted ? ' post-downvote-btn--active' : ''}`}
      onClick={() => void onToggle()}
      disabled={busy}
      aria-pressed={downvoted}
      title={downvoted ? 'Remove downvote' : 'Downvote (syncs across AT Protocol)'}
      aria-label={downvoted ? `Remove downvote (${displayCount})` : `Downvote (${displayCount})`}
    >
      <span class="post-downvote-btn-icon" aria-hidden>
        ↓
      </span>
      <span class="post-downvote-btn-count">{displayCount}</span>
    </button>
  );
}
