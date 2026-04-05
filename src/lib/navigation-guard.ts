import { isLoggedIn } from '@/lib/store';

let composerDirty = false;

export function setComposerNavigationDirty(dirty: boolean) {
  composerDirty = dirty;
}

export function isComposerNavigationDirty(): boolean {
  return composerDirty;
}

/** Call before in-app route changes; returns false if user cancels. */
export function confirmLeaveIfComposerDirty(): boolean {
  if (!isLoggedIn.value) return true;
  if (!composerDirty) return true;
  return window.confirm('You have an unsaved draft. Leave and keep it in Drafts?');
}
