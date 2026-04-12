import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { Avatar } from '@/components/Avatar';
import { showAuthDialog, showSignUpDialog, currentUser, isLoggedIn, showToast, sessionRestorePending, showGlobalComposer } from '@/lib/store';
import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, communityUrl, searchUrl, SPA_ANCHOR_SHIELD, threadUrl, profileUrl } from '@/lib/router';
import { UserMenuPanel } from '@/components/UserMenuPanel';
import { searchActors } from '@/api/actor';
import { searchPosts, parseAtUri } from '@/api/feed';
import type { ProfileView, PostView } from '@/api/types';

const HEADER_SEARCH_DEST_KEY = 'forumsky.headerSearchDestination';

type HeaderSearchDestination = 'community' | 'global' | 'following' | 'me' | 'users';

const SEARCH_DEST_LABELS: Record<HeaderSearchDestination, string> = {
  community: 'Communities',
  global: 'All',
  following: 'Following',
  me: 'My posts',
  users: 'Users',
};

/** Menu order: All first, then Communities, then Users, then signed-in scopes. */
const SEARCH_DEST_MENU_ORDER: HeaderSearchDestination[] = ['global', 'community', 'users', 'following', 'me'];

function readStoredSearchDestination(): HeaderSearchDestination {
  if (typeof window === 'undefined') return 'global';
  try {
    const v = localStorage.getItem(HEADER_SEARCH_DEST_KEY);
    if (v === 'global' || v === 'following' || v === 'me' || v === 'community' || v === 'users') return v;
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
  const userMenuRef = useRef<HTMLDivElement>(null);
  const searchScopeRef = useRef<HTMLDivElement>(null);
  const [searchScopeOpen, setSearchScopeOpen] = useState(false);
  const [searchDestination, setSearchDestination] = useState<HeaderSearchDestination>(readStoredSearchDestination);
  const [searchInput, setSearchInput] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState<{ users: ProfileView[]; posts: PostView[] }>({ users: [], posts: [] });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!userMenuOpen && !searchScopeOpen && !showSuggestions) return;
    const onDocPointer = (e: Event) => {
      const t = e.target as Node;
      if (userMenuOpen && userMenuRef.current && !userMenuRef.current.contains(t)) {
        setUserMenuOpen(false);
      }
      if (searchScopeOpen && searchScopeRef.current && !searchScopeRef.current.contains(t)) {
        setSearchScopeOpen(false);
      }
      if (showSuggestions && suggestionsRef.current && !suggestionsRef.current.contains(t)) {
        setShowSuggestions(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUserMenuOpen(false);
        setSearchScopeOpen(false);
        setShowSuggestions(false);
      }
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [userMenuOpen, searchScopeOpen, showSuggestions]);



  const pickSearchDestination = (d: HeaderSearchDestination) => {
    if ((d === 'following' || d === 'me') && !isLoggedIn.value) {
      showAuthDialog.value = true;
      setSearchScopeOpen(false);
      return;
    }
    setSearchDestination(d);
    persistSearchDestination(d);
    setSearchScopeOpen(false);
    setUserMenuOpen(false);
  };

  const onSearch = (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const input = form.querySelector('input') as HTMLInputElement;
    const q = input.value.trim();
    if (!q) return;

    setShowSuggestions(false);
    setSearchInput('');

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

  const onSearchInputChange = useCallback(async (value: string) => {
    setSearchInput(value);
    
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (value.trim().length < 2) {
      setSearchSuggestions({ users: [], posts: [] });
      setShowSuggestions(false);
      return;
    }

    searchDebounceRef.current = setTimeout(async () => {
      try {
        const [users, postsRes] = await Promise.all([
          searchActors(value, { limit: 5 }),
          searchPosts(value, { limit: 5, sort: 'latest' }),
        ]);
        setSearchSuggestions({ users, posts: postsRes.posts.filter(p => !p.record?.reply).slice(0, 5) });
        setShowSuggestions(true);
      } catch {
        setSearchSuggestions({ users: [], posts: [] });
      }
    }, 300);
  }, []);

  const onSuggestionClick = (type: 'user' | 'post', item: ProfileView | PostView) => {
    setShowSuggestions(false);
    setSearchInput('');
    if (type === 'user') {
      navigate(profileUrl((item as ProfileView).handle));
    } else {
      const post = item as PostView;
      const parsed = parseAtUri(post.uri);
      if (parsed) {
        navigate(threadUrl(post.author.handle || post.author.did, parsed.rkey));
      }
    }
  };

  return (
    <header class="header">
      <div class="header-banner">
        <div class="header-banner-inner">
          <a
            href={hrefForAppPath('/')}
            class="header-brand"
            {...SPA_ANCHOR_SHIELD}
            onClick={(e: Event) => {
              e.preventDefault();
              if (window.location.pathname === '/' || window.location.pathname === '') {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              } else {
                navigate('/');
              }
            }}
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
                  ref={searchInputRef}
                  type="search"
                  class="header-search-field"
                  placeholder="Search"
                  enterKeyHint="search"
                  value={searchInput}
                  onInput={(e: Event) => onSearchInputChange((e.target as HTMLInputElement).value)}
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
                    setUserMenuOpen(false);
                    setShowSuggestions(false);
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
                {showSuggestions && (searchSuggestions.users.length > 0 || searchSuggestions.posts.length > 0) && (
                  <div class="header-search-suggestions" ref={suggestionsRef}>
                    {searchSuggestions.users.length > 0 && (
                      <div class="header-search-suggestion-section">
                        <div class="header-search-suggestion-section-header">Users</div>
                        {searchSuggestions.users.map(u => (
                          <button
                            key={u.did}
                            type="button"
                            class="header-search-suggestion-item"
                            onClick={() => onSuggestionClick('user', u)}
                          >
                            <Avatar src={u.avatar} alt={u.displayName || u.handle} size={24} />
                            <span class="header-search-suggestion-text">
                              <span class="header-search-suggestion-name">{u.displayName || u.handle}</span>
                              <span class="header-search-suggestion-handle">@{u.handle}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchSuggestions.posts.length > 0 && (
                      <div class="header-search-suggestion-section">
                        <div class="header-search-suggestion-section-header">Posts</div>
                        {searchSuggestions.posts.map(p => (
                          <button
                            key={p.uri}
                            type="button"
                            class="header-search-suggestion-item"
                            onClick={() => onSuggestionClick('post', p)}
                          >
                            <span class="header-search-suggestion-text">
                              <span class="header-search-suggestion-name">{p.author.displayName || p.author.handle}</span>
                              <span class="header-search-suggestion-handle">@{p.author.handle}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
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
            <div class="header-auth">
            {showLoggedInChrome ? (
              restoringSession ? (
                <div class="header-session-restore" role="status" aria-live="polite" aria-label="Restoring session">
                  <div class="spinner" />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    class="btn btn-primary btn-sm header-new-post-btn"
                    onClick={() => { showGlobalComposer.value = true; }}
                  >
                    New Post
                  </button>
                  <div class="header-user-menu" ref={userMenuRef}>
                    <button
                      type="button"
                      class="header-user-menu-trigger"
                      aria-expanded={userMenuOpen}
                      aria-haspopup="menu"
                      aria-controls="header-user-menu-panel"
                      title={`${user?.displayName || user?.handle} — account menu`}
                      onClick={() => {
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
                      <UserMenuPanel onClose={() => setUserMenuOpen(false)} />
                    )}
                  </div>
                </>
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
