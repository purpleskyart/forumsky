import { Fragment } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { Avatar } from '@/components/Avatar';
import { AuthorFlair } from '@/components/AuthorFlair';
import { prefetchThread } from '@/lib/thread-prefetch';
import {
  PostDownvoteButton,
  PostLikeButton,
  PostRepostButton,
  PostShareButton,
} from '@/components/PostSocialButtons';
import { QuotedPostEmbedCard } from '@/components/QuotedPostEmbedCard';
import { GifImage, GifImageFromEmbed } from '@/components/GifImage';
import { PostContentImage } from '@/components/PostContentImage';
import { HlsVideo } from '@/components/HlsVideo';
import { NsfwMediaWrap } from '@/components/NsfwMediaWrap';
import { parseAtUri } from '@/api/feed';
import type { FeedBlendSourceMeta, FeedViewPost, PostView, ProfileView } from '@/api/types';
import { repostAttributionFromReason } from '@/lib/feed-reason';
import {
  renderPostContent,
  getPostImages,
  getPostExternal,
  getQuotedPostAggregatedMedia,
  getQuotedEmbedFromSegments,
  isGifImage,
  isNativeExternalEmbed,
  getExternalGifPlaybackSources,
} from '@/lib/richtext';
import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, threadUrl, SPA_ANCHOR_SHIELD, spaNavigateClickStopRow } from '@/lib/router';
import { formatListDateTime, formatRelativeTime, t } from '@/lib/i18n';
import { toneIndexForHandle, formatProfileJoined, formatProfileStatCount } from '@/lib/user-display';
import { isLoggedIn, showAuthDialog } from '@/lib/store';
import { postHasNsfwLabels } from '@/lib/nsfw-labels';
import { showToast } from '@/lib/store';
import { PostSubscribeButton } from '@/components/PostSubscribeButton';

export interface FollowingFeedRowProps {
  post: PostView;
  onHide?: () => void;
  showUnreadReplies?: boolean;
  feedReason?: FeedViewPost['reason'];
  /** Reply context with parent post for displaying reply preview */
  replyContext?: FeedViewPost['reply'];
  /** Most recent activity timestamp (repost or reply) */
  lastActivity?: string;
  /** Individual who performed the last activity */
  lastActivityAuthor?: ProfileView;
  blendSource?: FeedBlendSourceMeta;
  downvoteRecordUri?: string;
  downvoteDisplayCount: number;
  downvoteBusy?: boolean;
  onDownvotePost: (uri: string, cid: string) => void | Promise<void>;
  /** Same avatar "+" follow control as thread roots (Following feed / homepage). */
  onAvatarFollow?: (authorDid: string) => void | Promise<void>;
  avatarFollowBusyDid?: string | null;
  followingAuthorDids?: Set<string> | null;
  viewerDid?: string;
}

/** Stop row background navigation when interacting with controls (not for `<a>`, which use {@link spaNavigateClickStopRow}). */
const stopNav = (e: MouseEvent) => e.stopPropagation();

export function FollowingFeedRow({
  post,
  onHide,
  showUnreadReplies,
  feedReason,
  replyContext,
  lastActivity,
  lastActivityAuthor,
  blendSource,
  downvoteRecordUri,
  downvoteDisplayCount,
  downvoteBusy,
  onDownvotePost,
  onAvatarFollow,
  avatarFollowBusyDid,
  followingAuthorDids,
  viewerDid,
}: FollowingFeedRowProps) {

  const repostBy = repostAttributionFromReason(feedReason);
  const customFeedLabel = blendSource?.kind === 'custom' ? blendSource.label : undefined;
  const parsed = parseAtUri(post.uri);
  const href = parsed ? threadUrl(post.author.handle || post.author.did, parsed.rkey) : '#';
  const threadPath = href !== '#' ? href : undefined;
  const handle = post.author.handle;
  const displayName = post.author.displayName || handle;
  const activityDate = lastActivity || post.indexedAt;
  const dateStr = formatListDateTime(activityDate);
  const relativeTimeStr = formatRelativeTime(activityDate);
  const replyCount = post.replyCount ?? 0;
  const tone = toneIndexForHandle(handle);

  const quotedEmbed = useMemo(() => getQuotedEmbedFromSegments([post]), [post]);
  const allImages = useMemo(() => getPostImages(post), [post]);
  const { videos: allVideos } = useMemo(() => getQuotedPostAggregatedMedia(post), [post]);
  const mediaCount = allImages.length + allVideos.length;
  const external = getPostExternal(post);
  const externalGifSrc =
    external && isNativeExternalEmbed(external) ? getExternalGifPlaybackSources(external) : null;
  const nsfwMedia = useMemo(() => postHasNsfwLabels(post), [post]);
  const nsfwLabels = useMemo(
    () => [...(post.labels ?? []), ...(post.author?.labels ?? [])],
    [post],
  );

  // Extract parent post media for reply preview
  const parentPost = replyContext?.parent;
  const parentImages = useMemo(() => parentPost ? getPostImages(parentPost) : [], [parentPost]);
  const { videos: parentVideos } = useMemo(() => parentPost ? getQuotedPostAggregatedMedia(parentPost) : { videos: [] }, [parentPost]);
  const parentMediaCount = parentImages.length + parentVideos.length;
  const parentExternal = parentPost ? getPostExternal(parentPost) : null;
  const parentExternalGifSrc =
    parentExternal && isNativeExternalEmbed(parentExternal) ? getExternalGifPlaybackSources(parentExternal) : null;
  const parentNsfwMedia = useMemo(() => parentPost ? postHasNsfwLabels(parentPost) : false, [parentPost]);
  const parentNsfwLabels = useMemo(
    () => parentPost ? [...(parentPost.labels ?? []), ...(parentPost.author?.labels ?? [])] : [],
    [parentPost],
  );

  const showAvatarFollowPlus = Boolean(
    onAvatarFollow &&
      viewerDid &&
      post.author.did !== viewerDid &&
      followingAuthorDids != null &&
      !followingAuthorDids.has(post.author.did),
  );
  const [showExactTime, setShowExactTime] = useState(false);

  const onRowClick = (e: MouseEvent) => {
    const el = e.target as HTMLElement | null;
    if (!el) return;
    if (el.closest('a, button, input, textarea, video, audio, img, [role="button"], [role="dialog"]'))
      return;
    if (href !== '#') navigate(href);
  };

  // Render parent post media nodes
  const parentMediaNodes = parentMediaCount > 0 ? (
    <Fragment>
      {parentImages.map((img, i) =>
        isGifImage(img) ? (
          <NsfwMediaWrap key={`parent-${i}`} isNsfw={parentNsfwMedia} labels={parentNsfwLabels}>
            <GifImageFromEmbed
              img={img}
              className="post-content-media post-content-media--gif"
            />
          </NsfwMediaWrap>
        ) : (
          <NsfwMediaWrap key={`parent-${i}`} isNsfw={parentNsfwMedia} labels={parentNsfwLabels}>
            <PostContentImage
              className="post-content-media"
              src={img.fullsize || img.thumb}
              alt={img.alt ?? ''}
              aspectRatio={img.aspectRatio}
              allImages={parentImages}
              currentIndex={i}
            />
          </NsfwMediaWrap>
        ),
      )}
      {parentVideos.map((vid, i) => (
        <NsfwMediaWrap key={`parent-vid-${vid.playlist}-${i}`} isNsfw={parentNsfwMedia} labels={parentNsfwLabels}>
          <HlsVideo
            playlist={vid.playlist}
            poster={vid.thumbnail}
            aspectRatio={vid.aspectRatio}
            className="post-content-media"
            aria-label={vid.alt || 'Video'}
          />
        </NsfwMediaWrap>
      ))}
    </Fragment>
  ) : null;

  const mediaNodes =
    mediaCount > 0 ? (
      <Fragment>
        {allImages.map((img, i) =>
          isGifImage(img) ? (
            <NsfwMediaWrap key={i} isNsfw={nsfwMedia} labels={nsfwLabels}>
              <GifImageFromEmbed
                img={img}
                className="post-content-media post-content-media--gif following-feed-row-media"
              />
            </NsfwMediaWrap>
          ) : (
            <NsfwMediaWrap key={i} isNsfw={nsfwMedia} labels={nsfwLabels}>
              <PostContentImage
                className="post-content-media following-feed-row-media"
                src={img.fullsize || img.thumb}
                alt={img.alt ?? ''}
                aspectRatio={img.aspectRatio}
                allImages={allImages}
                currentIndex={i}
              />
            </NsfwMediaWrap>
          ),
        )}
        {allVideos.map((vid, i) => (
          <NsfwMediaWrap key={`${vid.playlist}-${i}`} isNsfw={nsfwMedia} labels={nsfwLabels}>
            <HlsVideo
              playlist={vid.playlist}
              poster={vid.thumbnail}
              aspectRatio={vid.aspectRatio}
              className="post-content-media following-feed-row-media"
              aria-label={vid.alt || 'Video'}
            />
          </NsfwMediaWrap>
        ))}
      </Fragment>
    ) : null;

  return (
    <article
      class={`following-feed-row post-container username-tone-${tone}`}
      onClick={onRowClick}
      onMouseEnter={() => {
        if (threadPath) {
          void prefetchThread(post.uri);
        }
      }}
    >
      <div class="post-author-card">
        <Avatar
          src={post.author.avatar}
          alt={displayName}
          className="following-feed-row-profile-avatar"
          followPlus={
            showAvatarFollowPlus
              ? {
                  busy: avatarFollowBusyDid === post.author.did,
                  onFollow: () => void onAvatarFollow!(post.author.did),
                  title: `Follow @${handle}`,
                }
              : undefined
          }
        />
        <div class="post-author-meta">
          <div class="author-name">
            <a
              href={hrefForAppPath(`/u/${handle}`)}
              {...SPA_ANCHOR_SHIELD}
              onClick={spaNavigateClickStopRow(`/u/${handle}`)}
            >
              {displayName}
            </a>
          </div>
          <div class="author-handle-line">
            <a
              href={hrefForAppPath(`/u/${handle}`)}
              {...SPA_ANCHOR_SHIELD}
              onClick={spaNavigateClickStopRow(`/u/${handle}`)}
            >
              @{handle}
            </a>
            <AuthorFlair profile={post.author} postLabels={post.labels} />
          </div>
          <table class="author-stats-table">
            <tbody>
              <tr>
                <td>Joined</td>
                <td>{formatProfileJoined(post.author.createdAt)}</td>
              </tr>
              <tr>
                <td>Followers</td>
                <td class="author-accent-stat">{formatProfileStatCount(post.author.followersCount)}</td>
              </tr>
              <tr>
                <td>Posts</td>
                <td class="author-accent-stat">{formatProfileStatCount(post.author.postsCount)}</td>
              </tr>
            </tbody>
          </table>
          <div class="author-badges">
            {post.author.labels?.some(l => l.val === 'bot') && (
              <span class="author-badge author-badge-bot">Bot</span>
            )}
          </div>
        </div>
      </div>
      <div class="post-body">
        <div class="post-header">
          <div class="following-feed-row-header-line">
            <time
              class="post-header-date following-feed-row-post-time"
              dateTime={activityDate}
              title={dateStr}
            >
              <span
                class="post-header-date-relative"
                onClick={() => setShowExactTime(!showExactTime)}
                style={{ cursor: 'pointer' }}
              >
                {showExactTime ? dateStr : relativeTimeStr}
              </span>
              {customFeedLabel && (
                <>
                  <span class="following-feed-row-header-sep" aria-hidden>
                    ·
                  </span>
                  <span
                    class="thread-row-feed-via following-feed-row-via following-feed-row-via--inline"
                    title={blendSource?.feedUri ? `Feed: ${blendSource.feedUri}` : undefined}
                  >
                    <span class="thread-row-feed-via-icon" aria-hidden>
                      ◇
                    </span>
                    From <span class="thread-row-feed-via-name">{customFeedLabel}</span>
                  </span>
                </>
              )}
              {repostBy && (
                <>
                  <span class="following-feed-row-header-sep" aria-hidden>
                    ·
                  </span>
                  <span class="thread-row-repost-via following-feed-row-via following-feed-row-via--inline">
                    <span class="thread-row-repost-via-icon" aria-hidden>
                      ↻
                    </span>
                    Reposted by{' '}
                    <a
                      href={hrefForAppPath(`/u/${repostBy.handle}`)}
                      class="thread-row-repost-via-link"
                      {...SPA_ANCHOR_SHIELD}
                      onClick={spaNavigateClickStopRow(`/u/${repostBy.handle}`)}
                    >
                      {repostBy.displayName || repostBy.handle}
                    </a>
                  </span>
                </>
              )}
            </time>
          </div>
          <div class="post-header-right">
            {showUnreadReplies && (
              <span
                class="thread-row-badge thread-row-badge--unread"
                title={t('thread.unreadReplies')}
              >
                New replies
              </span>
            )}
            <div class="following-feed-row-header-actions" onClick={stopNav}>
              <PostSubscribeButton threadRootUri={post.uri} />
              {onHide && (
                <button
                  type="button"
                  class="btn btn-sm btn-outline following-feed-row-action-btn"
                  title="Hide this thread from the list"
                  onClick={() => onHide()}
                >
                  Hide
                </button>
              )}
            </div>
          </div>
        </div>

        <div class="post-content">
          {replyContext?.parent && (
            <a
              href={href}
              class="reply-preview"
              {...SPA_ANCHOR_SHIELD}
              onClick={(e: MouseEvent) => {
                stopNav(e);
                if (href !== '#') navigate(href);
              }}
            >
              <div class="reply-preview-header">
                <span class="reply-preview-label">Replying to</span>
                <span class="reply-preview-author">@{replyContext.parent.author.handle}</span>
              </div>
              <div class="reply-preview-content">
                {renderPostContent(replyContext.parent.record.text, replyContext.parent.record.facets)}
                {parentMediaCount > 0 ? (
                  parentMediaCount > 1 ? <div class="post-content-media-stack">{parentMediaNodes}</div> : parentMediaNodes
                ) : null}
                {parentExternal &&
                  (parentExternalGifSrc ? (
                    <NsfwMediaWrap isNsfw={parentNsfwMedia} labels={parentNsfwLabels}>
                      <GifImage
                        thumb={parentExternalGifSrc.thumb}
                        fullsize={parentExternalGifSrc.fullsize}
                        alt=""
                        className="post-external-gif"
                        aria-hidden="true"
                      />
                    </NsfwMediaWrap>
                  ) : (
                    <NsfwMediaWrap isNsfw={parentNsfwMedia}>
                      <a
                        href={parentExternal.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="post-external-card"
                        onClick={stopNav}
                      >
                        {parentExternal.thumb && (
                          <div class="post-external-card-media">
                            <img class="post-external-thumb" src={parentExternal.thumb} alt="" loading="lazy" aria-hidden="true" />
                          </div>
                        )}
                        <div class="post-external-card-body">
                          <div class="post-external-card-host">
                            {(() => {
                              try {
                                return new URL(parentExternal.uri).hostname;
                              } catch {
                                return 'Link';
                              }
                            })()}
                          </div>
                          <div class="post-external-title">{parentExternal.title || parentExternal.uri}</div>
                          {parentExternal.description ? (
                            <div class="post-external-desc">{parentExternal.description}</div>
                          ) : null}
                        </div>
                      </a>
                    </NsfwMediaWrap>
                  ))}
              </div>
            </a>
          )}
          {renderPostContent(post.record.text, post.record.facets)}
          {mediaCount > 0 ? (
            mediaCount > 1 ? <div class="post-content-media-stack">{mediaNodes}</div> : mediaNodes
          ) : null}

          {quotedEmbed?.kind === 'post' && <QuotedPostEmbedCard quoted={quotedEmbed.post} />}
          {quotedEmbed?.kind === 'notFound' && (
            <p class="post-quoted-embed-fallback">Quoted post could not be found.</p>
          )}
          {quotedEmbed?.kind === 'blocked' && (
            <p class="post-quoted-embed-fallback">Quoted post is unavailable.</p>
          )}
          {quotedEmbed?.kind === 'detached' && (
            <p class="post-quoted-embed-fallback">Quoted post is no longer available.</p>
          )}

          {external &&
            (externalGifSrc ? (
              <NsfwMediaWrap isNsfw={nsfwMedia} labels={nsfwLabels}>
                <GifImage
                  thumb={externalGifSrc.thumb}
                  fullsize={externalGifSrc.fullsize}
                  alt=""
                  className="post-external-gif following-feed-row-media"
                  aria-hidden="true"
                />
              </NsfwMediaWrap>
            ) : (
              <NsfwMediaWrap isNsfw={nsfwMedia}>
                <a
                  href={external.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="post-external-card following-feed-row-external"
                  onClick={stopNav}
                >
                  {external.thumb && (
                    <div class="post-external-card-media">
                      <img class="post-external-thumb" src={external.thumb} alt="" loading="lazy" aria-hidden="true" />
                    </div>
                  )}
                  <div class="post-external-card-body">
                    <div class="post-external-card-host">
                      {(() => {
                        try {
                          return new URL(external.uri).hostname;
                        } catch {
                          return 'Link';
                        }
                      })()}
                    </div>
                    <div class="post-external-title">{external.title || external.uri}</div>
                    {external.description ? (
                      <div class="post-external-desc">{external.description}</div>
                    ) : null}
                  </div>
                </a>
              </NsfwMediaWrap>
            ))}
        </div>

        <div class="post-footer" onClick={stopNav}>
          <div class="post-actions">
            <PostLikeButton post={post} />
            <button
              type="button"
              class="post-reply-btn post-reply-btn--social"
              disabled={!threadPath}
              aria-label={
                replyCount === 0
                  ? 'Reply to thread'
                  : `Reply to thread, ${replyCount === 1 ? '1 reply' : `${replyCount} replies`}`
              }
              onClick={(e: MouseEvent) => {
                stopNav(e);
                if (!threadPath) return;
                if (!isLoggedIn.value) {
                  showAuthDialog.value = true;
                  return;
                }
                navigate(`${threadPath}?reply=1`);
              }}
            >
              <span class="post-reply-btn-icon" aria-hidden>
                <svg
                  class="post-reply-btn-icon-svg"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                </svg>
              </span>
              <span class="post-reply-btn-count">{replyCount}</span>
            </button>
            <PostRepostButton
              post={post}
              onQuoteRepost={() => {
                if (!isLoggedIn.value) {
                  showAuthDialog.value = true;
                  return;
                }
                if (threadPath) navigate(`${threadPath}?quote=1`);
              }}
            />
            <PostDownvoteButton
              downvoteRecordUri={downvoteRecordUri}
              displayCount={downvoteDisplayCount}
              busy={Boolean(downvoteBusy)}
              onToggle={() => void onDownvotePost(post.uri, post.cid)}
            />
            <PostShareButton post={post} forumskyPath={threadPath} />
          </div>
        </div>
      </div>
    </article>
  );
}
