import { useState, useEffect, useRef } from 'preact/hooks';
import { Avatar } from '@/components/Avatar';
import { showAuthDialog, showSignUpDialog, currentUser, isLoggedIn, showToast, sessionRestorePending } from '@/lib/store';
import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, communityUrl, searchUrl } from '@/lib/router';
import { clearGraphPolicy, refreshGraphPolicy } from '@/lib/graph-policy';
import type { ProfileView } from '@/api/types';

export function Header() {
  const [, setUiTick] = useState(0);
  const user = currentUser.value;
  const restoringSession = sessionRestorePending();
  const showLoggedInChrome = isLoggedIn.value || restoringSession;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [accounts, setAccounts] = useState<ProfileView[]>([]);
  const [accountActionBusy, setAccountActionBusy] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const bumpUi = () => setUiTick(t => t + 1);

  useEffect(() => {
    if (!mobileMenuOpen && !userMenuOpen) return;
    const onDocPointer = (e: Event) => {
      const t = e.target as Node;
      if (mobileMenuOpen && mobileMenuRef.current && !mobileMenuRef.current.contains(t)) {
        setMobileMenuOpen(false);
      }
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(t)) {
        setUserMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileMenuOpen, userMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen || !isLoggedIn.value) return;
    let cancelled = false;
    import('@/api/auth').then(m => m.listStoredAccountProfiles()).then(list => {
      if (!cancelled) setAccounts(list);
    });
    return () => { cancelled = true; };
  }, [userMenuOpen, user?.did]);

  const onSearch = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
    const q = input.value.trim();
    if (q) {
      if (q.startsWith('#') || q.match(/^[a-z0-9_-]+$/i)) {
        navigate(communityUrl(q.replace(/^#/, '')));
      } else {
        navigate(searchUrl(q, 'global'));
      }
      input.value = '';
    }
  };

  return (
    <header class="header">
      <div class="header-banner">
        <div class="header-banner-inner">
          <a href={hrefForAppPath('/')} class="header-brand" onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}>
            ForumSky
          </a>

          <div class="header-center-cluster">
            <a
              href={hrefForAppPath('/communities')}
              class="header-nav-link"
              onClick={(e: Event) => { e.preventDefault(); navigate('/communities'); }}
            >
              Communities
            </a>
            <form class="header-search-area" onSubmit={onSearch}>
              <input type="search" placeholder="Search communities…" enterKeyHint="search" />
            </form>
          </div>

          <div class="header-right">
            {showLoggedInChrome && (
              <>
                <a
                  href={hrefForAppPath('/activity')}
                  class="header-nav-link header-nav-desktop"
                  onClick={(e: Event) => { e.preventDefault(); navigate('/activity'); }}
                >
                  Activity
                </a>
                <a
                  href={hrefForAppPath('/saved')}
                  class="header-nav-link header-nav-desktop"
                  onClick={(e: Event) => { e.preventDefault(); navigate('/saved'); }}
                >
                  Saved
                </a>
              </>
            )}
            <div class="header-auth">
            {showLoggedInChrome ? (
              restoringSession ? (
                <div class="header-session-restore" role="status" aria-live="polite" aria-label="Restoring session">
                  <div class="spinner" />
                </div>
              ) : (
              <div class="header-user-menu" ref={userMenuRef}>
                <button
                  type="button"
                  class="header-user-menu-trigger"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  aria-controls="header-user-menu-panel"
                  title={`${user?.displayName || user?.handle} — account menu`}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setUserMenuOpen(o => !o);
                  }}
                >
                  <Avatar
                    src={user?.avatar}
                    alt={user?.displayName || user?.handle || 'Account'}
                    size={32}
                  />
                </button>
                {userMenuOpen && (
                  <div id="header-user-menu-panel" class="header-user-menu-panel" role="menu">
                    <a
                      href={hrefForAppPath(`/u/${user!.handle}`)}
                      role="menuitem"
                      class="header-user-menu-head"
                      onClick={(e: Event) => {
                        e.preventDefault();
                        setUserMenuOpen(false);
                        navigate(`/u/${user!.handle}`);
                      }}
                    >
                      <div class="header-user-menu-name">{user?.displayName || user?.handle}</div>
                      <div class="header-user-menu-handle">@{user?.handle}</div>
                    </a>
                    <a
                      href={hrefForAppPath('/drafts')}
                      role="menuitem"
                      class="header-user-menu-item"
                      onClick={(e: Event) => {
                        e.preventDefault();
                        setUserMenuOpen(false);
                        navigate('/drafts');
                      }}
                    >
                      Drafts
                    </a>
                    {accounts.length > 1 && (
                      <div class="header-user-menu-accounts" role="group" aria-label="Switch account">
                        <div class="header-user-menu-section-title">Accounts</div>
                        {accounts.map(acc => (
                          <button
                            key={acc.did}
                            type="button"
                            role="menuitem"
                            class={`header-user-menu-account${acc.did === user?.did ? ' header-user-menu-account--active': ''}`}
                            disabled={accountActionBusy}
                            onClick={async () => {
                              if (acc.did === user?.did) {
                                setUserMenuOpen(false);
                                return;
                              }
                              setAccountActionBusy(true);
                              try {
                                const { switchToAccount } = await import('@/api/auth');
                                const profile = await switchToAccount(acc.did);
                                currentUser.value = profile;
                                void refreshGraphPolicy();
                                bumpUi();
                              } catch {
                                showToast('Could not switch to that account');
                              } finally {
                                setAccountActionBusy(false);
                                setUserMenuOpen(false);
                              }
                            }}
                          >
                            <Avatar
                              src={acc.avatar}
                              alt={acc.displayName || acc.handle}
                              size={28}
                            />
                            <span class="header-user-menu-account-text">
                              <span class="header-user-menu-account-name">
                                {acc.displayName || acc.handle}
                              </span>
                              <span class="header-user-menu-account-handle">@{acc.handle}</span>
                            </span>
                            {acc.did === user?.did && (
                              <span class="header-user-menu-account-badge">Active</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      class="header-user-menu-item header-user-menu-add-account"
                      disabled={accountActionBusy}
                      onClick={() => {
                        setUserMenuOpen(false);
                        showAuthDialog.value = true;
                      }}
                    >
                      Add account
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      class="header-user-menu-item header-user-menu-signout"
                      disabled={accountActionBusy}
                      onClick={async () => {
                        setUserMenuOpen(false);
                        setAccountActionBusy(true);
                        try {
                          const { signOutCurrentUser } = await import('@/api/auth');
                          const profile = await signOutCurrentUser();
                          currentUser.value = profile;
                          if (profile) void refreshGraphPolicy();
                          else clearGraphPolicy();
                          bumpUi();
                        } finally {
                          setAccountActionBusy(false);
                        }
                      }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
              )
            ) : (
              <>
                <a
                  href="#"
                  onClick={(e: Event) => {
                    e.preventDefault();
                    showSignUpDialog.value = false;
                    showAuthDialog.value = true;
                  }}
                >
                  Login
                </a>
                <span style="color:#666">or</span>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  onClick={() => {
                    showAuthDialog.value = false;
                    showSignUpDialog.value = true;
                  }}
                >
                  Sign Up
                </button>
              </>
            )}
            </div>

            {showLoggedInChrome && (
              <div class="header-mobile-menu" ref={mobileMenuRef}>
                <button
                  type="button"
                  class="header-mobile-menu-toggle"
                  aria-expanded={mobileMenuOpen}
                  aria-haspopup="menu"
                  aria-controls="header-mobile-menu-panel"
                  onClick={() => {
                    setUserMenuOpen(false);
                    setMobileMenuOpen(o => !o);
                  }}
                >
                  Menu
                </button>
                {mobileMenuOpen && (
                  <div id="header-mobile-menu-panel" class="header-mobile-menu-panel" role="menu">
                    <a
                      href={hrefForAppPath('/activity')}
                      role="menuitem"
                      class="header-mobile-menu-item"
                      onClick={(e: Event) => {
                        e.preventDefault();
                        setMobileMenuOpen(false);
                        navigate('/activity');
                      }}
                    >
                      Activity
                    </a>
                    <a
                      href={hrefForAppPath('/saved')}
                      role="menuitem"
                      class="header-mobile-menu-item"
                      onClick={(e: Event) => {
                        e.preventDefault();
                        setMobileMenuOpen(false);
                        navigate('/saved');
                      }}
                    >
                      Saved
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
