import { signal, computed } from '@preact/signals';
import type { ProfileView } from '@/api/types';
import { mayHaveRestorableSession } from '@/api/auth';
import { getNsfwMediaMode, setNsfwMediaMode, type NsfwMediaMode } from '@/lib/preferences';
import { setStorageErrorHandler, type StorageError } from '@/lib/forumsky-local';
import { ANNOUNCEMENT_DELAY_MS, TOAST_DURATION_LONG_MS } from '@/lib/constants';

const STORED_USER_KEY = 'fsky_currentUser';

function getStoredUser(): ProfileView | null {
  try {
    const raw = localStorage.getItem(STORED_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const currentUser = signal<ProfileView | null>(getStoredUser());

currentUser.subscribe(user => {
  try {
    if (user) localStorage.setItem(STORED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORED_USER_KEY);
  } catch { /* ignore */ }
});

export const isLoggedIn = computed(() => currentUser.value !== null);

/** Set true after the first OAuth client init in Layout (whether or not a session exists). */
export const authInitDone = signal(false);

/** Guest UI should not show while OAuth may still restore a session. */
export function sessionRestorePending(): boolean {
  return !authInitDone.value && mayHaveRestorableSession();
}

export const toastMessage = signal<string | null>(null);

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(msg: string, duration = 3000) {
  toastMessage.value = msg;
  announceToScreenReader(msg);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMessage.value = null; }, duration);
}

/** Accessibility announcement signal for screen readers */
export const accessibilityAnnouncement = signal<string>('');

let announcementTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Announce a message to screen readers using ARIA live region.
 * Clears after a delay to allow re-announcement of same message.
 */
export function announceToScreenReader(message: string) {
  accessibilityAnnouncement.value = message;
  if (announcementTimer) clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => {
    accessibilityAnnouncement.value = '';
  }, ANNOUNCEMENT_DELAY_MS + 100);
}

/** Set up storage error handler to show user-friendly error messages */
function initStorageErrorHandler() {
  setStorageErrorHandler((error: StorageError) => {
    if (error.type === 'quota') {
      showToast('Storage is full — some data may not be saved. Try clearing old threads or drafts.', TOAST_DURATION_LONG_MS);
    } else if (error.type === 'private') {
      showToast('Private browsing mode detected — some features may not work properly.', TOAST_DURATION_LONG_MS);
    }
    // Log for debugging
    if (import.meta.env.DEV) {
      console.error('[Storage Error]', error);
    }
  });
}

// Initialize storage error handler
initStorageErrorHandler();

export const showAuthDialog = signal(false);
/** Where to get an AT Protocol account (separate from login OAuth). */
export const showSignUpDialog = signal(false);

export const currentRoute = signal<{ path: string; params: Record<string, string | undefined> }>({
  path: '/',
  params: {},
});

export const isLoading = signal(false);

/** Filled after sign-in via refreshGraphPolicy() */
export const mutedDids = signal<Set<string>>(new Set());
export const blockedDids = signal<Set<string>>(new Set());
/** Filled on auth init - users the current user follows. Null means not loaded yet. */
export const followingDids = signal<Set<string> | null>(null);

/** Sensitive / adult-labeled media: show, blur until revealed, or hide (stored in localStorage). */
export const nsfwMediaMode = signal<NsfwMediaMode>(getNsfwMediaMode());

export function applyNsfwMediaMode(mode: NsfwMediaMode) {
  setNsfwMediaMode(mode);
  nsfwMediaMode.value = mode;
}

export const showGlobalComposer = signal(false);
export const globalComposerCommunity = signal<string | undefined>(undefined);
export const globalComposerReplyTo = signal<
  | {
      root: { uri: string; cid: string };
      parent: { uri: string; cid: string };
      summary: string;
      /** Optional: the post record being replied to, for displaying preview */
      record?: { text?: string; embed?: unknown };
      author?: { handle: string; displayName?: string; avatar?: string };
    }
  | undefined
>(undefined);

export const isOnline = signal(typeof navigator !== 'undefined' ? navigator.onLine : true);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { isOnline.value = true });
  window.addEventListener('offline', () => { isOnline.value = false });
}
