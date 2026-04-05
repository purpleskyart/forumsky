import { useState, useMemo, useRef, useEffect, useCallback } from 'preact/hooks';
import {
  getFollowingFeedBlend,
  setFollowingFeedBlend,
  type FollowingBlendSource,
} from '@/lib/preferences';
import { getFeedGenerator } from '@/api/feed';
import { getActorPreferences } from '@/api/actor';
import { getOAuthSession } from '@/api/xrpc';
import {
  parseSavedGeneratorFeedsFromPreferences,
  FEED_GENERATOR_URI_RE,
  type SavedGeneratorFeedRef,
} from '@/lib/saved-feed-preferences';
import { showToast } from '@/lib/store';

const BLEND_WEIGHT_STEP = 5;
const BLEND_WEIGHT_MIN = 1;
const BLEND_WEIGHT_MAX = 200;

function sharePercent(weights: number[], i: number): string {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return '—';
  return `${Math.round((weights[i] / sum) * 100)}%`;
}

async function resolveFeedLabels(uris: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const chunk = 6;
  for (let i = 0; i < uris.length; i += chunk) {
    const slice = uris.slice(i, i + chunk);
    await Promise.all(
      slice.map(async uri => {
        try {
          const gen = await getFeedGenerator(uri);
          const name = gen.view?.displayName?.trim();
          if (name) out[uri] = name;
        } catch {
          /* keep uri-only */
        }
      }),
    );
  }
  return out;
}

interface Props {
  onConfigChanged: () => void;
}

export function FollowingFeedMixPanel({ onConfigChanged }: Props) {
  const [sources, setSources] = useState<FollowingBlendSource[]>(() => getFollowingFeedBlend());
  const [open, setOpen] = useState(false);
  const [mixEditing, setMixEditing] = useState(false);
  const [addingUri, setAddingUri] = useState('');
  const [busy, setBusy] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [accountFeeds, setAccountFeeds] = useState<SavedGeneratorFeedRef[]>([]);
  const [feedLabels, setFeedLabels] = useState<Record<string, string>>({});
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const weightRow = useMemo(() => sources.map(s => (s.enabled ? Math.max(1, s.weight) : 0)), [sources]);

  const customUrisInMix = useMemo(
    () => new Set(sources.filter(s => s.kind === 'custom' && s.feedUri).map(s => s.feedUri!)),
    [sources],
  );

  const hasCustomFeeds = useMemo(() => sources.some(s => s.kind === 'custom'), [sources]);

  const showRemoveColumn = mixEditing && hasCustomFeeds;

  const pinnedAccountFeeds = useMemo(
    () => accountFeeds.filter(f => f.pinned).sort((a, b) => {
      const la = (feedLabels[a.uri] || a.uri).toLowerCase();
      const lb = (feedLabels[b.uri] || b.uri).toLowerCase();
      return la.localeCompare(lb);
    }),
    [accountFeeds, feedLabels],
  );

  const suggestionMatches = useMemo(() => {
    const q = addingUri.trim().toLowerCase();
    if (q.length < 1 || accountFeeds.length === 0) return [];
    const scored = accountFeeds
      .map(f => {
        const label = (feedLabels[f.uri] || '').toLowerCase();
        const uri = f.uri.toLowerCase();
        const hit = uri.includes(q) || label.includes(q);
        if (!hit) return null;
        return { ...f, sortKey: `${f.pinned ? '0' : '1'}${(feedLabels[f.uri] || f.uri).toLowerCase()}` };
      })
      .filter(Boolean) as (SavedGeneratorFeedRef & { sortKey: string })[];
    scored.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    return scored.slice(0, 12);
  }, [addingUri, accountFeeds, feedLabels]);

  useEffect(() => {
    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  const reloadFromStorage = () => {
    setSources(getFollowingFeedBlend());
  };

  const scheduleFeedReload = () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      onConfigChanged();
    }, 450);
  };

  const persist = (
    next: FollowingBlendSource[],
    opts?: { reload?: 'immediate' | 'debounced' | 'none' },
  ) => {
    const enabled = next.filter(s => s.enabled && s.weight > 0);
    if (enabled.length === 0) {
      showToast('Keep at least one feed enabled.');
      return;
    }
    setFollowingFeedBlend(next);
    reloadFromStorage();
    const r = opts?.reload ?? 'immediate';
    if (r === 'immediate') onConfigChanged();
    else if (r === 'debounced') scheduleFeedReload();
  };

  const updateSource = (id: string, patch: Partial<FollowingBlendSource>) => {
    const reload =
      'weight' in patch && Object.keys(patch).length === 1 ? 'debounced' : 'immediate';
    persist(
      sources.map(s => (s.id === id ? { ...s, ...patch } : s)),
      { reload },
    );
  };

  const removeCustom = (id: string) => {
    persist(sources.filter(s => s.id !== id));
  };

  const addCustomFeedByUri = useCallback(async (rawUri: string) => {
    const uri = rawUri.trim();
    if (!FEED_GENERATOR_URI_RE.test(uri)) {
      showToast('Paste a feed URI like at://did/app.bsky.feed.generator/slug');
      return false;
    }
    const current = getFollowingFeedBlend();
    if (current.some(s => s.kind === 'custom' && s.feedUri === uri)) {
      showToast('That feed is already in the list.');
      return false;
    }
    setBusy(true);
    try {
      let label = feedLabels[uri] || 'Custom feed';
      if (label === 'Custom feed' || !label) {
        try {
          const gen = await getFeedGenerator(uri);
          if (gen.view?.displayName?.trim()) label = gen.view.displayName.trim();
        } catch {
          /* keep */
        }
      }
      const row: FollowingBlendSource = {
        id: crypto.randomUUID(),
        kind: 'custom',
        feedUri: uri,
        label,
        enabled: true,
        weight: Math.max(1, Math.round(current[0]?.weight ? current[0].weight / 2 : 50)),
      };
      persist([...current, row]);
      setAddingUri('');
      setSuggestOpen(false);
      showToast(`Added "${label}"`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not verify feed';
      showToast(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }, [feedLabels]);

  const addCustom = async (e: Event) => {
    e.preventDefault();
    await addCustomFeedByUri(addingUri);
  };

  useEffect(() => {
    if (!open) {
      setMixEditing(false);
      setPrefsLoaded(false);
      return;
    }
    if (!getOAuthSession()) {
      return;
    }
    let cancelled = false;
    (async () => {
      setPrefsLoading(true);
      try {
        const { preferences } = await getActorPreferences();
        if (cancelled) return;
        const list = parseSavedGeneratorFeedsFromPreferences(preferences);
        setAccountFeeds(list);
        const uris = [...new Set(list.map(f => f.uri))];
        const labels = await resolveFeedLabels(uris);
        if (cancelled) return;
        setFeedLabels(labels);
        setPrefsLoaded(true);
      } catch {
        if (!cancelled) {
          setAccountFeeds([]);
          setFeedLabels({});
          setPrefsLoaded(true);
        }
      } finally {
        if (!cancelled) setPrefsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!hasCustomFeeds) setMixEditing(false);
  }, [hasCustomFeeds]);

  useEffect(() => {
    setSuggestIndex(0);
  }, [addingUri, suggestionMatches.length]);

  const cancelBlur = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  };

  const scheduleCloseSuggest = () => {
    cancelBlur();
    blurTimer.current = setTimeout(() => {
      blurTimer.current = null;
      setSuggestOpen(false);
    }, 180);
  };

  const onAddKeyDown = (e: KeyboardEvent) => {
    if (!suggestOpen || suggestionMatches.length === 0) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setSuggestOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestIndex(i => Math.min(i + 1, suggestionMatches.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestIndex(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && suggestionMatches.length > 0) {
      const pick = suggestionMatches[suggestIndex];
      if (pick && document.activeElement === addInputRef.current) {
        e.preventDefault();
        void addCustomFeedByUri(pick.uri);
      }
    }
  };

  return (
    <div class="following-feed-mix">
      <div class="following-feed-mix-toggle-wrap">
        <button
          type="button"
          class="btn btn-outline btn-sm following-feed-mix-toggle"
          onClick={() => {
            setOpen(o => !o);
            if (!open) reloadFromStorage();
          }}
          aria-expanded={open}
        >
          {open ? '▼' : '▶'} Feed mix
        </button>
      </div>
      {open && (
        <div class="panel following-feed-mix-panel">
          {hasCustomFeeds && (
            <div class="following-feed-mix-panel-head">
              <button
                type="button"
                class="btn btn-outline btn-sm following-feed-mix-edit-btn"
                onClick={() => setMixEditing(e => !e)}
                aria-pressed={mixEditing}
              >
                {mixEditing ? 'Done' : 'Edit'}
              </button>
            </div>
          )}
          <div class="following-feed-mix-table">
            {sources.map((s, idx) => (
              <div
                key={s.id}
                class={`following-feed-mix-row${showRemoveColumn ? ' is-editing-mix' : ''}`}
              >
                <button
                  type="button"
                  class={`following-feed-mix-name-btn${s.enabled ? '' : ' is-off'}`}
                  onClick={() => updateSource(s.id, { enabled: !s.enabled })}
                  aria-pressed={s.enabled}
                  title={s.enabled ? 'In mix — click to turn off' : 'Off — click to include in mix'}
                >
                  {s.label}
                </button>
                <div class="following-feed-mix-weight-btns">
                  <button
                    type="button"
                    class="btn btn-outline btn-sm following-feed-mix-weight-btn"
                    disabled={!s.enabled || s.weight <= BLEND_WEIGHT_MIN}
                    aria-label={`Less from ${s.label}`}
                    onClick={() => {
                      const w = Math.max(BLEND_WEIGHT_MIN, s.weight - BLEND_WEIGHT_STEP);
                      updateSource(s.id, { weight: w });
                    }}
                  >
                    −
                  </button>
                  <span
                    class="following-feed-mix-weight-val"
                    title={
                      s.enabled
                        ? 'Share of posts from this source (recent activity sort)'
                        : undefined
                    }
                  >
                    {s.enabled ? sharePercent(weightRow, idx) : '—'}
                  </span>
                  <button
                    type="button"
                    class="btn btn-outline btn-sm following-feed-mix-weight-btn"
                    disabled={!s.enabled || s.weight >= BLEND_WEIGHT_MAX}
                    aria-label={`More from ${s.label}`}
                    onClick={() => {
                      const w = Math.min(BLEND_WEIGHT_MAX, s.weight + BLEND_WEIGHT_STEP);
                      updateSource(s.id, { weight: w });
                    }}
                  >
                    +
                  </button>
                </div>
                {showRemoveColumn &&
                  (s.kind === 'custom' ? (
                    <button
                      type="button"
                      class="following-feed-mix-remove"
                      onClick={() => removeCustom(s.id)}
                      aria-label={`Remove custom feed "${s.label}" from this mix`}
                      title="Remove this custom feed from the mix"
                    >
                      Remove
                    </button>
                  ) : (
                    <span class="following-feed-mix-remove-slot" aria-hidden="true" />
                  ))}
              </div>
            ))}
          </div>

          {getOAuthSession() && pinnedAccountFeeds.length > 0 && (
            <div class="following-feed-mix-pinned">
              <span class="following-feed-mix-pinned-label">Pinned:</span>
              {pinnedAccountFeeds.map(f => {
                const inMix = customUrisInMix.has(f.uri);
                const label = feedLabels[f.uri] || 'Custom feed';
                return (
                  <button
                    key={f.uri}
                    type="button"
                    class={`following-feed-mix-chip${inMix ? ' is-in-mix' : ''}`}
                    disabled={busy || inMix}
                    onClick={() => void addCustomFeedByUri(f.uri)}
                    title={inMix ? 'Already in mix' : `Add ${label}`}
                  >
                    {label}{inMix && ' ✓'}
                  </button>
                );
              })}
              {prefsLoading && <span class="following-feed-mix-prefs-hint">Loading…</span>}
            </div>
          )}

          <form class="following-feed-mix-add" onSubmit={addCustom}>
            <div class="following-feed-mix-add-field-wrap">
              <input
                ref={addInputRef}
                type="text"
                placeholder="Add feed by URI…"
                value={addingUri}
                disabled={busy}
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded={suggestOpen && suggestionMatches.length > 0}
                onFocus={() => {
                  cancelBlur();
                  if (getOAuthSession() && addingUri.trim().length > 0 && suggestionMatches.length > 0) {
                    setSuggestOpen(true);
                  }
                }}
                onBlur={scheduleCloseSuggest}
                onInput={(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  setAddingUri(v);
                  if (getOAuthSession() && v.trim().length > 0) setSuggestOpen(true);
                  else setSuggestOpen(false);
                }}
                onKeyDown={onAddKeyDown}
                style="flex:1;min-width:0;width:100%"
              />
              {suggestOpen && suggestionMatches.length > 0 && (
                <ul
                  class="following-feed-mix-suggest"
                  role="listbox"
                  onMouseDown={e => e.preventDefault()}
                >
                  {suggestionMatches.map((f, i) => (
                    <li key={f.uri} role="option" aria-selected={i === suggestIndex}>
                      <button
                        type="button"
                        class={`following-feed-mix-suggest-btn${i === suggestIndex ? ' is-active' : ''}`}
                        onMouseEnter={() => setSuggestIndex(i)}
                        onClick={() => void addCustomFeedByUri(f.uri)}
                      >
                        <span class="following-feed-mix-suggest-title">
                          {feedLabels[f.uri] || 'Custom feed'}
                          {f.pinned ? (
                            <span class="following-feed-mix-suggest-pin" title="Pinned in Bluesky">
                              {' '}
                              ★
                            </span>
                          ) : null}
                        </span>
                        <span class="following-feed-mix-suggest-uri">{f.uri}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="submit" class="btn btn-primary btn-sm" disabled={busy}>
              {busy ? '…' : 'Add'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
