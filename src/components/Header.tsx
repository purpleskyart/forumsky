import { useState, useEffect, useRef } from 'preact/hooks';
import { Avatar } from '@/components/Avatar';
import { showAuthDialog, showSignUpDialog, currentUser, isLoggedIn, showToast, sessionRestorePending } from '@/lib/store';
import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, communityUrl, searchUrl, SPA_ANCHOR_SHIELD } from '@/lib/router';
import { clearGraphPolicy, refreshGraphPolicy } from '@/lib/graph-policy';
import type { ProfileView } from '@/api/types';

const HEADER_SEARCH_DEST_KEY = 'forumsky.headerSearchDestination';

type HeaderSearchDestination = 'community' | 'global' | 'following' | 'me';

const SEARCH_DEST_LABELS: Record<HeaderSearchDestination, string> = {
  community: 'Communities',
  global: 'All',
  following: 'Following',
  me: 'My posts',
};

/** Menu order: All first, then Communities, then signed-in scopes. */
const SEARCH_DEST_MENU_ORDER: HeaderSearchDestination[] = ['global', 'community', 'following', 'me'];

function readStoredSearchDestination(): HeaderSearchDestination {
  if (typeof window === 'undefined') return 'global';
  try {
    const v = localStorage.getItem(HEADER_SEARCH_DEST_KEY);
    if (v === 'global' || v === 'following' || v === 'me' || v === 'community') return v;
  } catch {
    /* ignore */
  }
  return 'global';
}

function persistSearchDestination(d: HeaderSearchDestination) {
  try {
    localStorage.setItem(HEADER_SEARCH_DEST_KEY, d);
  } catch {
    /* ignore */
  }
}

export function Header() {
  const [, setUiTick] = useState(0);
  const user = currentUser.value;
  const restoringSession = sessionRestorePending();
  const showLoggedInChrome = isLoggedIn.value || restoringSession;
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [accounts, setAccounts] = useState<ProfileView[]>([]);
  const [accountActionBusy, setAccountActionBusy] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchScopeRef = useRef<HTMLDivElement>(null);
  const [searchScopeOpen, setSearchScopeOpen] = useState(false);
  const [searchDestination, setSearchDestination] = useState<HeaderSearchDestination>(readStoredSearchDestination);

  const bumpUi = () => setUiTick(t => t + 1);

  useEffect(() => {
    if (!userMenuOpen && !searchScopeOpen) return;
    const onDocPointer = (e: Event) => {
      const t = e.target as Node;
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(t)) {
        setUserMenuOpen(false);
      }
      if (searchScopeOpen && searchScopeRef.current && !searchScopeRef.current.contains(t)) {
        setSearchScopeOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUserMenuOpen(false);
        setSearchScopeOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen, searchScopeOpen]);

  useEffect(() => {
    if (!userMenuOpen || !isLoggedIn.value) return;
    let cancelled = false;
    import('@/api/auth').then(m => m.listStoredAccountProfiles()).then(list => {
      if (!cancelled) setAccounts(list);
    });
    return () => { cancelled = true; };
  }, [userMenuOpen, user?.did]);

  const pickSearchDestination = (d: HeaderSearchDestination) => {
    if ((d === 'following' || d === 'me') && !isLoggedIn.value) {
      showAuthDialog.value = true;
      setSearchScopeOpen(false);
      return;
    }
    setSearchDestination(d);
    persistSearchDestination(d);
    setSearchScopeOpen(false);
    setMobileMenuOpen(false);
    setUserMenuOpen(false);
  };

  const onSearch = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
    const q = input.value.trim();
    if (!q) return;

    if (searchDestination === 'community') {
      if (q.startsWith('#') || q.match(/^[a-z0-9_-]+$/i)) {
        navigate(communityUrl(q.replace(/^#/, '')));
        input.value = '';
      } else {
        showToast('Use a hashtag or tag name (letters, numbers, _ and - only).');
      }
      return;
    }

    if ((searchDestination === 'following' || searchDestination === 'me') && !isLoggedIn.value) {
      showAuthDialog.value = true;
      return;
    }

    const scope = searchDestination === 'global' ? 'global' : searchDestination;
    navigate(searchUrl(q, scope));
    input.value = '';
  };

  return (
    <header class="header">
      <div class="header-banner">
        <div class="header-banner-inner">
          <a
            href={hrefForAppPath('/')}
            class="header-brand"
            {...SPA_ANCHOR_SHIELD}
            onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}
          >
            ForumSky
          </a>

          <div class="header-center-cluster">
            <a
              href={hrefForAppPath('/communities')}
              class="header-nav-link"
              {...SPA_ANCHOR_SHIELD}
              onClick={(e: Event) => { e.preventDefault(); navigate('/communities'); }}
            >
              Communities
            </a>
            <form class="header-search-area" onSubmit={onSearch}>
              <div class="header-search-inner" ref={searchScopeRef}>
                <input
                  type="search"
                  class="header-search-field"
                  placeholder="Search"
                  enterKeyHint="search"
                  aria-label={`Search (${SEARCH_DEST_LABELS[searchDestination]})`}
                />
                <button
                  type="button"
                  class="header-search-scope-trigger"
                  aria-expanded={searchScopeOpen}
                  aria-haspopup="menu"
                  aria-controls="header-search-scope-panel"
                  title={`Search in: ${SEARCH_DEST_LABELS[searchDestination]}. Click for other options.`}
                  onClick={(e: Event) => {
                    e.preventDefault();
                    setSearchScopeOpen(o => !o);
                    setMobileMenuOpen(false);
                    setUserMenuOpen(false);
                  }}
                >
                  <span class="header-search-scope-trigger-label" aria-hidden>
                    {SEARCH_DEST_LABELS[searchDestination]}
                  </span>
                  <span class="header-search-scope-chevron" aria-hidden>
                    ▼
                  </span>
                </button>
                <button type="submit" class="header-search-submit" aria-label="Search" title="Search">
                  <svg
                    class="header-search-submit-icon"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </button>
                {searchScopeOpen && (
                  <div
                    id="header-search-scope-panel"
                    class="header-search-scope-panel"
                    role="menu"
                    aria-label="Search scope"
                  >
                    {SEARCH_DEST_MENU_ORDER.map(d => {
                      const needsAuth = d === 'following' || d === 'me';
                      const disabled = needsAuth && !isLoggedIn.value;
                      return (
                        <button
                          key={d}
                          type="button"
                          role="menuitem"
                          class={`header-search-scope-option${d === searchDestination ? ' header-search-scope-option--active' : ''}`}
                          disabled={disabled}
                          onClick={() => pickSearchDestination(d)}
                        >
                          {SEARCH_DEST_LABELS[d]}
                          {disabled ? ' (sign in)' : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </form>
            {showLoggedInChrome && (
              <a
                href={hrefForAppPath('/activity')}
                class="header-nav-link"
                {...SPA_ANCHOR_SHIELD}
                onClick={(e: Event) => { e.preventDefault(); navigate('/activity'); }}
              >
                Activity
              </a>
            )}
          </div>

          <div class="header-right">
            {showLoggedInChrome && (
              <>
                <a
                  href={hrefForAppPath('/saved')}
                  class="header-nav-link header-nav-desktop"
                  {...SPA_ANCHOR_SHIELD}
                  onClick={(e: Event) => { e.preventDefault(); navigate('/saved'); }}
                >
                  Saved
                </a>
              </>
            )}
            {!showLoggedInChrome && (
              <a
                href={hrefForAppPath('/settings')}
                class="header-nav-link header-nav-desktop"
                {...SPA_ANCHOR_SHIELD}
                onClick={(e: Event) => {
                  e.preventDefault();
                  navigate('/settings');
                }}
              >
                Settings
              </a>
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
                      {...SPA_ANCHOR_SHIELD}
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
                      {...SPA_ANCHOR_SHIELD}
                      onClick={(e: Event) => {
                        e.preventDefault();
                        setUserMenuOpen(false);
                        navigate('/drafts');
                      }}
                    >
                      Drafts
                    </a>
                    <a
                      href={hrefForAppPath('/settings')}
                      role="menuitem"
                      class="header-user-menu-item"
                      {...SPA_ANCHOR_SHIELD}
                      onClick={(e: Event) => {
                        e.preventDefault();
                        setUserMenuOpen(false);
                        navigate('/settings');
                      }}
                    >
                      Settings
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


          </div>
        </div>
      </div>
    </header>
  );
}
