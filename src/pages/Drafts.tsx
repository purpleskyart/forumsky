import { hrefForAppPath } from '@/lib/app-base-path';
import { listComposerDrafts, clearComposerDraft } from '@/lib/forumsky-local';
import { navigate, communityUrl, threadUrl } from '@/lib/router';
import { parseAtUri } from '@/api/feed';
import { formatListDateTime } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import { useState, useMemo } from 'preact/hooks';
import { showToast } from '@/lib/store';

function describeDraftKey(key: string): { label: string; href: string | null } {
  if (key.startsWith('thread:')) {
    const uri = key.slice('thread:'.length);
    const p = parseAtUri(uri);
    const label = p ? `Thread reply (${p.rkey.slice(0, 12)}…)` : 'Thread reply';
    return {
      label,
      href: p ? threadUrl(p.repo, p.rkey) : null,
    };
  }
  if (key.startsWith('community:')) {
    const tag = key.slice('community:'.length);
    return { label: `New thread in #${tag}`, href: communityUrl(tag) };
  }
  return { label: key, href: null };
}

export function Drafts() {
  const [tick, setTick] = useState(0);
  const drafts = useMemo(() => listComposerDrafts(), [tick]);

  const refresh = () => setTick(t => t + 1);

  return (
    <div>
      <div class="breadcrumb">
        <a href={hrefForAppPath('/')} onClick={(e: Event) => { e.preventDefault(); navigate('/'); }}>ForumSky</a>
        <span class="sep">&gt;</span>
        <span>{t('drafts.title')}</span>
      </div>

      <div class="panel">
        <div class="panel-header">{t('drafts.title')}</div>
        <p class="drafts-intro">
          Drafts are saved in this browser (text only). Open the linked thread or community to continue
          editing.
        </p>
        {drafts.length === 0 ? (
          <div class="empty">
            <p>{t('drafts.empty')}</p>
          </div>
        ) : (
          <ul class="drafts-list">
            {drafts.map(d => {
              const { label, href } = describeDraftKey(d.key);
              const title = d.threadTitle?.trim();
              const when =
                d.updatedAt > 0
                  ? formatListDateTime(new Date(d.updatedAt).toISOString())
                  : '';
              return (
                <li key={d.key} class="drafts-item">
                  <div class="drafts-item-head">
                    <span class="drafts-item-label">{label}</span>
                    {when && <span class="drafts-item-time">{when}</span>}
                  </div>
                  {title ? <div class="drafts-item-title">{title}</div> : null}
                  <div class="drafts-item-snippet">{d.text.trim().slice(0, 220)}{d.text.length > 220 ? '…' : ''}</div>
                  <div class="drafts-item-actions">
                    {href && (
                      <button
                        type="button"
                        class="btn btn-primary btn-sm"
                        onClick={() => navigate(href)}
                      >
                        Open
                      </button>
                    )}
                    <button
                      type="button"
                      class="btn btn-outline btn-sm"
                      onClick={() => {
                        if (!window.confirm('Delete this draft?')) return;
                        clearComposerDraft(d.key);
                        showToast('Draft discarded');
                        refresh();
                      }}
                    >
                      {t('drafts.discard')}
                    </button>
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
