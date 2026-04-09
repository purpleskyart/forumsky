import type { StrongRef, Facet } from '@/api/types';

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

function saveJSON(k: string, v: unknown) {
  try {
    localStorage.setItem(key(k), JSON.stringify(v));
  } catch {
    /* quota / private mode */
  }
}

/** Root thread URIs the user bookmarked */
export function getSavedThreadRootUris(): string[] {
  return loadJSON<string[]>('saved_threads', []);
}

export function isThreadSaved(rootUri: string): boolean {
  return getSavedThreadRootUris().includes(rootUri);
}

export function toggleSavedThread(rootUri: string): boolean {
  const cur = getSavedThreadRootUris();
  const i = cur.indexOf(rootUri);
  if (i >= 0) {
    cur.splice(i, 1);
    saveJSON('saved_threads', cur);
    return false;
  }
  cur.push(rootUri);
  saveJSON('saved_threads', cur);
  return true;
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
  const leg = loadJSON<Record<string, string>>(THREAD_READ_LEGACY, {});
  leg[threadRootUri] = postUri;
  saveJSON(THREAD_READ_LEGACY, leg);
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

import { getSubscribedThreadsFromRepo, saveSubscribedThreadsToRepo } from '@/api/actor';

const SUBSCRIBED_THREADS_KEY = 'subscribed_thread_roots';

let cachedRepoSubscribedThreads: string[] | null = null;
let subscribedRepoSyncPromise: Promise<string[]> | null = null;

async function loadSubscribedThreadsFromRepo(): Promise<string[]> {
  if (subscribedRepoSyncPromise) return subscribedRepoSyncPromise;
  subscribedRepoSyncPromise = getSubscribedThreadsFromRepo();
  const result = await subscribedRepoSyncPromise;
  cachedRepoSubscribedThreads = result;
  subscribedRepoSyncPromise = null;
  return result;
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
}

const OUTBOX_KEY = 'post_outbox';

export function getOutbox(): OutboxPostPayload[] {
  return loadJSON<OutboxPostPayload[]>(OUTBOX_KEY, []);
}

export function enqueueOutbox(item: OutboxPostPayload) {
  const q = getOutbox();
  q.push(item);
  saveJSON(OUTBOX_KEY, q);
}

export function dequeueOutbox(id: string) {
  saveJSON(
    OUTBOX_KEY,
    getOutbox().filter(x => x.id !== id),
  );
}
