import { Fragment } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { getPosts, parseAtUri } from '@/api/feed';
import type { PostView } from '@/api/types';
import { GifImage, GifImageFromEmbed } from '@/components/GifImage';
import { PostContentImage } from '@/components/PostContentImage';
import { HlsVideo } from '@/components/HlsVideo';
import { NsfwMediaWrap } from '@/components/NsfwMediaWrap';
import {
  renderPostContent,
  getQuotedPostAggregatedMedia,
  isGifImage,
  isNativeExternalEmbed,
  getExternalGifPlaybackSources,
} from '@/lib/richtext';
import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, threadUrl, SPA_ANCHOR_SHIELD } from '@/lib/router';
import { postHasNsfwLabels } from '@/lib/nsfw-labels';

export function QuotedPostEmbedCard({ quoted }: { quoted: PostView }) {
  const [hydrated, setHydrated] = useState<PostView | null>(null);
  const displayPost = hydrated ?? quoted;

  useEffect(() => {
    const initial = getQuotedPostAggregatedMedia(quoted);
    if (initial.images.length > 0 || initial.external || initial.videos.length > 0) return;
    let cancelled = false;
    void getPosts([quoted.uri])
      .then(res => {
        if (cancelled) return;
        const p = res.posts[0];
        if (!p) return;
        const m = getQuotedPostAggregatedMedia(p);
        if (m.images.length > 0 || m.external || m.videos.length > 0) setHydrated(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [quoted.uri]);

  const handle = displayPost.author.handle;
  const displayName = displayPost.author.displayName || handle;
  const agg = getQuotedPostAggregatedMedia(displayPost);
  const quotedExtGif =
    agg.external && isNativeExternalEmbed(agg.external)
      ? getExternalGifPlaybackSources(agg.external)
      : null;
  const quotedNsfw = useMemo(() => postHasNsfwLabels(displayPost), [displayPost]);
  const quotedParsed = parseAtUri(displayPost.uri);
  const forumskyThreadPath = quotedParsed
    ? threadUrl(displayPost.author.handle || displayPost.author.did, quotedParsed.rkey)
    : null;

  return (
    <div class={`post-quoted-embed${forumskyThreadPath ? ' post-quoted-embed--nav' : ''}`}>
      {forumskyThreadPath && (
        <a
          href={hrefForAppPath(forumskyThreadPath)}
          class="post-quoted-embed-stretch"
          aria-label={`Open quoted post by @${handle} in ForumSky`}
          {...SPA_ANCHOR_SHIELD}
          onClick={(e: MouseEvent) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            navigate(forumskyThreadPath);
          }}
        />
      )}
      <div class="post-quoted-embed-stack">
        <div class="post-quoted-embed-head">
          <span class="post-quoted-embed-label">Quoted post</span>
          <span class="post-quoted-embed-author-link">
            {displayName}
            <span class="post-quoted-embed-handle"> @{handle}</span>
          </span>
        </div>
        {(() => {
          const mediaCount = agg.images.length + agg.videos.length;
          const mediaNodes = mediaCount > 0 ? (
            <Fragment>
              {agg.images.map((img, i) =>
                isGifImage(img) ? (
                  <GifImageFromEmbed
                    key={`img-${i}`}
                    img={img}
                    className="post-content-media post-content-media--gif post-quoted-embed-media post-quoted-embed-interactive"
                  />
                ) : (
                  <PostContentImage
                    key={`img-${i}`}
                    className="post-content-media post-quoted-embed-media"
                    src={img.fullsize || img.thumb}
                    alt={img.alt ?? ''}
                    aspectRatio={img.aspectRatio}
                  />
                ),
              )}
              {agg.videos.map((vid, i) => (
                <HlsVideo
                  key={`vid-${i}`}
                  playlist={vid.playlist}
                  poster={vid.thumbnail}
                  aspectRatio={vid.aspectRatio}
                  className="post-content-media post-quoted-embed-media post-quoted-embed-interactive"
                  aria-label={vid.alt || 'Video from quoted post'}
                />
              ))}
            </Fragment>
          ) : null;

          const externalNode = agg.external ? (
            quotedExtGif ? (
              <GifImage
                thumb={quotedExtGif.thumb}
                fullsize={quotedExtGif.fullsize}
                alt=""
                className="post-external-gif post-quoted-embed-media post-quoted-embed-interactive"
              />
            ) : (
              <a
                href={agg.external.uri}
                target="_blank"
                rel="noopener noreferrer"
                class="post-external-card post-quoted-embed-external post-quoted-embed-interactive"
              >
                {agg.external.thumb && (
                  <div class="post-external-card-media">
                    <img
                      class="post-external-thumb"
                      src={agg.external.thumb}
                      alt=""
                      loading="lazy"
                    />
                  </div>
                )}
                <div class="post-external-card-body">
                  <div class="post-external-card-host">
                    {(() => {
                      try {
                        return new URL(agg.external!.uri).hostname;
                      } catch {
                        return 'Link';
                      }
                    })()}
                  </div>
                  <div class="post-external-title">{agg.external.title || agg.external.uri}</div>
                  {agg.external.description ? (
                    <div class="post-external-desc">{agg.external.description}</div>
                  ) : null}
                </div>
              </a>
            )
          ) : null;

          if (mediaCount === 0 && !externalNode) return null;

          return (
            <div style="margin-bottom: 8px">
              <NsfwMediaWrap isNsfw={quotedNsfw}>
                {mediaCount > 1 ? (
                  <div class="post-content-media-stack">{mediaNodes}</div>
                ) : (
                  mediaNodes
                )}
                {externalNode}
              </NsfwMediaWrap>
            </div>
          );
        })()}
        <blockquote class="post-quoted-embed-quote">
          {renderPostContent(displayPost.record.text, displayPost.record.facets)}
        </blockquote>
      </div>
    </div>
  );
}
