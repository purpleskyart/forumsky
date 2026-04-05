/**
 * On-device translation (Chrome Built-in AI Translator API) plus helpers when that is unavailable.
 */

import { showToast } from '@/lib/store';
import { primaryLanguageTag } from '@/lib/post-language';

export type LocalTranslateResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'unsupported' | 'unavailable' | 'error' };

export async function translateWithOnDeviceTranslator(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<LocalTranslateResult> {
  if (typeof Translator === 'undefined' || typeof Translator.create !== 'function') {
    return { ok: false, reason: 'unsupported' };
  }
  if (!text.trim() || sourceLanguage === targetLanguage) {
    return { ok: false, reason: 'unavailable' };
  }
  try {
    const availability = await Translator.availability({ sourceLanguage, targetLanguage });
    if (availability === 'unavailable') {
      return { ok: false, reason: 'unavailable' };
    }
    const translator = await Translator.create({ sourceLanguage, targetLanguage });
    try {
      const translated = await translator.translate(text);
      return { ok: true, text: translated };
    } finally {
      translator.destroy();
    }
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Select all text inside `el` so the user can open “Translate” from the context or action menu. */
export function selectElementContentsForPlatformTranslate(el: HTMLElement | null): void {
  if (!el || typeof window === 'undefined') return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function googleTranslateUrlForText(text: string, targetBcp47: string): { url: string; truncated: boolean } {
  const tl = encodeURIComponent(primaryLanguageTag(targetBcp47) || 'en');
  const prefix = `https://translate.google.com/?sl=auto&tl=${tl}&text=`;
  const maxEncodedLen = Math.max(400, 2000 - prefix.length);
  const fullEncoded = encodeURIComponent(text);
  let takeChars = text.length;
  if (fullEncoded.length > maxEncodedLen) {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (encodeURIComponent(text.slice(0, mid)).length <= maxEncodedLen) lo = mid;
      else hi = mid - 1;
    }
    takeChars = lo;
  }
  return {
    url: prefix + encodeURIComponent(text.slice(0, takeChars)),
    truncated: takeChars < text.length,
  };
}

/** Last resort: open Google Translate; copy full text if the URL length limit truncates it. */
export function showPlainTextTranslateOverlay(text: string, targetBcp47: string): void {
  if (typeof window === 'undefined') return;
  const { url: googleUrl, truncated } = googleTranslateUrlForText(text, targetBcp47);
  window.open(googleUrl, '_blank', 'noopener,noreferrer');
  if (truncated) {
    void navigator.clipboard.writeText(text).then(
      () =>
        showToast(
          'Full post copied — the new tab may only show the start; paste there if needed.',
          5000,
        ),
      () => showToast('Could not copy full text — translate from what opened in the new tab.', 5000),
    );
  } else {
    showToast('Opened Google Translate in a new tab.', 3500);
  }
}
