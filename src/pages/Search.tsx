import { useState, useEffect, useMemo } from 'preact/hooks';
import { searchPosts, parseAtUri } from '@/api/feed';
import { searchActors } from '@/api/actor';
import { listAllFollowingDids } from '@/api/graph-follows';
import { currentUser, showToast } from '@/lib/store';
import { hrefForAppPath } from '@/lib/app-base-path';
import { threadUrl, navigate, SPA_ANCHOR_SHIELD, spaNavigateClick, profileUrl } from '@/lib/router';
import { formatThreadTitlePreviewLine } from '@/lib/thread-title';
import type { PostView, ProfileView } from '@/api/types';

type Scope = 'global' | 'following' | 'me' | 'users';

function readScope(s: string | null): Scope {
  if (s === 'following' || s === 'me' || s === 'users') return s;
  return 'global';
}

export function Search() {
  const params =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const initialQ = params.get('q') ?? '';
  const initialScope = readScope(params.get('scope'));

  const [q, setQ] = useState(initialQ);
  const [scope, setScope] = useState<Scope>(initialScope);
  const [posts, setPosts] = useState<PostView[]>([]);
  const [users, setUsers] = useState<ProfileView[]>([]);
  const [loading, setLoading] = useState(false);
  const [followingSet, setFollowingSet] = useState<Set<string>>(new Set());

  const user = currentUser.value;

  useEffect(() => {
    if (!user?.did || scope !== 'following') return;
    let cancelled = false;
    listAllFollowingDids()
      .then(set => {
        if (!cancelled) setFollowingSet(set);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.did, scope]);

  const searchQuery = useMemo(() => {
    const t = q.trim();
    if (!t) return '';
    if (scope === 'me' && user?.handle) return `from:${user.handle} ${t}`;
    return t;
  }, [q, scope, user?.handle]);

  useEffect(() => {
    const run = async () => {
      if (!searchQuery) {
        setPosts([]);
        setUsers([]);
        return;
      }
      setLoading(true);
      try {
        if (scope === 'users') {
          const actorResults = await searchActors(searchQuery, { limit: 50 });
          setUsers(actorResults);
          setPosts([]);
        } else {
          const res = await searchPosts(searchQuery, { limit: 50, sort: 'latest' });
          let list = res.posts.filter(p => !p.record?.reply);
          if (scope === 'following' && followingSet.size > 0) {
            list = list.filter(p => followingSet.has(p.author.did));
          }
          setPosts(list);
          setUsers([]);
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Search failed');
        setPosts([]);
        setUsers([]);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [searchQuery, scope, followingSet]);

  const onSubmit = (e: Event) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    p.set('scope', scope);
    window.history.replaceState(null, '', `/search?${p.toString()}`);
    /* effect re-runs via searchQuery from state — already same; bump by re-setting q */
    setQ(q.trim());
  };

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
        <span>Search</span>
      </div>

      <div class="search-page-sticky-form">
        <form class="search-page-form" onSubmit={onSubmit}>
          <input
            type="search"
            class="search-page-input"
            placeholder="Search posts…"
            value={q}
            onInput={(e: Event) => setQ((e.target as HTMLInputElement).value)}
          />
          <select
            class="search-page-scope"
            value={scope}
            onChange={(e: Event) => setScope((e.target as HTMLSelectElement).value as Scope)}
          >
            <option value="global">All</option>
            <option value="users">Users</option>
            <option value="following" disabled={!user?.did}>
              From people you follow
            </option>
            <option value="me" disabled={!user?.did}>
              My posts
            </option>
          </select>
          <button type="submit" class="btn btn-primary">
            Search
          </button>
        </form>
        <p class="community-sort-hint search-page-hint">
          The All scope searches all of Bluesky. "Following" filters results to accounts you follow. "My posts" adds a{' '}
          <code>from:your.handle</code> prefix.
        </p>
      </div>

      <div class="panel search-results-panel">
        {loading ? (
          <div class="loading">
            <div class="spinner" />
          </div>
        ) : scope === 'users' ? (
          users.length === 0 ? (
            <div class="empty">
              <p>{searchQuery ? 'No matching users found.' : 'Enter a query to search for users.'}</p>
            </div>
          ) : (
            <ul class="search-results-list">
              {users.map(u => (
                <li key={u.did} class="search-results-item">
                  <a
                    href={hrefForAppPath(profileUrl(u.handle))}
                    class="search-results-title"
                    {...SPA_ANCHOR_SHIELD}
                    onClick={spaNavigateClick(profileUrl(u.handle))}
                  >
                    {u.displayName || u.handle}
                  </a>
                  <div class="search-results-meta">
                    @{u.handle}
                    {u.description && ` · ${u.description.slice(0, 50)}${u.description.length > 50 ? '...' : ''}`}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : posts.length === 0 ? (
          <div class="empty">
            <p>{searchQuery ? 'No matching thread roots found.' : 'Enter a query to search.'}</p>
          </div>
        ) : (
          <ul class="search-results-list">
            {posts.map(p => {
              const parsed = parseAtUri(p.uri);
              const href = parsed ? threadUrl(p.author.handle || p.author.did, parsed.rkey) : '#';
              const title = formatThreadTitlePreviewLine(p.record.text.split('\n')[0]);
              return (
                <li key={p.uri} class="search-results-item">
                  <a
                    href={hrefForAppPath(href)}
                    class="search-results-title"
                    {...SPA_ANCHOR_SHIELD}
                    onClick={spaNavigateClick(href)}
                  >
                    {title}
                  </a>
                  <div class="search-results-meta">
                    @{p.author.handle} · {p.indexedAt.slice(0, 10)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
