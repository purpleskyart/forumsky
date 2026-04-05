import type {
  Facet,
  PostView,
  PostRecord,
  ProfileView,
  ImageView,
  ExternalView,
  EmbedView,
} from '@/api/types';
import { hrefForAppPath } from '@/lib/app-base-path';
import { communityUrl } from '@/lib/router';
import { h, Fragment } from 'preact';
import type { VNode, ComponentChild } from 'preact';

interface RichSegment {
  text: string;
  type: 'text' | 'mention' | 'link' | 'tag';
  href?: string;
  did?: string;
  tag?: string;
}

/**
 * Parse post text + facets into renderable segments.
 */
export function parseRichText(text: string, facets?: Facet[]): RichSegment[] {
  if (!facets || facets.length === 0) {
    return [{ text, type: 'text' }];
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);

  // Sort facets by byte start
  const sorted = [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart);
  const segments: RichSegment[] = [];
  let cursor = 0;

  for (const facet of sorted) {
    const { byteStart, byteEnd } = facet.index;
    if (byteStart < cursor) continue;

    // Text before this facet
    if (byteStart > cursor) {
      segments.push({
        text: decoder.decode(bytes.slice(cursor, byteStart)),
        type: 'text',
      });
    }

    const facetText = decoder.decode(bytes.slice(byteStart, byteEnd));
    const feature = facet.features[0];

    if (feature?.$type === 'app.bsky.richtext.facet#mention') {
      segments.push({ text: facetText, type: 'mention', did: feature.did });
    } else if (feature?.$type === 'app.bsky.richtext.facet#link') {
      segments.push({ text: facetText, type: 'link', href: feature.uri });
    } else if (feature?.$type === 'app.bsky.richtext.facet#tag') {
      segments.push({ text: facetText, type: 'tag', tag: feature.tag });
    } else {
      segments.push({ text: facetText, type: 'text' });
    }

    cursor = byteEnd;
  }

  if (cursor < bytes.length) {
    segments.push({
      text: decoder.decode(bytes.slice(cursor)),
      type: 'text',
    });
  }

  return segments;
}

/**
 * Render rich text segments to Preact VNodes.
 */
export function renderRichText(text: string, facets?: Facet[]): VNode {
  const segments = parseRichText(text, facets);
  const children: ComponentChild[] = [];

  for (const seg of segments) {
    if (seg.type === 'mention') {
      children.push(h('a', { href: hrefForAppPath(`/u/${seg.did}`), class: 'mention' } as any, seg.text));
    } else if (seg.type === 'link') {
      children.push(h('a', { href: seg.href, target: '_blank', rel: 'noopener noreferrer' } as any, seg.text));
    } else if (seg.type === 'tag') {
      children.push(h('a', { href: hrefForAppPath(communityUrl(seg.tag!)), class: 'hashtag' } as any, seg.text));
    } else {
      children.push(seg.text);
    }
  }

  return h(Fragment, null, ...children);
}

function splitParagraphsWithByteRanges(fullText: string): { para: string; startByte: number; endByte: number }[] {
  const encoder = new TextEncoder();
  const result: { para: string; startByte: number; endByte: number }[] = [];
  const re = /\n{2,}/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText)) !== null) {
    const para = fullText.slice(lastIndex, m.index);
    const startByte = encoder.encode(fullText.slice(0, lastIndex)).length;
    const endByte = startByte + encoder.encode(para).length;
    result.push({ para, startByte, endByte });
    lastIndex = re.lastIndex;
  }
  const para = fullText.slice(lastIndex);
  const startByte = encoder.encode(fullText.slice(0, lastIndex)).length;
  const endByte = startByte + encoder.encode(para).length;
  result.push({ para, startByte, endByte });
  return result;
}

/** Facets whose range lies fully inside [rangeStart, rangeEnd), rebased to start at 0. */
function facetsInByteRange(
  facets: Facet[] | undefined,
  rangeStart: number,
  rangeEnd: number,
): Facet[] {
  if (!facets?.length) return [];
  return facets
    .filter(f => f.index.byteStart >= rangeStart && f.index.byteEnd <= rangeEnd)
    .map(f => ({
      ...f,
      index: {
        byteStart: f.index.byteStart - rangeStart,
        byteEnd: f.index.byteEnd - rangeStart,
      },
    }));
}

/**
 * Render post text with paragraph splitting and rich-text facets (links, mentions, tags).
 */
export function renderPostContent(text: string, facets?: Facet[]): ComponentChild[] {
  const encoder = new TextEncoder();
  const paragraphs = splitParagraphsWithByteRanges(text);
  return paragraphs.map(({ para, startByte: pStart }, i) => {
    const lines = para.split('\n');
    const lineNodes: ComponentChild[] = [];
    let charOffsetInPara = 0;
    for (let j = 0; j < lines.length; j++) {
      if (j > 0) lineNodes.push(h('br', null));
      const line = lines[j];
      const lineStartInParaBytes = encoder.encode(para.slice(0, charOffsetInPara)).length;
      const lineEndInParaBytes = lineStartInParaBytes + encoder.encode(line).length;
      const absLineStart = pStart + lineStartInParaBytes;
      const absLineEnd = pStart + lineEndInParaBytes;
      const lineFacets = facetsInByteRange(facets, absLineStart, absLineEnd);
      lineNodes.push(renderRichText(line, lineFacets));
      charOffsetInPara += line.length;
      if (j < lines.length - 1) charOffsetInPara += 1;
    }
    return h('p', { key: i } as any, ...lineNodes);
  });
}

/**
 * Extract images from a post embed.
 */
export function getPostImages(post: PostView): ImageView[] {
  if (!post.embed) return [];
  if (post.embed.$type === 'app.bsky.embed.images#view') {
    return (post.embed.images as ImageView[]) || [];
  }
  if (post.embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    const media = (post.embed as { media?: { images?: ImageView[] } }).media;
    if (media?.images) return media.images;
  }
  return [];
}

/** True when a URL likely points to a GIF (path ends in .gif or known CDN patterns). */
export function isGifUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (/\.gif($|[?#])/i.test(u.pathname)) return true;
    const fmt = u.searchParams.get('format');
    if (fmt && fmt.toLowerCase() === 'gif') return true;
  } catch {
    if (/\.gif($|[?#])/i.test(url)) return true;
  }
  return false;
}

export function isGifImage(img: ImageView): boolean {
  if (img.mimeType === 'image/gif') return true;
  return isGifUrl(img.fullsize) || isGifUrl(img.thumb);
}

/** External link preview that should look like inline media, not a rich card (e.g. GIF hosts). */
export function isNativeExternalEmbed(ext: ExternalView): boolean {
  return isGifUrl(ext.thumb) || isGifUrl(ext.uri);
}

/** Thumb vs animated URL for external GIF embeds (static preview + .gif, or single GIF URL). */
export function getExternalGifPlaybackSources(ext: ExternalView): { thumb: string; fullsize: string } | null {
  const t = ext.thumb;
  const u = ext.uri;
  if (t && isGifUrl(t)) return { thumb: t, fullsize: t };
  if (t && u && isGifUrl(u) && !isGifUrl(t)) return { thumb: t, fullsize: u };
  if (u && isGifUrl(u)) return { thumb: u, fullsize: u };
  if (t) return { thumb: t, fullsize: t };
  return null;
}

/**
 * Extract external link embed from a post.
 */
export function getPostExternal(post: PostView): ExternalView | null {
  if (!post.embed) return null;
  if (post.embed.$type === 'app.bsky.embed.external#view') {
    return post.embed.external as ExternalView || null;
  }
  return null;
}

/** Resolved video attachment from `app.bsky.embed.video#view`. */
export interface QuotedVideoEmbed {
  playlist: string;
  thumbnail?: string;
  alt?: string;
}

export interface QuotedAggregatedMedia {
  images: ImageView[];
  external: ExternalView | null;
  videos: QuotedVideoEmbed[];
}

function pushVideoFromView(v: EmbedView, into: QuotedVideoEmbed[]): void {
  if (v.$type !== 'app.bsky.embed.video#view') return;
  const playlist = (v as { playlist?: string }).playlist;
  if (typeof playlist !== 'string' || playlist.length === 0) return;
  const thumbnail = (v as { thumbnail?: string }).thumbnail;
  const alt = (v as { alt?: string }).alt;
  into.push({
    playlist,
    thumbnail: typeof thumbnail === 'string' ? thumbnail : undefined,
    alt: typeof alt === 'string' ? alt : undefined,
  });
}

/**
 * Collect images, link cards, and video from one or more embed #view objects
 * (e.g. every entry in a quote viewRecord’s `embeds` array).
 */
export function aggregateEmbedViewsMedia(views: EmbedView[]): QuotedAggregatedMedia {
  const images: ImageView[] = [];
  let external: ExternalView | null = null;
  const videos: QuotedVideoEmbed[] = [];

  for (const raw of views) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as EmbedView;
    const t = v.$type;

    if (t === 'app.bsky.embed.images#view') {
      images.push(...((v.images as ImageView[]) || []));
      continue;
    }
    if (t === 'app.bsky.embed.external#view' && v.external) {
      if (!external) external = v.external as ExternalView;
      continue;
    }
    if (t === 'app.bsky.embed.video#view') {
      pushVideoFromView(v, videos);
      continue;
    }
    if (t === 'app.bsky.embed.recordWithMedia#view') {
      const media = (v as { media?: EmbedView }).media;
      if (media && typeof media === 'object') {
        const inner = aggregateEmbedViewsMedia([media as EmbedView]);
        images.push(...inner.images);
        if (!external && inner.external) external = inner.external;
        videos.push(...inner.videos);
      }
      continue;
    }
  }

  return { images, external, videos };
}

/** Media to show for a quoted post (merges `quotedSourceEmbedViews` or single `embed`). */
export function getQuotedPostAggregatedMedia(post: PostView): QuotedAggregatedMedia {
  const list =
    post.quotedSourceEmbedViews && post.quotedSourceEmbedViews.length > 0
      ? post.quotedSourceEmbedViews
      : post.embed
        ? [post.embed]
        : [];
  return aggregateEmbedViewsMedia(list);
}

/** Result of parsing `app.bsky.embed.record#view` / `recordWithMedia#view` on a post. */
export type ParsedEmbeddedRecord =
  | { kind: 'post'; post: PostView }
  | { kind: 'notFound'; uri: string }
  | { kind: 'blocked'; uri: string }
  | { kind: 'detached'; uri: string }
  | { kind: 'unsupported' };

function profileFromEmbedAuthor(author: unknown): ProfileView | null {
  if (!author || typeof author !== 'object') return null;
  const a = author as { did?: string; handle?: string; displayName?: string; avatar?: string };
  if (!a.did) return null;
  return {
    did: a.did,
    handle: typeof a.handle === 'string' && a.handle.length > 0 ? a.handle : a.did,
    displayName: a.displayName,
    avatar: a.avatar,
  };
}

/**
 * Turn `app.bsky.embed.record#viewRecord` into a {@link PostView} so existing
 * image / external / rich-text helpers can render the quoted post.
 */
function viewRecordToPostView(viewRecord: Record<string, unknown>): PostView | null {
  const uri = viewRecord.uri;
  const cid = viewRecord.cid;
  const value = viewRecord.value;
  const indexedAt = viewRecord.indexedAt;
  if (typeof uri !== 'string' || typeof cid !== 'string') return null;
  const author = profileFromEmbedAuthor(viewRecord.author);
  if (!author) return null;
  if (!value || typeof value !== 'object') return null;
  const vt = (value as { $type?: string }).$type;
  if (vt !== 'app.bsky.feed.post') return null;

  const embeds = viewRecord.embeds;
  let embed: EmbedView | undefined;
  let quotedSourceEmbedViews: EmbedView[] | undefined;
  if (Array.isArray(embeds) && embeds.length > 0) {
    quotedSourceEmbedViews = embeds.filter(e => e && typeof e === 'object') as EmbedView[];
    embed = quotedSourceEmbedViews[0];
  }

  return {
    uri,
    cid,
    author,
    record: value as PostRecord,
    indexedAt: typeof indexedAt === 'string' ? indexedAt : '',
    embed,
    quotedSourceEmbedViews,
    replyCount: typeof viewRecord.replyCount === 'number' ? viewRecord.replyCount : undefined,
    repostCount: typeof viewRecord.repostCount === 'number' ? viewRecord.repostCount : undefined,
    likeCount: typeof viewRecord.likeCount === 'number' ? viewRecord.likeCount : undefined,
  };
}

function parseEmbeddedRecordUnion(unionRec: unknown): ParsedEmbeddedRecord | null {
  if (!unionRec || typeof unionRec !== 'object') return null;
  const u = unionRec as Record<string, unknown>;
  const tt = u.$type as string | undefined;
  if (tt === 'app.bsky.embed.record#viewRecord') {
    const pv = viewRecordToPostView(u);
    return pv ? { kind: 'post', post: pv } : null;
  }
  if (tt === 'app.bsky.embed.record#viewNotFound' && typeof u.uri === 'string') {
    return { kind: 'notFound', uri: u.uri };
  }
  if (tt === 'app.bsky.embed.record#viewBlocked' && typeof u.uri === 'string') {
    return { kind: 'blocked', uri: u.uri };
  }
  if (tt === 'app.bsky.embed.record#viewDetached' && typeof u.uri === 'string') {
    return { kind: 'detached', uri: u.uri };
  }
  // Full postView-shaped object (defensive / future API shapes)
  const maybePost = unionRec as PostView;
  if (
    maybePost.record &&
    typeof maybePost.record === 'object' &&
    maybePost.record.$type === 'app.bsky.feed.post' &&
    typeof maybePost.uri === 'string' &&
    typeof maybePost.cid === 'string' &&
    maybePost.author &&
    typeof maybePost.author === 'object' &&
    typeof (maybePost.author as ProfileView).did === 'string'
  ) {
    const a = maybePost.author as ProfileView;
    const author: ProfileView = {
      ...a,
      handle: a.handle || a.did,
    };
    return { kind: 'post', post: { ...maybePost, author } };
  }
  if (tt && tt.startsWith('app.bsky.')) return { kind: 'unsupported' };
  return null;
}

/**
 * AppView often nests the quoted post as:
 * - `record#view.record` → viewRecord, or
 * - `recordWithMedia#view.record` → `{ record: viewRecord }` (no `$type` on the wrapper).
 * Normalize to the inner `app.bsky.embed.record#viewRecord` object for {@link parseEmbeddedRecordUnion}.
 */
function unwrapEmbeddedRecordViewRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const o = raw as Record<string, unknown>;
  if (o.$type === 'app.bsky.embed.record#view' && o.record != null) {
    return o.record;
  }
  const nested = o.record;
  if (nested && typeof nested === 'object') {
    const inner = nested as Record<string, unknown>;
    if (inner.$type === 'app.bsky.embed.record#viewRecord') {
      return nested;
    }
    if (inner.$type === 'app.bsky.embed.record#view' && inner.record != null) {
      return inner.record;
    }
  }
  return raw;
}

/** Parse record / recordWithMedia embed on a single post segment. */
export function parseEmbeddedRecordEmbed(post: PostView): ParsedEmbeddedRecord | null {
  const e = post.embed;
  if (!e) return null;
  const t = e.$type;
  if (t === 'app.bsky.embed.record#view') {
    return parseEmbeddedRecordUnion(unwrapEmbeddedRecordViewRecord(e.record));
  }
  if (t === 'app.bsky.embed.recordWithMedia#view') {
    return parseEmbeddedRecordUnion(unwrapEmbeddedRecordViewRecord((e as { record?: unknown }).record));
  }
  return null;
}

/** First quote / record embed across merged thread segments (self-thread). */
export function getQuotedEmbedFromSegments(segments: PostView[]): ParsedEmbeddedRecord | null {
  let unsupported: ParsedEmbeddedRecord | null = null;
  for (const seg of segments) {
    const p = parseEmbeddedRecordEmbed(seg);
    if (!p) continue;
    if (p.kind === 'unsupported') {
      unsupported = p;
      continue;
    }
    return p;
  }
  return unsupported;
}

export interface ThreadPreviewThumb {
  url: string;
  alt: string;
  extraCount: number;
}

/** First image or external link thumb for thread list / saved-thread previews. */
export function threadPreviewThumb(post: PostView): ThreadPreviewThumb | null {
  const images = getPostImages(post);
  if (images.length > 0) {
    const first = images[0];
    return {
      url: first.thumb || first.fullsize,
      alt: first.alt || 'Thread image',
      extraCount: images.length - 1,
    };
  }
  const ext = getPostExternal(post);
  if (ext?.thumb) {
    return { url: ext.thumb, alt: ext.title || 'Link preview', extraCount: 0 };
  }
  return null;
}

/**
 * Detect hashtag facets for new post text.
 * Scans for #hashtag patterns and creates facet objects.
 */
export function detectHashtags(text: string): Facet[] {
  const encoder = new TextEncoder();
  const facets: Facet[] = [];
  const regex = /#([a-zA-Z0-9_]+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const prefix = text.slice(0, match.index);
    const byteStart = encoder.encode(prefix).length;
    const byteEnd = byteStart + encoder.encode(match[0]).length;

    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: match[1] }],
    });
  }

  return facets;
}

function mergeFacetsByByteStart(a: Facet[], b: Facet[]): Facet[] {
  const map = new Map<number, Facet>();
  for (const f of a) map.set(f.index.byteStart, f);
  for (const f of b) map.set(f.index.byteStart, f);
  return [...map.values()].sort((x, y) => x.index.byteStart - y.index.byteStart);
}

/**
 * Build mention facets for @handle tokens that resolve via `getProfiles`.
 * Merged with hashtag facets (mentions win on same byte range).
 */
export async function detectMentionsInText(
  text: string,
  getProfiles: (handles: string[]) => Promise<ProfileView[]>,
): Promise<Facet[]> {
  const encoder = new TextEncoder();
  const regex = /@([a-zA-Z0-9._-]+)/g;
  const handles: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const h = match[1].toLowerCase();
    if (!handles.includes(h)) handles.push(h);
  }
  if (handles.length === 0) return [];

  let profiles: ProfileView[] = [];
  try {
    profiles = await getProfiles(handles);
  } catch {
    return [];
  }
  const didByHandle = new Map<string, string>();
  for (const p of profiles) {
    if (p.handle) didByHandle.set(p.handle.toLowerCase(), p.did);
  }

  const facets: Facet[] = [];
  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    const did = didByHandle.get(raw.toLowerCase());
    if (!did) continue;
    const prefix = text.slice(0, match.index);
    const byteStart = encoder.encode(prefix).length;
    const byteEnd = byteStart + encoder.encode(match[0]).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#mention', did }],
    });
  }
  return facets;
}

/** Combine hashtag detection with resolved @mention facets. */
export async function buildComposerFacets(
  text: string,
  getProfiles: (handles: string[]) => Promise<ProfileView[]>,
): Promise<Facet[]> {
  const tags = detectHashtags(text);
  const mentions = await detectMentionsInText(text, getProfiles);
  return mergeFacetsByByteStart(tags, mentions);
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/** Distinct http(s) URLs from post body and link facets (for cross-post discovery). */
export function extractExternalUrlsFromPost(post: PostView): string[] {
  const out: string[] = [];
  const text = post.record.text || '';
  let m: RegExpExecArray | null;
  const re = new RegExp(URL_IN_TEXT_RE);
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  for (const f of post.record.facets ?? []) {
    for (const feat of f.features ?? []) {
      if (feat.$type === 'app.bsky.richtext.facet#link' && typeof feat.uri === 'string') {
        if (/^https?:\/\//i.test(feat.uri)) out.push(feat.uri);
      }
    }
  }
  return [...new Set(out)];
}
