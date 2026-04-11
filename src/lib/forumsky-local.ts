import type { StrongRef, Facet } from '@/api/types';
import { getSubscribedThreadsFromRepo, saveSubscribedThreadsToRepo, getSavedThreadsFromRepo, saveSavedThreadsToRepo } from '@/api/actor';

const PREFIX = 'forumsky_';

function key(k: string) {
  return PREFIX + k;
}

function loadJSON<T>(k: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(k));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export type StorageError = { type: 'quota' | 'private' | 'unknown'; message: string };

let storageErrorHandler: ((error: StorageError) => void) | null = null;

/**
 * Set a handler to be called when storage operations fail.
 * Used to notify users of quota exceeded errors.
 */
export function setStorageErrorHandler(handler: ((error: StorageError) => void) | null) {
  storageErrorHandler = handler;
}

function notifyStorageError(error: StorageError) {
  if (storageErrorHandler) {
    storageErrorHandler(error);
  }
}

function saveJSON(k: string, v: unknown): boolean {
  try {
    localStorage.setItem(key(k), JSON.stringify(v));
    return true;
  } catch (err) {
    /* quota / private mode */
    if (err instanceof Error) {
      if (err.name === 'QuotaExceededError' || 
          err.message?.includes('quota') ||
          err.message?.includes('storage') ||
          err.message?.includes('exceeded')) {
        notifyStorageError({ type: 'quota', message: `Storage full: unable to save ${k}` });
      } else if (err.message?.includes('private') || err.message?.includes('secure')) {
        notifyStorageError({ type: 'private', message: `Private mode: cannot save ${k}` });
      }
    }
    return false;
  }
}

/** Root thread URIs the user bookmarked */
const SAVED_THREADS_KEY = 'saved_threads';

let cachedRepoSavedThreads: string[] | null = null;
let savedRepoSyncPromise: Promise<string[]> | null = null;

async function loadSavedThreadsFromRepo(): Promise<string[]> {
  if (savedRepoSyncPromise) return savedRepoSyncPromise;
  savedRepoSyncPromise = getSavedThreadsFromRepo();
  try {
    const result = await savedRepoSyncPromise;
    cachedRepoSavedThreads = result;
    return result;
  } finally {
    savedRepoSyncPromise = null;
  }
}

export async function syncSavedThreadsFromRepo(): Promise<void> {
  try {
    const repoSaved = await loadSavedThreadsFromRepo();
    if (repoSaved.length > 0) {
      cachedRepoSavedThreads = repoSaved;
      saveJSON(SAVED_THREADS_KEY, repoSaved);
    }
  } catch {
    // Sync failed, use localStorage
  }
}

export function getSavedThreadRootUris(): string[] {
  // If we have cached repo data, use it
  if (cachedRepoSavedThreads) {
    return cachedRepoSavedThreads;
  }
  // Otherwise fall back to localStorage
  return loadJSON<string[]>(SAVED_THREADS_KEY, []);
}

export function isThreadSaved(rootUri: string): boolean {
  return getSavedThreadRootUris().includes(rootUri);
}

export async function toggleSavedThread(rootUri: string): Promise<boolean> {
  const cur = getSavedThreadRootUris();
  const i = cur.indexOf(rootUri);
  if (i >= 0) {
    cur.splice(i, 1);
  } else {
    cur.push(rootUri);
  }

  // Update localStorage immediately
  saveJSON(SAVED_THREADS_KEY, cur);

  // Update cache
  cachedRepoSavedThreads = cur;

  // Sync to repo in background
  try {
    await saveSavedThreadsToRepo(cur);
  } catch {
    // Sync failed, localStorage has the data
  }

  return i < 0;
}

/** Last post URI the user has read through (inclusive), per thread root */
const THREAD_READ_LEGACY = 'thread_read';
const THREAD_READ_META = 'thread_read_meta';

export interface ThreadReadMeta {
  lastPostUri: string;
  /** Root post replyCount when user last marked read through end (for list unread dots). */
  replyCountAtMark?: number | null;
}

function readThreadReadMetaMap(): Record<string, ThreadReadMeta> {
  return loadJSON<Record<string, ThreadReadMeta>>(THREAD_READ_META, {});
}

export function getThreadReadMeta(threadRootUri: string): ThreadReadMeta | null {
  const meta = readThreadReadMetaMap()[threadRootUri];
  if (meta?.lastPostUri) return meta;
  const legacy = loadJSON<Record<string, string>>(THREAD_READ_LEGACY, {});
  const leg = legacy[threadRootUri];
  if (leg) return { lastPostUri: leg, replyCountAtMark: null };
  return null;
}

export function getLastReadPostUri(threadRootUri: string): string | null {
  return getThreadReadMeta(threadRootUri)?.lastPostUri ?? null;
}

export function setLastReadPostUri(
  threadRootUri: string,
  postUri: string,
  opts?: { replyCountAtMark?: number | null },
) {
  const m = readThreadReadMetaMap();
  const prev = m[threadRootUri];
  m[threadRootUri] = {
    lastPostUri: postUri,
    replyCountAtMark:
      opts?.replyCountAtMark !== undefined
        ? opts.replyCountAtMark
        : prev?.replyCountAtMark ?? null,
  };
  saveJSON(THREAD_READ_META, m);
  
  // Clean up legacy entry for this thread since we now have the new format
  const leg = loadJSON<Record<string, string>>(THREAD_READ_LEGACY, {});
  if (threadRootUri in leg) {
    delete leg[threadRootUri];
    saveJSON(THREAD_READ_LEGACY, leg);
  }
}

/** True when reply count grew after the user last marked the thread read through the end. */
export function threadHasNewRepliesSinceLastMark(
  threadRootUri: string,
  currentRootReplyCount: number,
): boolean {
  const meta = getThreadReadMeta(threadRootUri);
  const baseline = meta?.replyCountAtMark;
  if (baseline == null) return false;
  return currentRootReplyCount > baseline;
}

/** Thread is “caught up” for hide-read filter (user marked read and no new replies since). */
export function threadIsCaughtUp(threadRootUri: string, currentRootReplyCount: number): boolean {
  const meta = getThreadReadMeta(threadRootUri);
  if (meta?.replyCountAtMark == null) return false;
  return currentRootReplyCount <= meta.replyCountAtMark;
}

/** Locally hidden post URIs and their descendants (per thread root) */
export function getLocallyHiddenPostUris(threadRootUri: string): string[] {
  const m = loadJSON<Record<string, string[]>>('thread_hidden_subtrees', {});
  return m[threadRootUri] ?? [];
}

export function setLocallyHiddenPostUris(threadRootUri: string, uris: string[]) {
  const m = loadJSON<Record<string, string[]>>('thread_hidden_subtrees', {});
  m[threadRootUri] = uris;
  saveJSON('thread_hidden_subtrees', m);
}

export function addLocallyHiddenSubtree(threadRootUri: string, uris: string[]) {
  const cur = new Set(getLocallyHiddenPostUris(threadRootUri));
  for (const u of uris) cur.add(u);
  setLocallyHiddenPostUris(threadRootUri, [...cur]);
}

const HIDE_REASONS_KEY = 'thread_hidden_reasons';

export function getLocalHideReasons(threadRootUri: string): Record<string, string> {
  const m = loadJSON<Record<string, Record<string, string>>>(HIDE_REASONS_KEY, {});
  return m[threadRootUri] ?? {};
}

export function setLocalHideReason(threadRootUri: string, postUri: string, reason: string) {
  const m = loadJSON<Record<string, Record<string, string>>>(HIDE_REASONS_KEY, {});
  const inner = { ...(m[threadRootUri] ?? {}) };
  inner[postUri] = reason;
  m[threadRootUri] = inner;
  saveJSON(HIDE_REASONS_KEY, m);
}

export function removeLocalHideReason(threadRootUri: string, postUri: string) {
  const m = loadJSON<Record<string, Record<string, string>>>(HIDE_REASONS_KEY, {});
  const inner = { ...(m[threadRootUri] ?? {}) };
  delete inner[postUri];
  m[threadRootUri] = inner;
  saveJSON(HIDE_REASONS_KEY, m);
}

export function clearLocalHideReasonsForThread(threadRootUri: string) {
  const m = loadJSON<Record<string, Record<string, string>>>(HIDE_REASONS_KEY, {});
  delete m[threadRootUri];
  saveJSON(HIDE_REASONS_KEY, m);
}

export function clearLocallyHiddenForThread(threadRootUri: string) {
  setLocallyHiddenPostUris(threadRootUri, []);
  clearLocalHideReasonsForThread(threadRootUri);
}

const SUBSCRIBED_THREADS_KEY = 'subscribed_thread_roots';

let cachedRepoSubscribedThreads: string[] | null = null;
let subscribedRepoSyncPromise: Promise<string[]> | null = null;

async function loadSubscribedThreadsFromRepo(): Promise<string[]> {
  if (subscribedRepoSyncPromise) return subscribedRepoSyncPromise;
  subscribedRepoSyncPromise = getSubscribedThreadsFromRepo();
  try {
    const result = await subscribedRepoSyncPromise;
    cachedRepoSubscribedThreads = result;
    return result;
  } finally {
    subscribedRepoSyncPromise = null;
  }
}

export async function syncSubscribedThreadsFromRepo(): Promise<void> {
  try {
    const repoSubscribed = await loadSubscribedThreadsFromRepo();
    if (repoSubscribed.length > 0) {
      cachedRepoSubscribedThreads = repoSubscribed;
      saveJSON(SUBSCRIBED_THREADS_KEY, repoSubscribed);
    }
  } catch {
    // Sync failed, use localStorage
  }
}

export function getSubscribedThreadRoots(): string[] {
  // If we have cached repo data, use it
  if (cachedRepoSubscribedThreads) {
    return cachedRepoSubscribedThreads;
  }
  // Otherwise fall back to localStorage
  return loadJSON<string[]>(SUBSCRIBED_THREADS_KEY, []);
}

export function isThreadSubscribed(rootUri: string): boolean {
  return getSubscribedThreadRoots().includes(rootUri);
}

/** @returns new subscribed state */
export async function toggleSubscribedThreadRoot(rootUri: string): Promise<boolean> {
  const cur = getSubscribedThreadRoots();
  const i = cur.indexOf(rootUri);
  if (i >= 0) {
    cur.splice(i, 1);
  } else {
    cur.push(rootUri);
  }

  // Update localStorage immediately
  saveJSON(SUBSCRIBED_THREADS_KEY, cur);

  // Update cache
  cachedRepoSubscribedThreads = cur;

  // Sync to repo in background
  try {
    await saveSubscribedThreadsToRepo(cur);
  } catch {
    // Sync failed, localStorage has the data
  }

  return i < 0;
}

const COMMUNITY_LAST_VISIT_KEY = 'community_last_left_at';

export function getCommunityLastLeftAt(tag: string): string | null {
  const m = loadJSON<Record<string, string>>(COMMUNITY_LAST_VISIT_KEY, {});
  return m[tag] ?? null;
}

/** Call when the user leaves a community list (unmount). */
export function touchCommunityLastLeftAt(tag: string) {
  const m = loadJSON<Record<string, string>>(COMMUNITY_LAST_VISIT_KEY, {});
  m[tag] = new Date().toISOString();
  saveJSON(COMMUNITY_LAST_VISIT_KEY, m);
}

export interface ComposerDraftPayload {
  text: string;
  threadTitle?: string;
  updatedAt?: number;
}

export function getComposerDraft(draftKey: string): ComposerDraftPayload | null {
  const m = loadJSON<Record<string, ComposerDraftPayload>>('composer_drafts', {});
  const d = m[draftKey];
  if (!d || typeof d.text !== 'string') return null;
  return d;
}

export function setComposerDraft(draftKey: string, payload: ComposerDraftPayload) {
  const m = loadJSON<Record<string, ComposerDraftPayload>>('composer_drafts', {});
  m[draftKey] = { ...payload, updatedAt: Date.now() };
  saveJSON('composer_drafts', m);
}

export function clearComposerDraft(draftKey: string) {
  const m = loadJSON<Record<string, ComposerDraftPayload>>('composer_drafts', {});
  delete m[draftKey];
  saveJSON('composer_drafts', m);
}

export interface ComposerDraftListItem {
  key: string;
  text: string;
  threadTitle?: string;
  updatedAt: number;
}

/** Non-empty drafts for recovery / drafts page. */
export function listComposerDrafts(): ComposerDraftListItem[] {
  const m = loadJSON<Record<string, ComposerDraftPayload>>('composer_drafts', {});
  const out: ComposerDraftListItem[] = [];
  for (const [key, d] of Object.entries(m)) {
    if (!d || typeof d.text !== 'string') continue;
    const t = d.text.trim();
    const title = d.threadTitle?.trim() ?? '';
    if (t.length === 0 && title.length === 0) continue;
    out.push({
      key,
      text: d.text,
      threadTitle: d.threadTitle,
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

/** Failed post payloads for retry (FIFO) */
export interface OutboxPostPayload {
  id: string;
  did: string;
  text: string;
  reply?: { root: StrongRef; parent: StrongRef };
  facets?: Facet[];
  embed?: unknown;
  createdAt: string;
  retryCount?: number;
}

const OUTBOX_KEY = 'post_outbox';
const OUTBOX_LOCK_KEY = 'post_outbox_lock';
const LOCK_TIMEOUT_MS = 5000;

/**
 * Simple mutex for outbox operations across tabs.
 * Uses a timestamp-based lock that expires after LOCK_TIMEOUT_MS.
 */
function acquireOutboxLock(): boolean {
  try {
    const now = Date.now();
    const lockData = localStorage.getItem(key(OUTBOX_LOCK_KEY));
    if (lockData) {
      const lock = JSON.parse(lockData) as { timestamp: number; tabId: string };
      // If lock is stale, we can take it
      if (now - lock.timestamp > LOCK_TIMEOUT_MS) {
        localStorage.setItem(key(OUTBOX_LOCK_KEY), JSON.stringify({ timestamp: now, tabId: getTabId() }));
        return true;
      }
      // Lock is held by another tab
      return false;
    }
    localStorage.setItem(key(OUTBOX_LOCK_KEY), JSON.stringify({ timestamp: now, tabId: getTabId() }));
    return true;
  } catch {
    return false;
  }
}

function releaseOutboxLock() {
  try {
    const lockData = localStorage.getItem(key(OUTBOX_LOCK_KEY));
    if (lockData) {
      const lock = JSON.parse(lockData) as { timestamp: number; tabId: string };
      // Only release if we hold the lock
      if (lock.tabId === getTabId()) {
        localStorage.removeItem(key(OUTBOX_LOCK_KEY));
      }
    }
  } catch {
    // Ignore release errors
  }
}

let tabId: string | null = null;
function getTabId(): string {
  if (!tabId) {
    tabId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
  return tabId;
}

/**
 * Atomic outbox operation with locking.
 * Retries up to 3 times if lock is contested.
 */
async function withOutboxLock<T>(operation: (outbox: OutboxPostPayload[]) => T): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (acquireOutboxLock()) {
      try {
        const outbox = getOutbox();
        const result = operation(outbox);
        return result;
      } finally {
        releaseOutboxLock();
      }
    }
    // Wait a bit before retry
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
  }
  return null;
}

export function getOutbox(): OutboxPostPayload[] {
  return loadJSON<OutboxPostPayload[]>(OUTBOX_KEY, []);
}

export async function enqueueOutbox(item: OutboxPostPayload): Promise<boolean> {
  const result = await withOutboxLock((outbox) => {
    outbox.push(item);
    return saveJSON(OUTBOX_KEY, outbox);
  });
  return result ?? false;
}

export async function dequeueOutbox(id: string): Promise<boolean> {
  const result = await withOutboxLock((outbox) => {
    const filtered = outbox.filter(x => x.id !== id);
    return saveJSON(OUTBOX_KEY, filtered);
  });
  return result ?? false;
}

export async function updateOutboxItem(id: string, updates: Partial<OutboxPostPayload>): Promise<boolean> {
  const result = await withOutboxLock((outbox) => {
    const index = outbox.findIndex(x => x.id === id);
    if (index === -1) return false;
    outbox[index] = { ...outbox[index], ...updates };
    return saveJSON(OUTBOX_KEY, outbox);
  });
  return result ?? false;
}

/** Clean up lock on page unload */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    releaseOutboxLock();
  });
}
