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
import { swr } from '@/lib/cache';

const BLEND_WEIGHT_STEP = 5;
const BLEND_WEIGHT_MIN = 1;
const BLEND_WEIGHT_MAX = 200;

// SVG icons as components
const ChevronDown = ({ class: className = '' }: { class?: string }) => (
  <svg class={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronRight = ({ class: className = '' }: { class?: string }) => (
  <svg class={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const Plus = ({ class: className = '' }: { class?: string }) => (
  <svg class={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const Trash2 = ({ class: className = '' }: { class?: string }) => (
  <svg class={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const Settings2 = ({ class: className = '' }: { class?: string }) => (
  <svg class={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 7h-9" />
    <path d="M14 17H5" />
    <circle cx="17" cy="17" r="3" />
    <circle cx="7" cy="7" r="3" />
  </svg>
);

const Check = ({ class: className = '' }: { class?: string }) => (
  <svg class={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const Search = ({ class: className = '' }: { class?: string }) => (
  <svg class={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const Sparkles = ({ class: className = '' }: { class?: string }) => (
  <svg class={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" />
    <path d="M9 5H5" />
    <path d="M19 18v4" />
    <path d="M15 20h4" />
  </svg>
);

// Toggle switch component
const ToggleSwitch = ({ 
  checked, 
  onChange, 
  label,
  disabled = false 
}: { 
  checked: boolean; 
  onChange: () => void; 
  label: string;
  disabled?: boolean;
}) => (
  <button
    type="button"
    class={`toggle-switch${checked ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}
    onClick={onChange}
    aria-pressed={checked}
    disabled={disabled}
    title={checked ? `${label} — click to disable` : `${label} — click to enable`}
  >
    <span class="toggle-switch-track">
      <span class="toggle-switch-thumb" />
    </span>
    <span class="toggle-switch-label">{label}</span>
  </button>
);

// Weight slider component
const WeightSlider = ({ 
  value, 
  onChange, 
  disabled = false,
  showPercentage,
}: { 
  value: number; 
  onChange: (val: number) => void; 
  disabled?: boolean;
  showPercentage: string;
}) => {
  const percentage = Math.round(((value - BLEND_WEIGHT_MIN) / (BLEND_WEIGHT_MAX - BLEND_WEIGHT_MIN)) * 100);
  
  return (
    <div class={`weight-slider${disabled ? ' is-disabled' : ''}`}>
      <div class="weight-slider-header">
        <button
          type="button"
          class="weight-step-btn"
          disabled={disabled || value <= BLEND_WEIGHT_MIN}
          onClick={() => onChange(Math.max(BLEND_WEIGHT_MIN, value - BLEND_WEIGHT_STEP))}
          aria-label="Decrease weight"
        >
          −
        </button>
        <span class="weight-value">{disabled ? '—' : showPercentage}</span>
        <button
          type="button"
          class="weight-step-btn"
          disabled={disabled || value >= BLEND_WEIGHT_MAX}
          onClick={() => onChange(Math.min(BLEND_WEIGHT_MAX, value + BLEND_WEIGHT_STEP))}
          aria-label="Increase weight"
        >
          +
        </button>
      </div>
      <div class="weight-slider-bar-wrap">
        <div class="weight-slider-bar-bg" />
        <div 
          class="weight-slider-bar-fill" 
          style={{ width: `${disabled ? 0 : percentage}%` }}
        />
        <input
          type="range"
          min={BLEND_WEIGHT_MIN}
          max={BLEND_WEIGHT_MAX}
          step={BLEND_WEIGHT_STEP}
          value={value}
          disabled={disabled}
          onInput={(e) => onChange(parseInt((e.target as HTMLInputElement).value, 10))}
          class="weight-slider-input"
          aria-label="Feed weight"
        />
      </div>
    </div>
  );
};

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
        const { preferences } = await swr('user_prefs', () => getActorPreferences(), 300_000);
        if (cancelled) return;
        const list = parseSavedGeneratorFeedsFromPreferences(preferences);
        setAccountFeeds(list);
        const uris = [...new Set(list.map(f => f.uri))];
        const labels = await swr(`feed_labels_${uris.sort().join(',')}`, () => resolveFeedLabels(uris), 600_000);
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
      <button
        type="button"
        class="feed-mix-toggle"
        onClick={() => {
          setOpen(o => !o);
          if (!open) reloadFromStorage();
        }}
        aria-expanded={open}
      >
        <Sparkles class="toggle-icon" />
        <span class="toggle-text">Feed mix</span>
        <ChevronDown class={`toggle-chevron${open ? ' is-open' : ''}`} />
      </button>
      
      {open && (
        <div class="feed-mix-panel">
          <div class="feed-mix-header">
            <div class="feed-mix-title">
              <Settings2 class="title-icon" />
              <span>Configure your feed blend</span>
            </div>
            {hasCustomFeeds && (
              <button
                type="button"
                class="feed-mix-edit-btn"
                onClick={() => setMixEditing(e => !e)}
                aria-pressed={mixEditing}
              >
                {mixEditing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
          
          <div class="feed-mix-sources">
            {sources.map((s, idx) => (
              <div
                key={s.id}
                class={`feed-mix-source${!s.enabled ? ' is-disabled' : ''}${showRemoveColumn ? ' is-editing' : ''}`}
              >
                <div class="source-main">
                  <ToggleSwitch
                    checked={s.enabled}
                    onChange={() => updateSource(s.id, { enabled: !s.enabled })}
                    label={s.label}
                  />
                  
                  <WeightSlider
                    value={s.weight}
                    onChange={(w) => updateSource(s.id, { weight: w })}
                    disabled={!s.enabled}
                    showPercentage={sharePercent(weightRow, idx)}
                  />
                </div>
                
                {showRemoveColumn && s.kind === 'custom' && (
                  <button
                    type="button"
                    class="source-remove-btn"
                    onClick={() => removeCustom(s.id)}
                    aria-label={`Remove "${s.label}" from mix`}
                    title="Remove feed"
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            ))}
          </div>

          {getOAuthSession() && pinnedAccountFeeds.length > 0 && (
            <div class="feed-mix-pinned">
              <div class="pinned-header">
                <span class="pinned-label">Quick add from pinned feeds</span>
                {prefsLoading && <span class="pinned-loading">Loading…</span>}
              </div>
              <div class="pinned-chips">
                {pinnedAccountFeeds.map(f => {
                  const inMix = customUrisInMix.has(f.uri);
                  const label = feedLabels[f.uri] || 'Custom feed';
                  return (
                    <button
                      key={f.uri}
                      type="button"
                      class={`pinned-chip${inMix ? ' is-in-mix' : ''}`}
                      disabled={busy || inMix}
                      onClick={() => void addCustomFeedByUri(f.uri)}
                      title={inMix ? 'Already in mix' : `Add ${label}`}
                    >
                      {inMix && <Check class="chip-check" />}
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <form class="feed-mix-add" onSubmit={addCustom}>
            <div class="add-input-wrap">
              <Search class="add-input-icon" />
              <input
                ref={addInputRef}
                type="text"
                placeholder="Paste feed URI or search pinned feeds…"
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
              />
              {suggestOpen && suggestionMatches.length > 0 && (
                <ul
                  class="feed-mix-suggest"
                  role="listbox"
                  onMouseDown={e => e.preventDefault()}
                >
                  {suggestionMatches.map((f, i) => (
                    <li key={f.uri} role="option" aria-selected={i === suggestIndex}>
                      <button
                        type="button"
                        class={`suggest-item${i === suggestIndex ? ' is-active' : ''}`}
                        onMouseEnter={() => setSuggestIndex(i)}
                        onClick={() => void addCustomFeedByUri(f.uri)}
                      >
                        <span class="suggest-title">
                          {feedLabels[f.uri] || 'Custom feed'}
                          {f.pinned && (
                            <span class="suggest-pin" title="Pinned in Bluesky">★</span>
                          )}
                        </span>
                        <span class="suggest-uri">{f.uri}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="submit" class="add-submit-btn" disabled={busy}>
              <Plus />
              <span>Add</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
