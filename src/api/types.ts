/** `app.bsky.actor.defs#viewerState` subset — present on profiles when fetched with a session. */
export interface ProfileViewerState {
  following?: string;
  followedBy?: string;
  muted?: boolean;
  blockedBy?: boolean;
  blocking?: string;
}

export interface ProfileView {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followsCount?: number;
  followersCount?: number;
  postsCount?: number;
  createdAt?: string;
  labels?: Label[];
  viewer?: ProfileViewerState;
}

export interface PostView {
  uri: string;
  cid: string;
  author: ProfileView;
  record: PostRecord;
  embed?: EmbedView;
  /**
   * When this {@link PostView} is synthesized from `app.bsky.embed.record#viewRecord`,
   * holds every resolved embed view from that record (not only the first).
   */
  quotedSourceEmbedViews?: EmbedView[];
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  indexedAt: string;
  labels?: Label[];
  viewer?: PostViewer;
}

export interface PostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  reply?: ReplyRef;
  facets?: Facet[];
  embed?: EmbedRecord;
  langs?: string[];
  tags?: string[];
}

export interface ReplyRef {
  root: StrongRef;
  parent: StrongRef;
}

export interface StrongRef {
  uri: string;
  cid: string;
}

/** Blob reference returned by `com.atproto.repo.uploadBlob` (used in image embeds). */
export interface AtprotoBlobRef {
  $type?: string;
  ref: { $link: string };
  mimeType: string;
  size: number;
}

export interface Facet {
  index: ByteSlice;
  features: FacetFeature[];
}

export interface ByteSlice {
  byteStart: number;
  byteEnd: number;
}

export type FacetFeature =
  | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string };

export interface EmbedRecord {
  $type: string;
  [key: string]: unknown;
}

export interface EmbedView {
  $type: string;
  images?: ImageView[];
  external?: ExternalView;
  record?: { record?: PostView; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ImageView {
  thumb: string;
  fullsize: string;
  alt: string;
  aspectRatio?: { width: number; height: number };
  /** Present on some API responses; use for GIF vs static image styling. */
  mimeType?: string;
}

export interface ExternalView {
  uri: string;
  title: string;
  description: string;
  thumb?: string;
}

export interface Label {
  val: string;
  src?: string;
  uri?: string;
  cts?: string;
}

export interface PostViewer {
  like?: string;
  repost?: string;
}

export interface ThreadViewPost {
  $type: 'app.bsky.feed.defs#threadViewPost';
  post: PostView;
  parent?: ThreadViewPost | NotFoundPost | BlockedPost;
  replies?: (ThreadViewPost | NotFoundPost | BlockedPost)[];
}

export interface NotFoundPost {
  $type: 'app.bsky.feed.defs#notFoundPost';
  uri: string;
  notFound: true;
}

export interface BlockedPost {
  $type: 'app.bsky.feed.defs#blockedPost';
  uri: string;
  blocked: true;
}

export interface FeedViewPost {
  post: PostView;
  reply?: {
    root: PostView;
    parent: PostView;
  };
  reason?: { $type: string; by?: ProfileView; indexedAt?: string };
}

/** Which Following mix row this item was fetched from (for list attribution). */
export interface FeedBlendSourceMeta {
  kind: 'timeline' | 'custom';
  /** Label from mix config (e.g. “Following”, feed display name). */
  label: string;
  /** Set when `kind === 'custom'` */
  feedUri?: string;
}

/** Thread root from a timeline/custom feed item, with optional `reason` (e.g. repost). */
export interface FeedRootItem {
  post: PostView;
  reason?: FeedViewPost['reason'];
  blendSource?: FeedBlendSourceMeta;
}

export interface SearchPostsResponse {
  cursor?: string;
  hitsTotal?: number;
  posts: PostView[];
}

export interface GetPostThreadResponse {
  thread: ThreadViewPost | NotFoundPost | BlockedPost;
}

export interface GetAuthorFeedResponse {
  cursor?: string;
  feed: FeedViewPost[];
}

export interface GetTimelineResponse {
  cursor?: string;
  feed: FeedViewPost[];
}

/** `app.bsky.feed.getFeed` — same shape as timeline. */
export interface GetFeedResponse {
  cursor?: string;
  feed: FeedViewPost[];
}

export interface FeedGeneratorView {
  uri: string;
  cid?: string;
  did?: string;
  creator?: ProfileView;
  displayName?: string;
  description?: string;
  avatar?: string;
  likeCount?: number;
  indexedAt?: string;
}

export interface GetFeedGeneratorResponse {
  view?: FeedGeneratorView;
  isOnline?: boolean;
  isValid?: boolean;
}

export interface GetProfileResponse extends ProfileView {}

export interface GetProfilesResponse {
  profiles: ProfileView[];
}

export interface CreateRecordResponse {
  uri: string;
  cid: string;
}

export interface DeleteRecordResponse {}

export function isThreadViewPost(v: unknown): v is ThreadViewPost {
  return !!v && typeof v === 'object' && '$type' in v &&
    (v as { $type: string }).$type === 'app.bsky.feed.defs#threadViewPost';
}

export interface OAuthSession {
  did: string;
  sub?: string;
  fetchHandler: (path: string, init: RequestInit) => Promise<Response>;
}
