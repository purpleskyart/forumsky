/**
 * Online translation fallbacks (no ForumSky API keys). Used only when on-device translation is unavailable.
 * MyMemory: https://mymemory.translated.net/doc/spec.php
 */

import { primaryLanguageTag } from '@/lib/post-language';

const CHUNK_MAX = 420;

type MyMemoryJson = {
  responseData?: { translatedText?: string };
  responseStatus?: number;
  quotaFinished?: boolean;
};

function normalizeForMyMemory(code: string, role: 'source' | 'target'): string {
  const c = primaryLanguageTag(code);
  if (c === 'nb') return 'no';
  if (c === 'zh') return role === 'target' ? 'zh-CN' : 'zh';
  if (c === 'he') return 'iw';
  return c;
}

function splitIntoChunks(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= CHUNK_MAX) return [t];
  const chunks: string[] = [];
  let rest = t;
  while (rest.length > CHUNK_MAX) {
    let slice = rest.slice(0, CHUNK_MAX);
    let cut =
      slice.lastIndexOf('\n\n') >= 80
        ? slice.lastIndexOf('\n\n') + 2
        : slice.lastIndexOf('\n') >= 60
          ? slice.lastIndexOf('\n') + 1
          : slice.lastIndexOf(' ') >= 40
            ? slice.lastIndexOf(' ') + 1
            : CHUNK_MAX;
    if (cut < 40) cut = CHUNK_MAX;
    let part = rest.slice(0, cut).trimEnd();
    if (!part) {
      part = rest.slice(0, CHUNK_MAX);
      cut = CHUNK_MAX;
    }
    chunks.push(part);
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/** Public Lingva instances (REST: GET /api/v1/:source/:target/:query → { translation }). */
const LINGVA_HOSTS = [
  'lingva.garudalinux.org',
  'lingva.lunar.icu',
  'translate.dr460nf1r3.org',
] as const;

function lingvaLanguageTag(code: string): string {
  const c = primaryLanguageTag(code);
  if (c === 'nb') return 'no';
  if (c.startsWith('zh')) return 'zh';
  return c;
}

async function translateChunkLingva(
  chunk: string,
  sourceBcp47: string,
  targetBcp47: string,
): Promise<string | null> {
  const tgt = lingvaLanguageTag(targetBcp47);
  const srcNorm = lingvaLanguageTag(sourceBcp47);
  const srcPath = srcNorm === tgt ? 'auto' : srcNorm;
  const encodedQuery = encodeURIComponent(chunk);
  for (const host of LINGVA_HOSTS) {
    const url = `https://${host}/api/v1/${encodeURIComponent(srcPath)}/${encodeURIComponent(tgt)}/${encodedQuery}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as { translation?: string; error?: string };
      if (data.error) continue;
      const out = data.translation?.trim();
      if (out) return out;
    } catch {
      continue;
    }
  }
  return null;
}

async function translateChunkMyMemory(
  chunk: string,
  sourceBcp47: string,
  targetBcp47: string,
): Promise<string | null> {
  const tgt = normalizeForMyMemory(targetBcp47, 'target');
  const srcNorm = normalizeForMyMemory(sourceBcp47, 'source');
  const langpairs =
    srcNorm === tgt
      ? [`autodetect|${tgt}`]
      : [`${srcNorm}|${tgt}`, `autodetect|${tgt}`];

  for (const langpair of langpairs) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${encodeURIComponent(langpair)}`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok) continue;
    let data: MyMemoryJson;
    try {
      data = (await res.json()) as MyMemoryJson;
    } catch {
      continue;
    }
    if (data.quotaFinished) continue;
    if (data.responseStatus !== 200) continue;
    const out = data.responseData?.translatedText?.trim();
    if (!out) continue;
    if (/QUERY LENGTH LIMIT|LIMIT EXCEEDED|INVALID LANGUAGE PAIR/i.test(out)) continue;
    return out;
  }
  return null;
}

async function translateAllChunks(
  chunks: string[],
  translateChunk: (
    chunk: string,
    sourceBcp47: string,
    targetBcp47: string,
  ) => Promise<string | null>,
  sourceBcp47: string,
  targetBcp47: string,
  delayMs: number,
): Promise<string | null> {
  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const part = await translateChunk(chunks[i]!, sourceBcp47, targetBcp47);
    if (part == null) return null;
    parts.push(part);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return parts.join('\n\n');
}

export type ThirdPartyTranslationVia = 'mymemory' | 'lingva';

export async function translateWithThirdPartyServices(
  text: string,
  sourceBcp47: string,
  targetBcp47: string,
): Promise<
  { ok: true; text: string; via: ThirdPartyTranslationVia } | { ok: false }
> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };

  const src = primaryLanguageTag(sourceBcp47);
  const tgt = primaryLanguageTag(targetBcp47);
  if (src === tgt) return { ok: false };

  const chunks = splitIntoChunks(trimmed);
  if (chunks.length === 0) return { ok: false };

  const viaMemory = await translateAllChunks(
    chunks,
    translateChunkMyMemory,
    sourceBcp47,
    targetBcp47,
    120,
  );
  if (viaMemory != null) return { ok: true, text: viaMemory, via: 'mymemory' };

  const viaLingva = await translateAllChunks(
    chunks,
    translateChunkLingva,
    sourceBcp47,
    targetBcp47,
    200,
  );
  if (viaLingva != null) return { ok: true, text: viaLingva, via: 'lingva' };

  return { ok: false };
}
