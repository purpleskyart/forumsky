import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
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
import { authInitDone, currentUser, isLoggedIn, sessionRestorePending } from '@/lib/store';
import { clearGraphPolicy, refreshGraphPolicy } from '@/lib/graph-policy';
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

export function Layout({ children }: LayoutProps) {
  useEffect(() => {
    import('@/api/auth')
      .then(m => m.initAuth())
      .then(profile => {
        if (profile) {
          currentUser.value = profile;
          void refreshGraphPolicy();
        } else {
          setManualScrollRestoration();
          clearGraphPolicy();
        }
      })
      .catch(() => {
        clearGraphPolicy();
        // Auth init failed -- app still works for reading public content
      })
      .finally(() => {
        authInitDone.value = true;
      });
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
