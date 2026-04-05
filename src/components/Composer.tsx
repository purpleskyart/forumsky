import { useState, useMemo, useEffect, useRef } from 'preact/hooks';
import { currentUser, isLoggedIn, showToast, showAuthDialog } from '@/lib/store';
import { buildComposerFacets } from '@/lib/richtext';
import { fetchLinkPreview } from '@/api/link-preview';
import { setComposerNavigationDirty } from '@/lib/navigation-guard';
import type { StrongRef, ProfileView } from '@/api/types';
import {
  splitComposerSegments,
  getComposerSegmentRanges,
  COMPOSER_MAX_CHARS,
} from '@/lib/composer-segments';
import {
  buildImagesEmbed,
  uploadImageFiles,
  MAX_IMAGES_PER_POST,
  MAX_IMAGE_BYTES,
  isAcceptedImageFile,
} from '@/api/blob';
import { THREAD_TITLE_PREVIEW_MAX_CHARS } from '@/lib/thread-title';
import {
  getComposerDraft,
  setComposerDraft,
  clearComposerDraft,
  enqueueOutbox,
} from '@/lib/forumsky-local';

interface ComposerProps {
  /** If provided, this is a reply */
  replyTo?: {
    root: StrongRef;
    parent: StrongRef;
  };
  /** Embed this post (quote repost); mutually exclusive with thread reply in typical use */
  quoteEmbed?: StrongRef;
  /** Shown above the field: who the first Bluesky post will reply to */
  replyTargetSummary?: string;
  /** Increment to focus the textarea (e.g. after clicking Reply on a post) */
  focusRequest?: number;
  /** Preset community hashtag */
  community?: string;
  onPost?: () => void;
  /** Thread reply: Cancel next to Reply (dismiss composer) */
  onCancel?: () => void;
  /** Extra class for the root form (e.g. thread page anchor) */
  className?: string;
  textareaId?: string;
  /** Autosave plain-text draft to localStorage (images not saved) */
  draftKey?: string;
  /** Bump id and set text to append a block (e.g. quoted selection) */
  appendTextRequest?: { id: number; text: string };
}

type ComposerAttachment = { id: string; file: File; previewUrl: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First Bluesky post in a community thread: append #tag unless the user already included it. */
function withCommunityTagOnFirstSegment(segText: string, community: string): string {
  const re = new RegExp(`#${escapeRegExp(community)}\\b`);
  if (re.test(segText)) return segText;
  const t = segText.trim();
  const tagLine = `#${community}`;
  return t ? `${t}\n\n${tagLine}` : tagLine;
}

/** Prepend optional title to the first Bluesky segment (community new thread only). */
function mergeOptionalThreadTitle(segments: string[], title: string, enabled: boolean): string[] {
  if (!enabled) return segments;
  const t = title.trim();
  if (!t) return segments;
  if (segments.length === 0) return [t];
  const body0 = segments[0];
  const first = body0.trim() ? `${t}\n\n${body0}` : t;
  return [first, ...segments.slice(1)];
}

function finalizeCommunityRootSegments(
  segments: string[],
  community: string | undefined,
  isCommunityRoot: boolean,
): string[] {
  if (!isCommunityRoot || !community || segments.length === 0) return segments;
  return [
    withCommunityTagOnFirstSegment(segments[0], community),
    ...segments.slice(1),
  ];
}

function buildSegmentHighlightNodes(
  normalized: string,
  ranges: { start: number; end: number }[],
) {
  const nodes: preact.JSX.Element[] = [];
  let pos = 0;
  ranges.forEach((r, i) => {
    if (pos < r.start) {
      nodes.push(
        <span key={`gap-${pos}-${r.start}`} class="composer-seg-gap">
          {normalized.slice(pos, r.start)}
        </span>,
      );
    }
    nodes.push(
      <span
        key={`seg-${i}-${r.start}`}
        class={`composer-seg composer-seg-${i % 2}${i > 0 ? ' composer-seg-next' : ''}`}
      >
        {normalized.slice(r.start, r.end)}
      </span>,
    );
    pos = r.end;
  });
  if (pos < normalized.length) {
    nodes.push(
      <span key={`gap-end-${pos}`} class="composer-seg-gap">
        {normalized.slice(pos)}
      </span>,
    );
  }
  return nodes;
}

function getPostingSegments(segments: string[], imageCount: number): string[] {
  const mapped = segments.map(s => s.trim());
  if (imageCount > 0 && mapped.length === 1 && mapped[0] === '') {
    return [''];
  }
  return mapped.filter(s => s.length > 0);
}

export function Composer({
  replyTo,
  quoteEmbed,
  replyTargetSummary,
  focusRequest,
  community,
  onPost,
  onCancel,
  className,
  textareaId = 'composer-textarea',
  draftKey,
  appendTextRequest,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [threadTitle, setThreadTitle] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [posting, setPosting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [attachmentAlts, setAttachmentAlts] = useState<Record<string, string>>({});
  const [mentionMenu, setMentionMenu] = useState<{
    start: number;
    end: number;
    query: string;
    actors: ProfileView[];
    loading: boolean;
  } | null>(null);
  const [linkPreview, setLinkPreview] = useState<{
    url: string;
    title: string;
    description: string;
    image: string;
  } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAppendIdRef = useRef(0);
  const mentionSearchRef = useRef(0);
  const linkPreviewTimerRef = useRef(0);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    if (!draftKey) return;
    const d = getComposerDraft(draftKey);
    setText(d?.text ?? '');
    setThreadTitle(d?.threadTitle ?? '');
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    const id = window.setTimeout(() => {
      setComposerDraft(draftKey, { text, threadTitle });
    }, 450);
    return () => window.clearTimeout(id);
  }, [draftKey, text, threadTitle]);

  useEffect(() => {
    if (!appendTextRequest || appendTextRequest.id === lastAppendIdRef.current) return;
    lastAppendIdRef.current = appendTextRequest.id;
    const block = appendTextRequest.text.trim();
    if (!block) return;
    setText(prev => {
      const p = prev.trim();
      return p ? `${p}\n\n${block}` : block;
    });
    requestAnimationFrame(() => taRef.current?.focus());
  }, [appendTextRequest]);

  const normalizedText = useMemo(() => text.replace(/\r\n/g, '\n'), [text]);

  const segments = useMemo(() => {
    if (quoteEmbed) {
      return [normalizedText];
    }
    return splitComposerSegments(text);
  }, [text, quoteEmbed, normalizedText]);

  const segmentRanges = useMemo(() => {
    if (quoteEmbed) return [];
    return getComposerSegmentRanges(text);
  }, [text, quoteEmbed]);
  const postingSegments = useMemo(() => {
    const base = getPostingSegments(segments, attachments.length);
    if (quoteEmbed && base.length === 0) return [''];
    return base;
  }, [segments, attachments.length, quoteEmbed]);

  const isCommunityNewThread = Boolean(community && !replyTo && !quoteEmbed);

  const segmentsWithTitle = useMemo(
    () => mergeOptionalThreadTitle(postingSegments, threadTitle, isCommunityNewThread),
    [postingSegments, threadTitle, isCommunityNewThread],
  );

  /** Segments as they will be sent (optional title + community #tag on first root post). */
  const publishSegments = useMemo(
    () => finalizeCommunityRootSegments(segmentsWithTitle, community, isCommunityNewThread),
    [segmentsWithTitle, community, isCommunityNewThread],
  );

  /** Bluesky posts after merging text segments with image batches (4 images max per post). */
  const blueskyPostCount = useMemo(() => {
    if (quoteEmbed) return postingSegments.length;
    const nText = postingSegments.length;
    const nImg = attachments.length;
    const batches = nImg === 0 ? 0 : Math.ceil(nImg / MAX_IMAGES_PER_POST);
    return Math.max(nText, batches);
  }, [postingSegments.length, attachments.length, quoteEmbed]);

  const totalChars = text.length;
  const maxSegLen =
    publishSegments.length > 0 ? Math.max(...publishSegments.map(s => s.length)) : 0;
  const overLimit = publishSegments.some(s => s.length > COMPOSER_MAX_CHARS);
  const totalPublishChars = publishSegments.reduce((a, s) => a + s.length, 0);
  const charCounterSingleLen =
    publishSegments.length >= 1 ? publishSegments[0].length : totalChars;

  const smartTextareaAriaLabel = useMemo(() => {
    if (replyTo && replyTargetSummary) return `Reply: ${replyTargetSummary}`;
    if (replyTo) return 'Write your reply';
    if (community) return `New thread in #${community}`;
    return 'Compose post';
  }, [replyTo, replyTargetSummary, community]);

  const showSmartHeadHint =
    !quoteEmbed && (segmentRanges.length > 1 || attachments.length > MAX_IMAGES_PER_POST);

  const hasContent =
    Boolean(quoteEmbed) ||
    attachments.length > 0 ||
    text.trim().length > 0 ||
    (isCommunityNewThread && threadTitle.trim().length > 0);

  const canSubmit =
    !overLimit &&
    hasContent &&
    (Boolean(quoteEmbed) || isCommunityNewThread || postingSegments.length > 0);

  useEffect(() => {
    if (focusRequest === undefined || focusRequest === 0) return;
    taRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach(a => URL.revokeObjectURL(a.previewUrl));
    };
  }, []);

  useEffect(() => {
    setComposerNavigationDirty(hasContent);
    return () => setComposerNavigationDirty(false);
  }, [hasContent]);

  useEffect(() => {
    if (!hasContent) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasContent]);

  useEffect(() => {
    if (quoteEmbed) {
      setLinkPreview(null);
      return;
    }
    const urls = normalizedText.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi) ?? [];
    const last = urls.length > 0 ? urls[urls.length - 1] : null;
    window.clearTimeout(linkPreviewTimerRef.current);
    if (!last) {
      setLinkPreview(null);
      return;
    }
    linkPreviewTimerRef.current = window.setTimeout(() => {
      void fetchLinkPreview(last).then(data => {
        if (!data) {
          setLinkPreview(null);
          return;
        }
        setLinkPreview({
          url: data.url,
          title: data.title,
          description: data.description,
          image: data.image,
        });
      });
    }, 450);
    return () => window.clearTimeout(linkPreviewTimerRef.current);
  }, [normalizedText, quoteEmbed]);

  const updateMentionMenuFromCursor = () => {
    const ta = taRef.current;
    if (!ta) return;
    const v = ta.value;
    const sel = ta.selectionStart ?? v.length;
    const before = v.slice(0, sel);
    const at = before.lastIndexOf('@');
    if (at < 0) {
      setMentionMenu(null);
      return;
    }
    const frag = before.slice(at + 1);
    if (!/^[\w.-]*$/.test(frag)) {
      setMentionMenu(null);
      return;
    }
    if (frag.length < 1) {
      setMentionMenu(null);
      return;
    }
    const gen = ++mentionSearchRef.current;
    setMentionMenu({ start: at, end: sel, query: frag, actors: [], loading: true });
    window.setTimeout(() => {
      if (mentionSearchRef.current !== gen) return;
      void import('@/api/actor').then(({ searchActors }) =>
        searchActors(frag, { limit: 8 }),
      ).then(actors => {
        if (mentionSearchRef.current !== gen) return;
        setMentionMenu(m =>
          m && m.start === at && m.end === sel && m.query === frag
            ? { ...m, actors, loading: false }
            : m,
        );
      }).catch(() => {
        if (mentionSearchRef.current !== gen) return;
        setMentionMenu(m =>
          m && m.start === at && m.end === sel && m.query === frag
            ? { ...m, actors: [], loading: false }
            : m,
        );
      });
    }, 200);
  };

  const pickMention = (p: ProfileView) => {
    if (!mentionMenu) return;
    const handle = p.handle || p.did;
    const before = text.slice(0, mentionMenu.start);
    const after = text.slice(mentionMenu.end);
    const insert = `@${handle} `;
    setText(before + insert + after);
    setMentionMenu(null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      const pos = before.length + insert.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const syncHighlightScroll = () => {
    const ta = taRef.current;
    const hi = highlightRef.current;
    if (ta && hi) hi.scrollTop = ta.scrollTop;
  };

  useEffect(() => {
    syncHighlightScroll();
  }, [text, segmentRanges.length]);

  const addFiles = (fileList: FileList | File[]) => {
    if (quoteEmbed) {
      showToast('Images are not supported on quote posts in this composer');
      return;
    }
    const incoming = Array.from(fileList).filter(isAcceptedImageFile);
    if (incoming.length === 0) {
      showToast('Use JPEG, PNG, GIF, or WebP images');
      return;
    }
    setAttachments(prev => {
      const next: ComposerAttachment[] = [...prev];
      for (const file of incoming) {
        if (file.size > MAX_IMAGE_BYTES) {
          showToast(`${file.name} is too large (max ${MAX_IMAGE_BYTES / 1000}KB)`);
          continue;
        }
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }
      return next;
    });
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const found = prev.find(a => a.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter(a => a.id !== id);
    });
    setAttachmentAlts(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const onDropZoneDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types.includes('Files')) setDragOver(true);
  };

  const onDropZoneDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const onDropZoneDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  if (!isLoggedIn.value) {
    return (
      <div class={`composer ${className ?? ''}`} style="text-align:center;padding:20px">
        <p style="color:var(--text-secondary);margin-bottom:10px">Sign in to create a thread</p>
        <button class="btn btn-primary" onClick={() => { showAuthDialog.value = true; }}>
          Login
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!canSubmit || posting) return;

    if (attachments.length > 0) {
      const missingAlt = attachments.some(a => !(attachmentAlts[a.id] ?? '').trim());
      if (
        missingAlt &&
        !window.confirm(
          'Some images have no alt text (important for screen readers). Post anyway?',
        )
      ) {
        return;
      }
    }

    setPosting(true);
    let blueskyPostsCreated = 1;
    try {
      const { createPostWithDid } = await import('@/api/post');
      const { getProfiles } = await import('@/api/actor');
      const did = currentUser.value!.did;

      if (quoteEmbed) {
        const validSegments = postingSegments;
        if (validSegments.length === 0) return;
        const facets = await buildComposerFacets(validSegments[0] ?? '', getProfiles);
        await createPostWithDid(did, {
          text: validSegments[0] ?? '',
          reply: undefined,
          facets: facets.length > 0 ? facets : undefined,
          embed: { $type: 'app.bsky.embed.record', record: quoteEmbed },
        });
      } else {
        let publishSegs = mergeOptionalThreadTitle(
          postingSegments,
          threadTitle,
          isCommunityNewThread,
        );
        publishSegs = finalizeCommunityRootSegments(
          publishSegs,
          community,
          isCommunityNewThread,
        );
        if (publishSegs.length === 0) return;

        const nText = publishSegs.length;
        const nImg = attachments.length;
        const batches = nImg === 0 ? 0 : Math.ceil(nImg / MAX_IMAGES_PER_POST);
        const numPosts = Math.max(nText, batches);
        blueskyPostsCreated = numPosts;

        let threadRootRef: StrongRef | undefined = replyTo?.root;
        let parentRef: StrongRef | undefined = replyTo?.parent;

        for (let i = 0; i < numPosts; i++) {
          let segText = i < nText ? publishSegs[i] : '';
          const attSlice = attachments.slice(
            i * MAX_IMAGES_PER_POST,
            (i + 1) * MAX_IMAGES_PER_POST,
          );

          let segEmbed: ReturnType<typeof buildImagesEmbed> | undefined;
          if (attSlice.length > 0) {
            const blobs = await uploadImageFiles(attSlice.map(a => a.file));
            const alts = attSlice.map(a => attachmentAlts[a.id] ?? '');
            segEmbed = buildImagesEmbed(blobs, alts);
          }

          const facets = await buildComposerFacets(segText, getProfiles);
          const reply =
            threadRootRef && parentRef
              ? { root: threadRootRef, parent: parentRef }
              : undefined;

          const res = await createPostWithDid(did, {
            text: segText,
            reply,
            facets: facets.length > 0 ? facets : undefined,
            embed: segEmbed,
          });

          if (replyTo) {
            parentRef = { uri: res.uri, cid: res.cid };
          } else {
            if (i === 0) {
              threadRootRef = { uri: res.uri, cid: res.cid };
            }
            parentRef = { uri: res.uri, cid: res.cid };
          }
        }
      }

      attachments.forEach(a => URL.revokeObjectURL(a.previewUrl));
      setAttachments([]);
      setAttachmentAlts({});
      setText('');
      setThreadTitle('');
      if (quoteEmbed) {
        showToast('Quote posted!');
      } else if (blueskyPostsCreated > 1) {
        showToast(
          replyTo
            ? `Posted ${blueskyPostsCreated} Bluesky posts (chained replies, same as a long thread)`
            : `Posted ${blueskyPostsCreated} Bluesky posts in one Forumsky thread`,
        );
      } else {
        showToast(replyTo ? 'Reply posted!' : 'Thread posted!');
      }
      if (draftKey) clearComposerDraft(draftKey);
      onPost?.();
    } catch (err) {
      const did = currentUser.value?.did;
      const seg0 = postingSegments[0]?.trim() ?? '';
      if (
        did &&
        replyTo &&
        !quoteEmbed &&
        attachments.length === 0 &&
        postingSegments.length === 1 &&
        seg0.length > 0
      ) {
        const { getProfiles: gp } = await import('@/api/actor');
        const facets = await buildComposerFacets(seg0, gp);
        enqueueOutbox({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          did,
          text: seg0,
          reply: replyTo,
          facets: facets.length > 0 ? facets : undefined,
          embed: undefined,
          createdAt: new Date().toISOString(),
        });
        showToast('Failed to post — saved to outbox for retry');
      } else {
        showToast('Failed to post: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }
    } finally {
      setPosting(false);
    }
  };

  const replyFirstParentLabel =
    replyTargetSummary ?? (replyTo ? 'the post you are replying to' : null);

  return (
    <form
      class={`composer ${className ?? ''}`}
      onSubmit={handleSubmit}
      onKeyDown={(e: KeyboardEvent) => {
        /* Artsky LayoutComposer: ⌘/Ctrl + Enter or E submits */
        if (!(e.metaKey || e.ctrlKey)) return;
        if (e.key !== 'Enter' && e.key !== 'e' && e.key !== 'E') return;
        const form = (e.currentTarget as HTMLFormElement);
        if (!canSubmit || posting) return;
        e.preventDefault();
        form.requestSubmit();
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        class="composer-file-input"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        onChange={(e: Event) => {
          const input = e.target as HTMLInputElement;
          if (input.files?.length) addFiles(input.files);
          input.value = '';
        }}
      />

      {isCommunityNewThread && (
        <div class="composer-thread-title-block">
          <label class="composer-thread-title-label" for={`${textareaId}-thread-title`}>
            Title <span class="composer-thread-title-optional">(optional)</span>
          </label>
          <input
            id={`${textareaId}-thread-title`}
            type="text"
            class="composer-thread-title-input"
            maxLength={THREAD_TITLE_PREVIEW_MAX_CHARS}
            value={threadTitle}
            placeholder="Shown in thread lists; appears at the start of your first post"
            onInput={(e: Event) =>
              setThreadTitle((e.target as HTMLInputElement).value.slice(0, THREAD_TITLE_PREVIEW_MAX_CHARS))
            }
            disabled={posting}
            aria-describedby={`${textareaId}-thread-title-hint`}
          />
          <p id={`${textareaId}-thread-title-hint`} class="composer-thread-title-hint">
            Up to {THREAD_TITLE_PREVIEW_MAX_CHARS} characters (same as list previews). On Bluesky this is plain text at
            the top of the first post, then a blank line, then the body below.
          </p>
        </div>
      )}

      {!quoteEmbed && blueskyPostCount > 1 && (
        <div class="composer-bluesky-preview" role="region" aria-label="Bluesky post preview">
          <div class="segment-preview-title">
            <span class="composer-bluesky-preview-heading">Bluesky preview</span>
            {' · '}
            {replyTo
              ? `${blueskyPostCount} posts. The first replies to your chosen post; each following post replies to your previous one here.`
              : `${blueskyPostCount} posts. The first starts a new thread; each following post replies to your previous one here.`}
            {attachments.length > MAX_IMAGES_PER_POST &&
              ` Up to ${MAX_IMAGES_PER_POST} images per Bluesky post; extras continue in the next post.`}
          </div>
          {Array.from({ length: blueskyPostCount }, (_, i) => {
            const seg = i < publishSegments.length ? publishSegments[i] : '';
            const imgs = attachments.slice(
              i * MAX_IMAGES_PER_POST,
              (i + 1) * MAX_IMAGES_PER_POST,
            );
            const imgCount = imgs.length;
            return (
              <div key={i} class="segment">
                <div class="seg-num">
                  Post {i + 1}/{blueskyPostCount}
                  {i === 0
                    ? replyTo
                      ? ` → Bluesky parent: ${replyFirstParentLabel}`
                      : ' → Bluesky: new thread root (no parent)'
                    : ` → Bluesky parent: your post ${i} in this box`}
                  {' '}
                  ({seg.length}/{COMPOSER_MAX_CHARS} chars)
                  {imgCount > 0 && ` · ${imgCount} image(s) on this Bluesky post`}
                </div>
                {seg || (
                  <span style="color:var(--text-muted)">
                    {imgCount > 0 ? '(no text — images only on Bluesky)' : '(empty)'}
                  </span>
                )}
                {imgCount > 0 && (
                  <ul class="segment-image-strip" aria-label={`Images on post ${i + 1}`}>
                    {imgs.map(a => (
                      <li key={a.id} class="composer-image-thumb segment-image-thumb">
                        <img src={a.previewUrl} alt="" />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {postingSegments.length === 1 &&
        blueskyPostCount === 1 &&
        replyTo &&
        replyFirstParentLabel && (
        <p class="composer-single-reply-hint composer-single-reply-hint--above-field">
          One Bluesky post replying to {replyFirstParentLabel}. Press Enter twice to split into more posts.
          {attachments.length > 0 ? ` ${attachments.length} image(s) on this post.` : ''} Need more than{' '}
          {MAX_IMAGES_PER_POST} images? Keep adding—Bluesky allows {MAX_IMAGES_PER_POST} per post; the rest publish as
          your replies in this thread.
        </p>
      )}

      {quoteEmbed ? (
        <div
          class={`composer-dropzone${dragOver ? ' composer-dropzone-active' : ''}`}
          onDragEnter={onDropZoneDragOver}
          onDragOver={onDropZoneDragOver}
          onDragLeave={onDropZoneDragLeave}
          onDrop={onDropZoneDrop}
        >
          <div class="composer-textarea-stack">
            <textarea
              ref={taRef}
              id={textareaId}
              placeholder="Add optional commentary…"
              value={text}
              onInput={(e: Event) => {
                setText((e.target as HTMLTextAreaElement).value);
                updateMentionMenuFromCursor();
              }}
              onKeyDown={() => requestAnimationFrame(() => updateMentionMenuFromCursor())}
              onClick={() => updateMentionMenuFromCursor()}
              disabled={posting}
            />
          </div>
          {dragOver && <div class="composer-dropzone-overlay">Drop images here</div>}
        </div>
      ) : (
        <div class="composer-smart-wrap">
          {showSmartHeadHint && (
            <div class="composer-smart-head">
              <span class="composer-smart-inline-hint" aria-live="polite">
                {segmentRanges.length > 1 && (
                  <>
                    Each colored band is a Bluesky post; the teal bar marks where the next post starts (add a blank line
                    to split there).{' '}
                  </>
                )}
                {attachments.length > MAX_IMAGES_PER_POST && (
                  <>
                    Bluesky allows {MAX_IMAGES_PER_POST} images per post; extra images are posted as replies in the same
                    thread (one Forumsky thread).
                  </>
                )}
              </span>
            </div>
          )}
          <div
            class={`composer-dropzone${dragOver ? ' composer-dropzone-active' : ''}`}
            onDragEnter={onDropZoneDragOver}
            onDragOver={onDropZoneDragOver}
            onDragLeave={onDropZoneDragLeave}
            onDrop={onDropZoneDrop}
          >
            <div
              class={`composer-textarea-stack${
                segmentRanges.length > 1 ? ' composer-textarea-stack--segments' : ''
              }`}
            >
              {segmentRanges.length > 1 && (
                <div
                  ref={highlightRef}
                  class="composer-segment-highlight"
                  aria-hidden="true"
                >
                  {buildSegmentHighlightNodes(normalizedText, segmentRanges)}
                </div>
              )}
              <textarea
                ref={taRef}
                id={textareaId}
                aria-label={smartTextareaAriaLabel}
                aria-controls={mentionMenu ? 'composer-mention-listbox' : undefined}
                aria-expanded={Boolean(mentionMenu)}
                aria-autocomplete="list"
                placeholder={
                  replyTo
                    ? 'Write your reply… (⌘/Ctrl+Enter to send; @ to mention; Enter twice splits into another Bluesky post.)'
                    : community
                      ? 'Write your thread… (⌘/Ctrl+Enter to send; @ to mention; Enter twice splits posts.)'
                      : 'Start a new thread… (⌘/Ctrl+Enter to send; @ to mention.)'
                }
                value={text}
                onInput={(e: Event) => {
                  setText((e.target as HTMLTextAreaElement).value);
                  updateMentionMenuFromCursor();
                }}
                onKeyDown={() => requestAnimationFrame(() => updateMentionMenuFromCursor())}
                onClick={() => updateMentionMenuFromCursor()}
                onScroll={syncHighlightScroll}
                disabled={posting}
              />
            </div>
            {dragOver && <div class="composer-dropzone-overlay">Drop images here</div>}
          </div>
        </div>
      )}

      {mentionMenu && mentionMenu.actors.length > 0 && (
        <ul
          id="composer-mention-listbox"
          class="composer-mention-listbox"
          role="listbox"
          aria-label="Mention suggestions"
        >
          {mentionMenu.actors.map(p => (
            <li key={p.did} role="option">
              <button
                type="button"
                class="composer-mention-option"
                onMouseDown={(e: Event) => e.preventDefault()}
                onClick={() => pickMention(p)}
              >
                @{p.handle}
                {p.displayName && (
                  <span class="composer-mention-dn"> {p.displayName}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {mentionMenu?.loading && (
        <p class="composer-mention-loading" aria-live="polite">
          Searching…
        </p>
      )}

      {linkPreview && !quoteEmbed && (
        <div class="composer-link-preview" role="region" aria-label="Link preview">
          {linkPreview.image ? (
            <img
              class="composer-link-preview-thumb"
              src={linkPreview.image}
              alt=""
            />
          ) : null}
          <div class="composer-link-preview-text">
            <div class="composer-link-preview-title">{linkPreview.title}</div>
            {linkPreview.description ? (
              <div class="composer-link-preview-desc">{linkPreview.description}</div>
            ) : null}
            <div class="composer-link-preview-url">{linkPreview.url}</div>
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <ul
          class="composer-image-strip composer-image-strip--below-composer"
          aria-label="Images to attach (order matches Bluesky posts: first four with post 1, next four with post 2, …)"
        >
          {attachments.map(a => (
            <li key={a.id} class="composer-image-thumb-with-alt">
              <div class="composer-image-thumb">
                <img src={a.previewUrl} alt="" />
                <button
                  type="button"
                  class="composer-image-remove"
                  onClick={() => removeAttachment(a.id)}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
              <label class="composer-alt-label">
                Alt text
                <input
                  type="text"
                  class="composer-alt-input"
                  value={attachmentAlts[a.id] ?? ''}
                  placeholder="Describe this image for screen readers"
                  maxLength={2000}
                  onInput={(e: Event) => {
                    const v = (e.target as HTMLInputElement).value;
                    setAttachmentAlts(prev => ({ ...prev, [a.id]: v }));
                  }}
                />
              </label>
            </li>
          ))}
        </ul>
      )}
      {attachments.length > 0 &&
        attachments.some(x => !(attachmentAlts[x.id] ?? '').trim()) && (
          <p class="composer-alt-reminder" role="status">
            Tip: add alt text so people using screen readers understand your images.
          </p>
        )}

      <div class="composer-toolbar">
        <div class="composer-toolbar-left">
          <button
            type="button"
            class="btn btn-outline composer-add-images"
            disabled={posting || Boolean(quoteEmbed)}
            title={`Add any number of images. Bluesky allows ${MAX_IMAGES_PER_POST} per post; Forumsky sends the rest as your replies in the same thread.`}
            onClick={() => fileInputRef.current?.click()}
          >
            Add images
          </button>
          <CharCounter
            current={blueskyPostCount === 1 ? charCounterSingleLen : maxSegLen}
            max={COMPOSER_MAX_CHARS}
            multi={blueskyPostCount > 1}
            totalChars={blueskyPostCount > 1 ? totalPublishChars : undefined}
          />
        </div>
        <div class="composer-toolbar-right">
          {blueskyPostCount > 1 && (
            <span class="composer-toolbar-postcount">
              {blueskyPostCount} Bluesky posts
            </span>
          )}
          {onCancel && (
            <button
              type="button"
              class="btn btn-outline"
              disabled={posting}
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            class="btn btn-primary"
            disabled={posting || !canSubmit}
          >
            {posting
              ? 'Posting…'
              : quoteEmbed
                ? 'Post quote'
                : replyTo
                  ? 'Reply'
                  : 'Post thread'}
          </button>
        </div>
      </div>

      {community && !replyTo && !quoteEmbed && (
        <div class="composer-community-tag-foot">
          <div class="composer-community-tag-row">
            <span class="composer-community-tag-label">Community tag</span>
            <span class="composer-community-tag-value">#{community}</span>
          </div>
          <p class="composer-community-tag-hint">
            Added to the end of your first Bluesky post when you publish. You do not need to type it in the box above.
          </p>
        </div>
      )}
    </form>
  );
}

function CharCounter({
  current,
  max,
  multi,
  totalChars,
}: {
  current: number;
  max: number;
  multi?: boolean;
  totalChars?: number;
}) {
  const cls = current > max ? 'char-counter over' : current > max - 30 ? 'char-counter warn' : 'char-counter';
  if (multi && totalChars !== undefined) {
    return (
      <span class={cls} title="Longest segment must be ≤300; two line breaks split posts">
        longest segment {current}/{max} · {totalChars} chars total
      </span>
    );
  }
  return <span class={cls}>{current}/{max}</span>;
}
