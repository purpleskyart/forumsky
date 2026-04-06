import { useState, useEffect } from 'preact/hooks';
import { hrefForAppPath } from '@/lib/app-base-path';
import { getSavedThreadRootUris } from '@/lib/forumsky-local';
import { parseAtUri, getPosts } from '@/api/feed';
import { threadUrl, navigate, SPA_ANCHOR_SHIELD } from '@/lib/router';
import { postThreadListTitle } from '@/lib/thread-title';
import { threadPreviewThumb } from '@/lib/richtext';
import { postHasNsfwLabels } from '@/lib/nsfw-labels';
import { NsfwMediaWrap } from '@/components/NsfwMediaWrap';
import type { PostView } from '@/api/types';

const GET_POSTS_CHUNK = 25;

export function SavedThreads() {
  const [uris] = useState(() => getSavedThreadRootUris());
  const [byUri, setByUri] = useState<Record<string, PostView>>({});
  const [loading, setLoading] = useState(() => getSavedThreadRootUris().length > 0);

  useEffect(() => {
    const list = uris;
    if (list.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const m: Record<string, PostView> = {};
      for (let i = 0; i < list.length; i += GET_POSTS_CHUNK) {
        const chunk = list.slice(i, i + GET_POSTS_CHUNK);
        try {
          const { posts } = await getPosts(chunk);
          if (cancelled) return;
          for (const p of posts) m[p.uri] = p;
        } catch {
          /* network / partial failure — still show other rows */
        }
      }
      if (!cancelled) {
        setByUri(m);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <div class="breadcrumb">
        <a
          href={hrefForAppPath('/')}
          {...SPA_ANCHOR_SHIELD}
          onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}
        >
          ForumSky
        </a>
        <span class="sep">&gt;</span>
        <span>Saved threads</span>
      </div>

      <div class="panel">
        {uris.length === 0 ? (
          <div class="empty">
            <p>No saved threads yet. Open a thread and choose “Save thread”.</p>
          </div>
        ) : (
          <>
            {loading && <p class="saved-threads-loading">Loading threads…</p>}
            <ul class="saved-threads-list">
              {uris.map(uri => {
                const p = parseAtUri(uri);
                const path = p ? threadUrl(p.repo, p.rkey) : '#';
                const post = byUri[uri];
                const title = post
                  ? postThreadListTitle(post)
                  : loading
                    ? '…'
                    : 'Thread (could not load)';
                const preview = post ? threadPreviewThumb(post) : null;
                const authorLabel = post
                  ? (post.author.displayName || post.author.handle)
                  : null;
                return (
                  <li key={uri} class="saved-threads-item">
                    <a
                      href={hrefForAppPath(path)}
                      class="saved-thread-row-link"
                      {...SPA_ANCHOR_SHIELD}
                      onClick={(e: Event) => { e.preventDefault(); navigate(path); }}
                    >
                      <div class="saved-thread-row-main">
                        <div class="saved-thread-title-text">{title}</div>
                        {authorLabel && (
                          <div class="saved-thread-meta">
                            by{' '}
                            <span style="color:var(--text-secondary)">{authorLabel}</span>
                          </div>
                        )}
                      </div>
                      {preview && (
                        <span class="saved-thread-thumb-frame" aria-hidden="true">
                          <span class="thread-thumb-wrap">
                            <NsfwMediaWrap isNsfw={Boolean(post && postHasNsfwLabels(post))} compact>
                              <img
                                src={preview.url}
                                alt=""
                                class="thread-thumb"
                                loading="lazy"
                                decoding="async"
                              />
                            </NsfwMediaWrap>
                            {preview.extraCount > 0 && (
                              <span class="thread-thumb-more">+{preview.extraCount}</span>
                            )}
                          </span>
                        </span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
