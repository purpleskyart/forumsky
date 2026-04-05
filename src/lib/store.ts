import { signal, computed } from '@preact/signals';
import type { ProfileView } from '@/api/types';
import { mayHaveRestorableSession } from '@/api/auth';

export const currentUser = signal<ProfileView | null>(null);
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
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMessage.value = null; }, duration);
}

export const showAuthDialog = signal(false);
/** Where to get an AT Protocol account (separate from login OAuth). */
export const showSignUpDialog = signal(false);

export const currentRoute = signal<{ path: string; params: Record<string, string> }>({
  path: '/',
  params: {},
});

export const isLoading = signal(false);

/** Filled after sign-in via refreshGraphPolicy() */
export const mutedDids = signal<Set<string>>(new Set());
export const blockedDids = signal<Set<string>>(new Set());
