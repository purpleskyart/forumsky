import { franc } from 'franc-min';

/** ISO 639-3 codes where the first two letters are not the usual BCP 47 primary tag. */
const ISO639_3_TO_BCP47: Record<string, string> = {
  cmn: 'zh',
  zho: 'zh',
  yue: 'zh',
  nob: 'no',
  nno: 'no',
  bod: 'bo',
  ces: 'cs',
  cym: 'cy',
  dan: 'da',
  deu: 'de',
  ell: 'el',
  epo: 'eo',
  est: 'et',
  eus: 'eu',
  fas: 'fa',
  fra: 'fr',
  hrv: 'hr',
  hye: 'hy',
  isl: 'is',
  kat: 'ka',
  lat: 'la',
  lit: 'lt',
  lav: 'lv',
  msa: 'ms',
  mya: 'my',
  nld: 'nl',
  pan: 'pa',
  pol: 'pl',
  por: 'pt',
  roh: 'rm',
  ron: 'ro',
  slk: 'sk',
  slv: 'sl',
  sqi: 'sq',
  srp: 'sr',
  swa: 'sw',
  tam: 'ta',
  tha: 'th',
  tuk: 'tk',
  ukr: 'uk',
  urd: 'ur',
  uzb: 'uz',
  vie: 'vi',
};

export function primaryLanguageTag(locale: string): string {
  const t = locale.trim().toLowerCase().split('-')[0] ?? '';
  return t;
}

function iso6393ToBcp47(iso3: string): string {
  const mapped = ISO639_3_TO_BCP47[iso3];
  if (mapped) return mapped;
  if (iso3.length === 3) return iso3.slice(0, 2);
  return iso3;
}

/**
 * Best-effort language tag for post text (BCP 47 primary, e.g. en, ja, fr).
 * Returns null if the text is too short or ambiguous.
 */
export function detectPostLanguageBcp47(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 12) return null;
  const iso3 = franc(trimmed, { minLength: 10 });
  if (iso3 === 'und') return null;
  return iso6393ToBcp47(iso3);
}

export function navigatorLanguageTags(): string[] {
  if (typeof navigator === 'undefined') return ['en'];
  const list =
    navigator.languages && navigator.languages.length > 0
      ? [...navigator.languages]
      : [navigator.language || 'en'];
  return list.map(primaryLanguageTag);
}

/** True when the post appears to be in a language the user did not list in navigator.languages. */
export function postLanguageDiffersFromUserLocales(
  postBcp47: string | null,
  userPrimaryTags: readonly string[],
): postBcp47 is string {
  if (!postBcp47) return false;
  const p = primaryLanguageTag(postBcp47);
  for (const u of userPrimaryTags) {
    if (p === u) return false;
    if (p.startsWith('zh') && u.startsWith('zh')) return false;
  }
  return true;
}

/** Preferred target language for on-device translation (first UI language). */
export function translationTargetTagFromNavigator(): string {
  if (typeof navigator === 'undefined') return 'en';
  return primaryLanguageTag(navigator.language || 'en');
}
