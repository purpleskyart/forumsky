import { hrefForAppPath } from '@/lib/app-base-path';
import { navigate, SPA_ANCHOR_SHIELD } from '@/lib/router';
import { applyNsfwMediaMode, nsfwMediaMode } from '@/lib/store';
import type { NsfwMediaMode } from '@/lib/preferences';

import { version } from '../../package.json';

export function Settings() {
  const mode = nsfwMediaMode.value;

  const setMode = (m: NsfwMediaMode) => {
    applyNsfwMediaMode(m);
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
        <span>Settings</span>
      </div>

      <div class="panel">
        <div class="panel-header">Settings</div>
        <div class="panel-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 0, lineHeight: 1.45 }}>
            Preferences are stored in this browser only. Sensitive media uses labels from Bluesky (for example
            adult or sexual content) when the network provides them.
          </p>

          <h3 class="settings-section-title">Sensitive media</h3>
          <div class="settings-nsfw-options" role="radiogroup" aria-label="Sensitive media display">
            <label class="settings-nsfw-option">
              <input
                type="radio"
                name="nsfw-media"
                checked={mode === 'show'}
                onChange={() => setMode('show')}
              />
              <span>
                <strong>Show</strong> — display images and videos normally (may include explicit content).
              </span>
            </label>
            <label class="settings-nsfw-option">
              <input
                type="radio"
                name="nsfw-media"
                checked={mode === 'blur'}
                onChange={() => setMode('blur')}
              />
              <span>
                <strong>Blur</strong> — hide labeled media behind a blur until you tap “Show media” (default).
              </span>
            </label>
            <label class="settings-nsfw-option">
              <input
                type="radio"
                name="nsfw-media"
                checked={mode === 'hide'}
                onChange={() => setMode('hide')}
              />
              <span>
                <strong>Disable</strong> — do not show labeled images or videos (placeholder only).
              </span>
            </label>
          </div>

          <div class="settings-footer">
            <div class="settings-version">
              ForumSky v{version}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
