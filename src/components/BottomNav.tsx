import { useState, useEffect, useRef } from 'preact/hooks';
import { navigate } from '@/lib/router';
import { currentUser, isLoggedIn, showAuthDialog, showSignUpDialog, currentRoute } from '@/lib/store';
import { Avatar } from '@/components/Avatar';
import { UserMenuPanel } from '@/components/UserMenuPanel';

interface NavItem {
  href?: string;
  label: string;
  icon: (active: boolean) => preact.JSX.Element | null;
  requiresAuth?: boolean;
  isProfile?: boolean;
  requiresLogout?: boolean;
  onClick?: () => void;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Home',
    icon: (active) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: '/search',
    label: 'Search',
    icon: (active) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    href: '/communities',
    label: 'Communities',
    icon: (active) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/activity',
    label: 'Activity',
    requiresAuth: true,
    icon: (active) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    isProfile: true,
    icon: () => null,
  },
];


export function BottomNav() {
  const [visible] = useState(true);
  const user = currentUser.value;
  const loggedIn = isLoggedIn.value;
  const route = currentRoute.value;
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDoc = (e: Event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [userMenuOpen]);

  const handleNav = (e: MouseEvent, href: string | undefined) => {
    if (!href) return;
    e.preventDefault();

    const isHome = href === '/';
    const isCurrentlyOnThisPage = isHome
      ? route.path === '/'
      : route.path.startsWith(href);

    if (isCurrentlyOnThisPage) {
      // Always scroll to top if already on the page
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      navigate(href);
      // For non-home buttons, the user specifically wants to be at the top.
      if (!isHome) {
        window.scrollTo({ top: 0 });
      }
    }
  };

  return (
    <nav class="bottom-nav" aria-label="Mobile navigation">
      <div class={`bottom-nav-inner${visible ? ' bottom-nav-visible' : ' bottom-nav-hidden'}`}>
        {NAV_ITEMS.map((item, index) => {
          if (item.requiresAuth && !loggedIn) return null;
          if (item.requiresLogout && loggedIn) return null;

          const isActive = item.href ? (item.href === '/' ? route.path === '/' : route.path.startsWith(item.href)) : false;

          if (item.isProfile) {
            const isUserActive = route.path === `/u/${user?.handle}`;
            return (
              <div key={item.href || `profile-${index}`} class="bottom-nav-profile-wrap" ref={userMenuRef}>
                {userMenuOpen && (
                  <UserMenuPanel
                    className="bottom-nav-user-menu"
                    onClose={() => setUserMenuOpen(false)}
                  />
                )}
                <button
                  type="button"
                  class={`bottom-nav-item bottom-nav-profile${isUserActive ? ' bottom-nav-item--active' : ''}`}
                  aria-label={item.label}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="menu"
                  title={item.label}
                  onClick={() => {
                    if (user) {
                      setUserMenuOpen(o => !o);
                    } else {
                      showSignUpDialog.value = false;
                      showAuthDialog.value = true;
                    }
                  }}
                >
                  {user ? (
                    <Avatar
                      src={user.avatar}
                      alt={user.displayName || user.handle}
                      size={28}
                      className={isUserActive ? 'avatar--active' : ''}
                    />
                  ) : (
                    <span class="bottom-nav-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={isActive ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                        <polyline points="10 17 15 12 10 7" />
                        <line x1="15" y1="12" x2="3" y2="12" />
                      </svg>
                    </span>
                  )}
                </button>
              </div>
            );
          }

          if (item.onClick) {
            return (
              <button
                key={`action-${index}`}
                type="button"
                class="bottom-nav-item bottom-nav-item--post"
                aria-label={item.label}
                title={item.label}
                onClick={item.onClick}
              >
                <span class="bottom-nav-icon">{item.icon(false)}</span>
                <span class="bottom-nav-label">{item.label}</span>
              </button>
            );
          }

          return (
            <a
              key={item.href || `link-${index}`}
              href={item.href}
              class={`bottom-nav-item${isActive ? ' bottom-nav-item--active' : ''}`}
              aria-label={item.label}
              title={item.label}
              onClick={(e) => handleNav(e, item.href)}
            >
              <span class="bottom-nav-icon">{item.icon(isActive)}</span>
              <span class="bottom-nav-label">{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
