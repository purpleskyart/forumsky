import type { CommunityThreadSort } from './thread-sort';

const STORAGE_PREFIX = 'forumsky_';

function getKey(key: string) { return STORAGE_PREFIX + key; }

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(getKey(key));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown) {
  localStorage.setItem(getKey(key), JSON.stringify(value));
}

/** Reserved: “people you follow” timeline (not a hashtag). */
export const FOLLOWED_COMMUNITY_TAG = '_followed';

export interface CommunityConfig {
  tag: string;
  name: string;
  description: string;
  category?: string;
}

export const FOLLOWED_COMMUNITY: CommunityConfig = {
  tag: FOLLOWED_COMMUNITY_TAG,
  name: 'Followed users',
  description: 'Posts from accounts you follow on Bluesky',
  category: 'Following',
};

const DEFAULT_COMMUNITIES: CommunityConfig[] = [
  { tag: 'news', name: 'News', description: 'Current events and world news', category: 'General' },
  { tag: 'technology', name: 'Technology', description: 'Tech discussion, programming, and gadgets', category: 'General' },
  { tag: 'gaming', name: 'Gaming', description: 'Video games, board games, and gaming culture', category: 'General' },
  { tag: 'anime', name: 'Anime & Manga', description: 'Japanese animation and comics discussion', category: 'General' },
  { tag: 'music', name: 'Music', description: 'Share and discuss music of all genres', category: 'Media' },
  { tag: 'movies', name: 'Movies & TV', description: 'Film and television discussion', category: 'Media' },
  { tag: 'art', name: 'Creative', description: 'Share your art, writing, and creative works', category: 'Creative' },
  { tag: 'meta', name: 'Meta', description: 'Discussion about ForumSky and Bluesky', category: 'Meta' },
  { tag: 'random', name: 'The Lounge', description: 'Off-topic chat and casual conversation', category: 'General' },
  { tag: 'science', name: 'Science', description: 'Scientific discoveries and discussions', category: 'Serious' },
  { tag: 'politics', name: 'Politics', description: 'Political discussion and debate', category: 'Serious' },
  { tag: 'books', name: 'Books', description: 'Literature and reading recommendations', category: 'Media' },
];

export function getCommunities(): CommunityConfig[] {
  return loadJSON<CommunityConfig[]>('communities', DEFAULT_COMMUNITIES);
}

export function setCommunities(communities: CommunityConfig[]) {
  saveJSON('communities', communities);
}

export function resetCommunities() {
  saveJSON('communities', DEFAULT_COMMUNITIES);
}

export function addCommunity(community: CommunityConfig) {
  const t = community.tag.trim();
  if (t === FOLLOWED_COMMUNITY_TAG || t.startsWith('_')) return;
  const current = getCommunities();
  if (!current.find(c => c.tag === community.tag)) {
    current.push(community);
    setCommunities(current);
  }
}

export function getCommunityThreadSort(tag: string): CommunityThreadSort {
  return loadJSON<CommunityThreadSort>(`community_sort_${tag}`, 'recent');
}

export function setCommunityThreadSort(tag: string, sort: CommunityThreadSort) {
  saveJSON(`community_sort_${tag}`, sort);
}

export function getCommunityHideReadThreads(tag: string): boolean {
  return loadJSON<boolean>(`community_hideread_${tag}`, false);
}

export function setCommunityHideReadThreads(tag: string, value: boolean) {
  saveJSON(`community_hideread_${tag}`, value);
}

export function removeCommunity(tag: string) {
  setCommunities(getCommunities().filter(c => c.tag !== tag));
}

// Pinned communities shown on homepage sidebar
export function getPinnedCommunities(): string[] {
  return loadJSON<string[]>('pinned_communities', []);
}

export function togglePinnedCommunity(tag: string) {
  const pinned = getPinnedCommunities();
  const idx = pinned.indexOf(tag);
  if (idx >= 0) {
    pinned.splice(idx, 1);
  } else {
    pinned.push(tag);
  }
  saveJSON('pinned_communities', pinned);
}

// Hidden threads
export function getHiddenThreads(): string[] {
  return loadJSON<string[]>('hidden_threads', []);
}

export function hideThread(uri: string) {
  const hidden = getHiddenThreads();
  if (!hidden.includes(uri)) {
    hidden.push(uri);
    saveJSON('hidden_threads', hidden);
  }
}

export function unhideThread(uri: string) {
  saveJSON('hidden_threads', getHiddenThreads().filter(u => u !== uri));
}

export function isThreadHidden(uri: string): boolean {
  return getHiddenThreads().includes(uri);
}

/** How to show posts labeled as adult / sexual / etc. */
export type NsfwMediaMode = 'show' | 'blur' | 'hide';

export function getNsfwMediaMode(): NsfwMediaMode {
  const v = loadJSON<string>('nsfw_media_mode', 'blur');
  if (v === 'show' || v === 'blur' || v === 'hide') return v;
  return 'blur';
}

export function setNsfwMediaMode(mode: NsfwMediaMode) {
  saveJSON('nsfw_media_mode', mode);
}

// Pinned threads per community
export function getPinnedThreads(tag: string): string[] {
  return loadJSON<string[]>(`pinned_threads_${tag}`, []);
}

export function togglePinnedThread(tag: string, uri: string) {
  const pinned = getPinnedThreads(tag);
  const idx = pinned.indexOf(uri);
  if (idx >= 0) {
    pinned.splice(idx, 1);
  } else {
    pinned.push(uri);
  }
  saveJSON(`pinned_threads_${tag}`, pinned);
}

export function isThreadPinned(tag: string, uri: string): boolean {
  return getPinnedThreads(tag).includes(uri);
}

// --- Home / following feed: timeline + custom feeds with blend weights ---

export const TIMELINE_BLEND_SOURCE_ID = '__timeline__';

export interface FollowingBlendSource {
  id: string;
  kind: 'timeline' | 'custom';
  /** `at://…/app.bsky.feed.generator/…` when kind === 'custom' */
  feedUri?: string;
  label: string;
  enabled: boolean;
  /** Relative weight (1–200); share ≈ weight / sum(enabled weights). */
  weight: number;
}

const DEFAULT_TIMELINE_BLEND: FollowingBlendSource = {
  id: TIMELINE_BLEND_SOURCE_ID,
  kind: 'timeline',
  label: 'Following',
  enabled: true,
  weight: 100,
};

function clampBlendWeight(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.round(n)));
}

function normalizeStoredBlend(raw: FollowingBlendSource[]): FollowingBlendSource[] {
  const timelineRow = raw.find(
    s => s.id === TIMELINE_BLEND_SOURCE_ID && s.kind === 'timeline',
  );
  const timeline: FollowingBlendSource = timelineRow
    ? {
        ...DEFAULT_TIMELINE_BLEND,
        enabled: Boolean(timelineRow.enabled),
        weight: clampBlendWeight(timelineRow.weight),
      }
    : { ...DEFAULT_TIMELINE_BLEND };

  const customs = raw
    .filter(
      (s): s is FollowingBlendSource =>
        s.kind === 'custom' &&
        typeof s.feedUri === 'string' &&
        /^at:\/\/[^/]+\/app\.bsky\.feed\.generator\/[^/]+$/.test(s.feedUri),
    )
    .map(s => ({
      id: typeof s.id === 'string' && s.id ? s.id : crypto.randomUUID(),
      kind: 'custom' as const,
      feedUri: s.feedUri!,
      label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : 'Custom feed',
      enabled: Boolean(s.enabled),
      weight: clampBlendWeight(s.weight),
    }));

  return [timeline, ...customs];
}

export function getFollowingFeedBlend(): FollowingBlendSource[] {
  const raw = loadJSON<FollowingBlendSource[]>('following_feed_blend', []);
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ ...DEFAULT_TIMELINE_BLEND }];
  }
  return normalizeStoredBlend(raw);
}

export function setFollowingFeedBlend(sources: FollowingBlendSource[]) {
  saveJSON('following_feed_blend', normalizeStoredBlend(sources));
}
