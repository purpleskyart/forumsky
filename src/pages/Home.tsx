import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'preact/hooks';
import { CommunityCard } from '@/components/CommunityCard';
import {
  getCommunities,
  type CommunityConfig,
  addCommunity,
  removeCommunity,
  resetCommunities,
  FOLLOWED_COMMUNITY,
} from '@/lib/preferences';
import { searchPosts, getTimeline } from '@/api/feed';
import { swr } from '@/lib/cache';
import { currentUser, showAuthDialog } from '@/lib/store';
import { appPathname } from '@/lib/app-base-path';
import { navigate, communityUrl } from '@/lib/router';

interface CommunityPreview {
  lastPost: { title: string; author: string; date: string } | null;
}

export function Home() {
  const [communities, setCommunities] = useState<CommunityConfig[]>(getCommunities());
  const [previews, setPreviews] = useState<Record<string, CommunityPreview>>({});
  const [followPreview, setFollowPreview] = useState<CommunityPreview | undefined>();
  const [showAdd, setShowAdd] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const user = currentUser.value;

  const categories = useMemo(() => {
    const map = new Map<string, CommunityConfig[]>();
    for (const c of communities) {
      const cat = c.category || 'General';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(c);
    }
    return map;
  }, [communities]);

  /** Same visual order as on-screen rows (Following first, then categories). */
  const homeKbCommunities = useMemo((): CommunityConfig[] => {
    const list: CommunityConfig[] = [FOLLOWED_COMMUNITY];
    for (const [, comms] of categories) {
      list.push(...comms);
    }
    return list;
  }, [categories]);

  const kbIndexByTag = useMemo(() => {
    const m = new Map<string, number>();
    let i = 1;
    for (const [, comms] of categories) {
      for (const c of comms) {
        m.set(c.tag, i++);
      }
    }
    return m;
  }, [categories]);

  const [kbRow, setKbRow] = useState(0);
  const [kbRowOutlineActive, setKbRowOutlineActive] = useState(false);
  const homeKbRef = useRef<CommunityConfig[]>([]);
  const kbRowRef = useRef(0);
  homeKbRef.current = homeKbCommunities;
  kbRowRef.current = kbRow;

  useEffect(() => {
    setKbRow(i => Math.min(i, Math.max(0, homeKbCommunities.length - 1)));
  }, [homeKbCommunities.length]);

  useEffect(() => {
    setKbRowOutlineActive(false);
  }, [communities]);

  useEffect(() => {
    const onPointerDown = () => {
      const path = typeof window !== 'undefined' ? appPathname() : '/communities';
      if (path !== '/communities') return;
      setKbRowOutlineActive(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      const path = typeof window !== 'undefined' ? appPathname() : '/communities';
      if (path !== '/communities') return;
      const tgt = e.target as HTMLElement;
      if (
        tgt.tagName === 'INPUT' ||
        tgt.tagName === 'TEXTAREA' ||
        tgt.tagName === 'SELECT' ||
        tgt.isContentEditable
      ) {
        return;
      }
      const list = homeKbRef.current;
      if (list.length === 0) return;
      const down = e.key === 's' || e.key === 'ArrowDown' || e.key === 'd' || e.key === 'ArrowRight';
      const up = e.key === 'w' || e.key === 'ArrowUp' || e.key === 'a' || e.key === 'ArrowLeft';
      if (down || up) {
        e.preventDefault();
        setKbRowOutlineActive(true);
        setKbRow(i => {
          const max = Math.max(0, list.length - 1);
          return Math.min(max, Math.max(0, i + (down ? 1 : -1)));
        });
        return;
      }
      if (e.key === 'e' || e.key === 'Enter') {
        e.preventDefault();
        const c = list[kbRowRef.current];
        if (!c) return;
        navigate(communityUrl(c.tag));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useLayoutEffect(() => {
    if (!kbRowOutlineActive) return;
    document.getElementById(`home-community-kb-${kbRow}`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [kbRow, kbRowOutlineActive]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      for (const c of communities) {
        try {
          const res = await swr(
            `community_stats_${c.tag}`,
            () => searchPosts(`#${c.tag}`, { limit: 1 }),
            120_000,
          );
          if (cancelled) return;
          const last = res.posts[0];
          setPreviews(prev => ({
            ...prev,
            [c.tag]: {
              lastPost: last ? {
                title: last.record.text.split('\n')[0].slice(0, 50),
                author: last.author.displayName || last.author.handle,
                date: last.indexedAt,
              } : null,
            },
          }));
        } catch {
          if (cancelled) return;
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [communities]);

  useEffect(() => {
    let cancelled = false;
    if (!user?.did) {
      setFollowPreview(undefined);
      return;
    }
    (async () => {
      try {
        const res = await getTimeline({ limit: 40 });
        if (cancelled) return;
        const roots = res.feed
          .map(f => f.post)
          .filter(p => !p.record.reply);
        const last = roots[0];
        setFollowPreview({
          lastPost: last ? {
            title: last.record.text.split('\n')[0].slice(0, 50),
            author: last.author.displayName || last.author.handle,
            date: last.indexedAt,
          } : null,
        });
      } catch {
        if (!cancelled) setFollowPreview(undefined);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.did]);

  const handleAdd = (e: Event) => {
    e.preventDefault();
    if (!newTag.trim()) return;
    const tag = newTag.trim().replace(/^#/, '');
    const name = newName.trim() || tag;
    const desc = newDesc.trim() || `Posts tagged #${tag}`;
    addCommunity({ tag, name, description: desc, category: 'Custom' });
    setCommunities(getCommunities());
    setNewTag('');
    setNewName('');
    setNewDesc('');
    setShowAdd(false);
  };

  const handleReset = () => {
    resetCommunities();
    setCommunities(getCommunities());
  };

  return (
    <div>
      <div class="category-section">
        <div class="panel">
          <div class="category-label">
            Following <span class="eye">&#128065;</span>
          </div>

          <div class="thread-list-header" style="padding:4px 12px">
            <div style="flex:1"></div>
            <div style="width:200px;text-align:right;font-size:0.72rem">Last Post</div>
          </div>

          <div
            id="home-community-kb-0"
            class={kbRowOutlineActive && kbRow === 0 ? 'thread-row-kb-focus' : undefined}
          >
            <CommunityCard
              community={FOLLOWED_COMMUNITY}
              lastPost={user?.did ? followPreview?.lastPost : null}
              onClick={!user?.did ? (e: Event) => { e.preventDefault(); showAuthDialog.value = true; } : undefined}
            />
          </div>
        </div>
      </div>

      {Array.from(categories.entries()).map(([category, comms]) => (
        <div key={category} class="category-section">
          <div class="panel">
            <div class="category-label">
              {category} <span class="eye">&#128065;</span>
            </div>

            <div class="thread-list-header" style="padding:4px 12px">
              <div style="flex:1"></div>
              <div style="width:200px;text-align:right;font-size:0.72rem">Last Post</div>
            </div>

            {comms.map(c => {
              const kbIdx = kbIndexByTag.get(c.tag) ?? 0;
              return (
                <div
                  key={c.tag}
                  id={`home-community-kb-${kbIdx}`}
                  class={kbRowOutlineActive && kbRow === kbIdx ? 'thread-row-kb-focus' : undefined}
                >
                  <CommunityCard
                    community={c}
                    lastPost={previews[c.tag]?.lastPost}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn-outline btn-sm" onClick={() => setShowAdd(!showAdd)}>
          + Add Community
        </button>
        <button class="btn btn-outline btn-sm" onClick={handleReset}>
          Reset Defaults
        </button>
      </div>

      {showAdd && (
        <form class="panel" style="margin-top:12px;padding:12px" onSubmit={handleAdd}>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input
              type="text"
              placeholder="hashtag (e.g. cooking)"
              value={newTag}
              onInput={(e: Event) => setNewTag((e.target as HTMLInputElement).value)}
              style="flex:1;min-width:120px"
            />
            <input
              type="text"
              placeholder="Display name"
              value={newName}
              onInput={(e: Event) => setNewName((e.target as HTMLInputElement).value)}
              style="flex:1;min-width:120px"
            />
            <input
              type="text"
              placeholder="Description"
              value={newDesc}
              onInput={(e: Event) => setNewDesc((e.target as HTMLInputElement).value)}
              style="flex:2;min-width:180px"
            />
            <button type="submit" class="btn btn-primary btn-sm">Add</button>
          </div>
        </form>
      )}
    </div>
  );
}
