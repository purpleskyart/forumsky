import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { MobileAuthBar } from './MobileAuthBar';
import { AuthDialog } from './AuthDialog';
import { SignUpDialog } from './SignUpDialog';
import { Toast } from './Toast';
import { OutboxRetryBar } from './OutboxRetryBar';
import { OfflineBanner } from './OfflineBanner';
import { ReloadPrompt } from './ReloadPrompt';
import { FloatingPostButton } from './FloatingPostButton';
import { authInitDone, isLoggedIn, sessionRestorePending } from '@/lib/store';
import { appPathname } from '@/lib/app-base-path';
import { navigateBack } from '@/lib/router';

interface LayoutProps {
  children: ComponentChildren;
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return t.isContentEditable;
}

import { PullToRefresh } from './PullToRefresh';
import { Composer } from './Composer';
import { showGlobalComposer } from '@/lib/store';
import { setManualScrollRestoration } from '@/lib/scroll-restore';

function AppLoadingSkeleton() {
  return (
    <div class="loading" aria-label="Loading…" role="status">
      <span class="spinner" aria-hidden="true" />
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div class="error-panel" role="alert">
      <p>{message}</p>
      <button class="btn btn-primary" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  );
}

export function Layout({ children }: LayoutProps) {
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authInitDone.value = false;

    // Safety timeout: ensure authInitDone becomes true even if initAuth hangs
    const safetyTimer = setTimeout(() => {
      if (!cancelled) {
        authInitDone.value = true;
      }
    }, 6000);

    import('@/api/auth')
      .then(m => m.initAuth())
      .then(async (profile) => {
        if (!cancelled) {
          if (profile) {
            const { currentUser } = await import('@/lib/store');
            currentUser.value = profile;
            // isLoggedIn is computed from currentUser, no need to set it
          }
        }
      })
      .catch(err => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to initialize auth';
          setAuthError(msg);
        }
      })
      .finally(() => {
        clearTimeout(safetyTimer);
        if (!cancelled) {
          authInitDone.value = true;
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
    };
  }, []);

  /* Artsky-style: Escape blurs fields; Q / Backspace = history back when not on home. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const path = typeof window !== 'undefined' ? appPathname() : '/';
      if (isEditableTarget(e.target)) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (showGlobalComposer.value) {
            showGlobalComposer.value = false;
          } else {
            (e.target as HTMLElement).blur();
          }
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'q' || e.key === 'Backspace') {
        if (path === '/' || path === '') return;
        e.preventDefault();
        navigateBack();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const showLoggedInChrome = isLoggedIn.value || sessionRestorePending();
  const showMobileAuthBar = !showLoggedInChrome;

  if (authError) {
    return <ErrorPanel message={authError} />;
  }
  if (!authInitDone.value) {
    return <AppLoadingSkeleton />;
  }

  return (
    <div class="app-shell">
      <Header />
      {showMobileAuthBar && <MobileAuthBar />}
      <PullToRefresh>
        <div class="main-wrap">
          <OfflineBanner />
          <main class="content">{children}</main>
        </div>
      </PullToRefresh>
      <OutboxRetryBar />
      <BottomNav />
      <FloatingPostButton />
      {showGlobalComposer.value && (
        <div class="global-composer-overlay">
          <div class="global-composer-inner">
            <div class="global-composer-header">
              <h3>New Post</h3>
              <button
                class="btn btn-icon"
                onClick={() => {
                  showGlobalComposer.value = false;
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  stroke="currentColor"
                  stroke-width="2"
                  fill="none"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <Composer
              onPost={() => {
                showGlobalComposer.value = false;
              }}
              onCancel={() => {
                showGlobalComposer.value = false;
              }}
              draftKey="global-composer"
            />
          </div>
        </div>
      )}
      <AuthDialog />
      <SignUpDialog />
      <Toast />
      <ReloadPrompt />
    </div>
  );
}
