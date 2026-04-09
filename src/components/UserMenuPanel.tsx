import { useState, useEffect } from 'preact/hooks';
import { Avatar } from '@/components/Avatar';
import { currentUser, showAuthDialog, showToast } from '@/lib/store';
import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, SPA_ANCHOR_SHIELD } from '@/lib/router';
import { clearGraphPolicy, refreshGraphPolicy } from '@/lib/graph-policy';
import { listStoredAccountProfiles, switchToAccount, signOutCurrentUser } from '@/api/auth';
import type { ProfileView } from '@/api/types';

export function UserMenuPanel({ onClose, className = '' }: { onClose: () => void; className?: string }) {
  const user = currentUser.value;
  const [accounts, setAccounts] = useState<ProfileView[]>(() => {
    try {
      const raw = localStorage.getItem('forumsky:account-profiles-cache');
      if (raw) return JSON.parse(raw) as ProfileView[];
    } catch { /* ignore */ }
    return [];
  });
  const [accountActionBusy, setAccountActionBusy] = useState(false);

  useEffect(() => {
    if (!user?.did) return;
    let cancelled = false;
    listStoredAccountProfiles().then(list => {
      if (!cancelled) setAccounts(list);
    });
    return () => { cancelled = true; };
  }, [user?.did]);

  if (!user) return null;

  return (
    <div id="header-user-menu-panel" class={`header-user-menu-panel ${className}`} role="menu">
      <a
        href={hrefForAppPath(`/u/${user.handle}`)}
        role="menuitem"
        class="header-user-menu-head"
        {...SPA_ANCHOR_SHIELD}
        onClick={(e: Event) => {
          e.preventDefault();
          onClose();
          navigate(`/u/${user.handle}`);
        }}
      >
        <div class="header-user-menu-name">{user.displayName || user.handle}</div>
        <div class="header-user-menu-handle">@{user.handle}</div>
      </a>
      <a
        href={hrefForAppPath('/drafts')}
        role="menuitem"
        class="header-user-menu-item"
        {...SPA_ANCHOR_SHIELD}
        onClick={(e: Event) => {
          e.preventDefault();
          onClose();
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
          onClose();
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
              class={`header-user-menu-account${acc.did === user.did ? ' header-user-menu-account--active': ''}`}
              disabled={accountActionBusy}
              onClick={async (e) => {
                e.stopPropagation();
                if (acc.did === user.did) {
                  onClose();
                  return;
                }
                setAccountActionBusy(true);
                try {
                  const profile = await switchToAccount(acc.did);
                  currentUser.value = profile;
                  void refreshGraphPolicy();
                } catch {
                  showToast('Could not switch to that account');
                } finally {
                  setAccountActionBusy(false);
                  onClose();
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
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        role="menuitem"
        class="header-user-menu-item header-user-menu-add-account"
        disabled={accountActionBusy}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
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
        onClick={async (e) => {
          e.stopPropagation();
          onClose();
          setAccountActionBusy(true);
          try {
            const profile = await signOutCurrentUser();
            currentUser.value = profile;
            if (profile) void refreshGraphPolicy();
            else clearGraphPolicy();
          } finally {
            setAccountActionBusy(false);
          }
        }}
      >
        Sign out
      </button>
    </div>
  );
}
