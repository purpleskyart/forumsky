import { useState, useRef, useEffect } from 'preact/hooks';
import { showAuthDialog } from '@/lib/store';
import type { ProfileView } from '@/api/types';

const SEARCH_DEBOUNCE_MS = 220;
const MIN_QUERY_LEN = 2;

export function AuthDialog() {
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<ProfileView[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const debounceRef = useRef<number | undefined>();
  const listId = 'auth-handle-suggestions';

  if (!showAuthDialog.value) return null;

  const close = () => {
    showAuthDialog.value = false;
    setError('');
    setHandle('');
    setSuggestions([]);
    setHighlight(-1);
  };

  const runSearch = async (raw: string) => {
    const q = raw.trim().replace(/^@+/, '');
    if (q.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setSuggestLoading(false);
      return;
    }
    setSuggestLoading(true);
    try {
      const { searchActors } = await import('@/api/actor');
      const actors = await searchActors(q, { limit: 8 });
      setSuggestions(actors);
      setHighlight(-1);
    } catch {
      setSuggestions([]);
      setHighlight(-1);
    } finally {
      setSuggestLoading(false);
    }
  };

  const scheduleSearch = (raw: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = raw.trim().replace(/^@+/, '');
    if (q.length < MIN_QUERY_LEN) {
      setSuggestions([]);
      setSuggestLoading(false);
      setHighlight(-1);
      return;
    }
    setSuggestLoading(true);
    debounceRef.current = window.setTimeout(() => {
      void runSearch(raw);
    }, SEARCH_DEBOUNCE_MS);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const pickSuggestion = (actor: ProfileView) => {
    setHandle(actor.handle);
    setSuggestions([]);
    setHighlight(-1);
  };

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (!handle.trim()) return;

    if (window.location.hostname === 'localhost') {
      const newUrl = window.location.href.replace('localhost', '127.0.0.1');
      window.location.href = newUrl;
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { signIn } = await import('@/api/auth');
      await signIn(handle.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to sign in';
      setError(msg);
      setLoading(false);
    }
  };

  const onInput = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    setHandle(v);
    scheduleSearch(v);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!suggestions.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(i => {
        if (i < 0) return 0;
        return (i + 1) % suggestions.length;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(i => {
        if (i < 0) return suggestions.length - 1;
        return i <= 0 ? suggestions.length - 1 : i - 1;
      });
    } else if (e.key === 'Enter' && highlight >= 0 && suggestions[highlight]) {
      e.preventDefault();
      pickSuggestion(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setHighlight(-1);
    }
  };

  return (
    <div class="auth-overlay" onClick={(e: Event) => { if (e.target === e.currentTarget) close(); }}>
      <div class="auth-dialog">
        <h2>Sign in with Bluesky</h2>
        <form onSubmit={onSubmit} autoComplete="off">
          <label for="auth-handle-input">Your Bluesky handle</label>
          <div class="auth-handle-wrap">
            <input
              id="auth-handle-input"
              type="text"
              name="bsky-handle"
              placeholder="handle.bsky.social"
              value={handle}
              onInput={onInput}
              onKeyDown={onKeyDown}
              disabled={loading}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellcheck={false}
              aria-autocomplete="list"
              aria-controls={suggestions.length ? listId : undefined}
              aria-expanded={suggestions.length > 0}
              autofocus
            />
            {(suggestLoading || suggestions.length > 0) && (
              <ul
                id={listId}
                class="auth-suggestions"
                role="listbox"
                aria-label="Matching accounts"
              >
                {suggestLoading && suggestions.length === 0 && (
                  <li class="auth-suggestion auth-suggestion-loading" role="presentation">
                    Searching…
                  </li>
                )}
                {suggestions.map((actor, i) => (
                  <li
                    key={actor.did}
                    role="option"
                    aria-selected={i === highlight}
                    class={`auth-suggestion${i === highlight ? ' is-active' : ''}`}
                    onMouseDown={(e: Event) => e.preventDefault()}
                    onClick={() => pickSuggestion(actor)}
                    onMouseEnter={() => setHighlight(i)}
                  >
                    {actor.avatar && (
                      <img class="auth-suggestion-avatar" src={actor.avatar} alt="" width={28} height={28} loading="lazy" aria-hidden="true" />
                    )}
                    <div class="auth-suggestion-text">
                      <div class="auth-suggestion-name">
                        {actor.displayName || actor.handle}
                      </div>
                      <div class="auth-suggestion-handle">@{actor.handle}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && (
            <p style="color:var(--danger);font-size:0.82rem;margin-bottom:12px">{error}</p>
          )}
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button type="button" class="btn btn-outline" onClick={close} disabled={loading}>
              Cancel
            </button>
            <button type="submit" class="btn btn-primary" disabled={loading || !handle.trim()}>
              {loading ? 'Redirecting...' : 'Login'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
