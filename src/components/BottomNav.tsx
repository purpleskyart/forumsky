import { useState, useEffect, useRef } from 'preact/hooks';
import { navigate } from '@/lib/router';
import { currentUser, isLoggedIn, showAuthDialog, showSignUpDialog } from '@/lib/store';
import { Avatar } from '@/components/Avatar';

interface NavItem {
  href?: string;
  label: string;
  icon: preact.JSX.Element | null;
  requiresAuth?: boolean;
  isProfile?: boolean;
  requiresLogout?: boolean;
  onClick?: () => void;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: 'Home',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: '/communities',
    label: 'Communities',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    isProfile: true,
    icon: null,
  },
];

export function BottomNav() {
  const [visible, setVisible] = useState(true);
  const user = currentUser.value;
  const loggedIn = isLoggedIn.value;

  const handleNav = (e: MouseEvent, href: string | undefined) => {
    if (!href) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <nav class="bottom-nav" aria-label="Mobile navigation">
      <div class={`bottom-nav-inner${visible ? ' bottom-nav-visible' : ' bottom-nav-hidden'}`}>
        {NAV_ITEMS.map((item, index) => {
          if (item.requiresAuth && !loggedIn) return null;
          if (item.requiresLogout && loggedIn) return null;

          if (item.isProfile) {
            return (
              <button
                key={item.href || `profile-${index}`}
                type="button"
                class="bottom-nav-item bottom-nav-profile"
                aria-label={item.label}
                title={item.label}
                onClick={() => {
                  if (user) {
                    navigate(`/u/${user.handle}`);
                  } else if (item.onClick) {
                    item.onClick();
                  }
                }}
              >
                {user ? (
                  <Avatar src={user.avatar} alt={user.displayName || user.handle} size={28} />
                ) : (
                  <span class="bottom-nav-icon">{item.icon}</span>
                )}
                <span class="bottom-nav-label">{item.label}</span>
              </button>
            );
          }

          if (item.onClick) {
            return (
              <button
                key={`action-${index}`}
                type="button"
                class="bottom-nav-item"
                aria-label={item.label}
                title={item.label}
                onClick={item.onClick}
              >
                <span class="bottom-nav-icon">{item.icon}</span>
                <span class="bottom-nav-label">{item.label}</span>
              </button>
            );
          }

          return (
            <a
              key={item.href || `link-${index}`}
              href={item.href}
              class="bottom-nav-item"
              aria-label={item.label}
              title={item.label}
              onClick={(e) => handleNav(e, item.href)}
            >
              <span class="bottom-nav-icon">{item.icon}</span>
              <span class="bottom-nav-label">{item.label}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
