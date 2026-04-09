import { NsfwMediaWrap } from '@/components/NsfwMediaWrap';
import { hrefForAppPath } from '@/lib/app-base-path';
import { postHasNsfwLabels } from '@/lib/nsfw-labels';
import { threadUrl, SPA_ANCHOR_SHIELD, spaNavigateClick } from '@/lib/router';
import { parseAtUri } from '@/api/feed';
import { threadPreviewThumb } from '@/lib/richtext';
import { postThreadListTitle } from '@/lib/thread-title';
import type { FeedBlendSourceMeta, FeedViewPost, PostView, ProfileView } from '@/api/types';
import { repostAttributionFromReason } from '@/lib/feed-reason';
import {
  threadHasNewRepliesSinceLastMark,
} from '@/lib/forumsky-local';
import { formatListDateTime } from '@/lib/i18n';
import { t } from '@/lib/i18n';

interface ThreadRowProps {
  post: PostView;
  pinned?: boolean;
  onPin?: () => void;
  onHide?: () => void;
  /** Thread root reply activity vs last “mark read” baseline */
  showUnreadReplies?: boolean;
  /** Activity timestamp (repost or reply) */
  lastActivity?: string;
  /** Author of the last activity */
  lastActivityAuthor?: ProfileView;
  /** Timeline/feed reason (Following: repost attribution, etc.) */
  feedReason?: FeedViewPost['reason'];
  /** Following mix: set when post was taken from a custom feed (not default timeline). */
  blendSource?: FeedBlendSourceMeta;
}

export function ThreadRow({
  post,
  pinned,
  onPin,
  onHide,
  showUnreadReplies,
  lastActivity,
  lastActivityAuthor,
  feedReason,
  blendSource,
}: ThreadRowProps) {
  const repostBy = repostAttributionFromReason(feedReason);
  const customFeedLabel = blendSource?.kind === 'custom' ? blendSource.label : undefined;
  const parsed = parseAtUri(post.uri);
  const href = parsed ? threadUrl(post.author.handle || post.author.did, parsed.rkey) : '#';
  const title = postThreadListTitle(post);
  const replyCount = post.replyCount ?? 0;
  const activityDate = lastActivity || post.indexedAt;
  const activityAuthor = lastActivityAuthor || post.author;
  const dateStr = formatListDateTime(activityDate);
  const preview = threadPreviewThumb(post);

  const rowClass =
    `thread-row${pinned ? ' pinned' : ''}${onHide ? ' thread-row--list-actions' : ''}`;

  return (
    <div class={rowClass}>
      <div class="thread-row-leading">
        <div class="thread-indicator">
          {pinned ? '\u2605' : '\u2192'}
        </div>
        {onPin && (
          <button
            type="button"
            class="btn btn-sm btn-outline thread-row-pin-btn"
            title={pinned ? 'Unpin thread' : 'Pin thread'}
            onClick={(e: Event) => { e.stopPropagation(); e.preventDefault(); onPin(); }}
          >
            {pinned ? 'Unpin' : 'Pin'}
          </button>
        )}
      </div>
      <div class="thread-info">
        <div class="thread-title-row">
          <div class="thread-title">
            <a href={hrefForAppPath(href)} {...SPA_ANCHOR_SHIELD} onClick={spaNavigateClick(href)}>
              {title}
            </a>
            {showUnreadReplies && (
              <span class="thread-row-badge thread-row-badge--unread" title={t('thread.unreadReplies')}>
                New replies
              </span>
            )}
          </div>
          {preview && (
            <a
              href={hrefForAppPath(href)}
              class="thread-thumb-link"
              aria-hidden="true"
              tabindex={-1}
              {...SPA_ANCHOR_SHIELD}
              onClick={spaNavigateClick(href)}
            >
              <span class="thread-thumb-wrap">
                <NsfwMediaWrap isNsfw={postHasNsfwLabels(post)} compact>
                  <img src={preview.url} alt="" class="thread-thumb" loading="lazy" decoding="async" />
                </NsfwMediaWrap>
                {preview.extraCount > 0 && (
                  <span class="thread-thumb-more">+{preview.extraCount}</span>
                )}
              </span>
            </a>
          )}
        </div>
        <div class="thread-meta">
          {customFeedLabel && (
            <div
              class="thread-row-feed-via"
              title={blendSource?.feedUri ? `Feed: ${blendSource.feedUri}` : undefined}
            >
              <span class="thread-row-feed-via-icon" aria-hidden>
                ◇
              </span>
              From <span class="thread-row-feed-via-name">{customFeedLabel}</span>
            </div>
          )}
          {repostBy && (
            <div class="thread-row-repost-via">
              <span class="thread-row-repost-via-icon" aria-hidden>
                ↻
              </span>
              Reposted by{' '}
              <a
                href={hrefForAppPath(`/u/${repostBy.handle}`)}
                class="thread-row-repost-via-link"
                {...SPA_ANCHOR_SHIELD}
                onClick={spaNavigateClick(`/u/${repostBy.handle}`)}
              >
                {repostBy.displayName || repostBy.handle}
              </a>
            </div>
          )}
          <div class="thread-meta-author">
            by{' '}
            <a
              href={hrefForAppPath(`/u/${post.author.handle}`)}
              style="color:var(--text-secondary);text-decoration:none"
              {...SPA_ANCHOR_SHIELD}
              onClick={spaNavigateClick(`/u/${post.author.handle}`)}
            >
              {post.author.displayName || post.author.handle}
            </a>
          </div>
        </div>
      </div>
      <div class="thread-replies">{replyCount}</div>
      <div class="thread-last-reply">
        <div class="lr-date">{dateStr}</div>
        <div class="lr-user">
          Last Activity by{' '}
          <a
            href={hrefForAppPath(`/u/${activityAuthor.handle}`)}
            class="lr-user"
            {...SPA_ANCHOR_SHIELD}
            onClick={spaNavigateClick(`/u/${activityAuthor.handle}`)}
          >
            {activityAuthor.displayName || activityAuthor.handle}
          </a>
        </div>
        {onHide && (
          <button
            type="button"
            class="thread-row-hide-btn"
            title="Hide this thread from the list"
            onClick={(e: Event) => { e.stopPropagation(); e.preventDefault(); onHide(); }}
          >
            Hide
          </button>
        )}
      </div>
    </div>
  );
}

export function threadRowUnreadReplies(post: PostView): boolean {
  return threadHasNewRepliesSinceLastMark(post.uri, post.replyCount ?? 0);
}
