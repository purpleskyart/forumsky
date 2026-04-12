import { useState, useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import {
  getThreadSubscriptionLevel,
  setThreadSubscriptionLevel,
  type SubscriptionLevel,
} from '@/lib/forumsky-local';
import { isLoggedIn, showAuthDialog, showToast } from '@/lib/store';

interface PostSubscribeButtonProps {
  threadRootUri?: string;
  onLevelChange?: (level: SubscriptionLevel) => void;
}

export function PostSubscribeButton({ threadRootUri, onLevelChange }: PostSubscribeButtonProps) {
  const [level, setLevel] = useState<SubscriptionLevel>(() =>
    threadRootUri ? getThreadSubscriptionLevel(threadRootUri) : 'none',
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (threadRootUri) {
      setLevel(getThreadSubscriptionLevel(threadRootUri));
    }
  }, [threadRootUri]);

  useEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const menuWidth = 200;
    const left = Math.min(
      Math.max(8, r.right - menuWidth),
      typeof window !== 'undefined' ? window.innerWidth - menuWidth - 8 : r.left,
    );
    setMenuPos({ top: r.bottom + 4, left });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onScrollOrResize = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      const menuWidth = 200;
      const left = Math.min(
        Math.max(8, r.right - menuWidth),
        window.innerWidth - menuWidth - 8,
      );
      setMenuPos({ top: r.bottom + 4, left });
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [menuOpen]);

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

  const setSubscription = async (newLevel: SubscriptionLevel) => {
    if (!threadRootUri) return;
    if (!isLoggedIn.value) {
      showAuthDialog.value = true;
      setMenuOpen(false);
      return;
    }
    try {
      await setThreadSubscriptionLevel(threadRootUri, newLevel);
      setLevel(newLevel);
      onLevelChange?.(newLevel);
      const toastMsg =
        newLevel === 'thread'
          ? 'Subscribed to this thread'
          : newLevel === 'all'
            ? 'Subscribed to all replies'
            : 'Unsubscribed';
      showToast(toastMsg);
    } catch {
      showToast('Could not update subscription');
    } finally {
      setMenuOpen(false);
    }
  };

  const onClick = () => {
    if (!threadRootUri) return;
    if (!isLoggedIn.value) {
      showAuthDialog.value = true;
      return;
    }
    setMenuOpen(true);
  };

  const titleText =
    level === 'all' ? 'Subscribed to all replies' : level === 'thread' ? 'Subscribed to thread' : 'Subscribe';

  const menuPortal =
    menuOpen &&
    menuPos &&
    createPortal(
      <div
        ref={menuRef}
        class="post-subscribe-menu post-subscribe-menu--portal"
        style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
        role="menu"
        aria-label="Subscription options"
      >
        <button
          type="button"
          role="menuitem"
          class={`post-subscribe-menu-item ${level === 'all' ? 'post-subscribe-menu-item--active' : ''}`}
          onClick={() => void setSubscription('all')}
        >
          <span class="post-subscribe-menu-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              <path d="M2 5c2 2 2 5 0 7" />
              <path d="M22 5c-2 2-2 5 0 7" />
            </svg>
          </span>
          <span class="post-subscribe-menu-text">
            <span class="post-subscribe-menu-label">All replies</span>
            <span class="post-subscribe-menu-hint">Get notified of all replies</span>
          </span>
        </button>
        <button
          type="button"
          role="menuitem"
          class={`post-subscribe-menu-item ${level === 'thread' ? 'post-subscribe-menu-item--active' : ''}`}
          onClick={() => void setSubscription('thread')}
        >
          <span class="post-subscribe-menu-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </span>
          <span class="post-subscribe-menu-text">
            <span class="post-subscribe-menu-label">This thread</span>
            <span class="post-subscribe-menu-hint">Top-level replies only</span>
          </span>
        </button>
        <div class="post-subscribe-menu-divider" />
        <button
          type="button"
          role="menuitem"
          class={`post-subscribe-menu-item ${level === 'none' ? 'post-subscribe-menu-item--active' : ''}`}
          onClick={() => void setSubscription('none')}
        >
          <span class="post-subscribe-menu-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </span>
          <span class="post-subscribe-menu-text">
            <span class="post-subscribe-menu-label">Unsubscribe</span>
            <span class="post-subscribe-menu-hint">Stop notifications</span>
          </span>
        </button>
      </div>,
      document.body,
    );

  return (
    <div class="post-subscribe-wrap">
      <button
        ref={btnRef}
        type="button"
        class="post-subscribe-btn"
        onClick={onClick}
        disabled={!threadRootUri}
        title={titleText}
        aria-label={titleText}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <span class="post-subscribe-btn-icon" aria-hidden>
          {level === 'all' ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              <path d="M2 5c2 2 2 5 0 7" />
              <path d="M22 5c-2 2-2 5 0 7" />
            </svg>
          ) : level === 'thread' ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          )}
        </span>
      </button>
      {menuPortal}
    </div>
  );
}
