/** Bluesky post text limit */
export const COMPOSER_MAX_CHARS = 300;

/**
 * Splits composer text into Bluesky posts:
 * 1. Two or more consecutive line breaks (`\\n\\n` …) start a new post. A single
 *    `\\n` stays inside the same post. Whitespace between lines does not count—
 *    only actual newline runs delimit (after normalizing `\\r\\n` → `\\n`).
 * 2. Any piece still over 300 chars is split further at sentence/word boundaries.
 */
export function splitComposerSegments(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').trim();
  if (!raw) return [''];

  const paragraphs = raw.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  const chunks = paragraphs.length > 0 ? paragraphs : [raw];

  const out: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= COMPOSER_MAX_CHARS) {
      out.push(chunk);
    } else {
      out.push(...splitLongSegment(chunk));
    }
  }
  return out.length > 0 ? out : [''];
}

function splitLongSegment(text: string): string[] {
  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= COMPOSER_MAX_CHARS) {
      segments.push(remaining);
      break;
    }

    const splitIdx = pickSplitIndex(remaining);

    segments.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return segments;
}

function pickSplitIndex(remaining: string): number {
  let splitIdx = COMPOSER_MAX_CHARS;

  const paraBreak = remaining.lastIndexOf('\n\n', COMPOSER_MAX_CHARS);
  if (paraBreak > COMPOSER_MAX_CHARS * 0.4) {
    splitIdx = paraBreak;
  } else {
    const sentenceBreak = findLastSentenceBreak(remaining, COMPOSER_MAX_CHARS);
    if (sentenceBreak > COMPOSER_MAX_CHARS * 0.4) {
      splitIdx = sentenceBreak;
    } else {
      const wordBreak = remaining.lastIndexOf(' ', COMPOSER_MAX_CHARS);
      if (wordBreak > COMPOSER_MAX_CHARS * 0.4) {
        splitIdx = wordBreak;
      }
    }
  }

  return splitIdx;
}

/** Character ranges [start, end) in normalized text for each Bluesky post (segment highlighting). */
export function getComposerSegmentRanges(text: string): { start: number; end: number }[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const raw = normalized.trim();
  if (!raw) return [];

  const leading = normalized.match(/^\s*/)?.[0].length ?? 0;

  const paragraphs = raw.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  const chunks = paragraphs.length > 0 ? paragraphs : [raw];

  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const chunk of chunks) {
    const startInRaw = raw.indexOf(chunk, cursor);
    if (startInRaw === -1) break;
    cursor = startInRaw + chunk.length;

    if (chunk.length <= COMPOSER_MAX_CHARS) {
      ranges.push({ start: leading + startInRaw, end: leading + startInRaw + chunk.length });
    } else {
      for (const lr of splitLongSegmentRanges(chunk)) {
        ranges.push({
          start: leading + startInRaw + lr.start,
          end: leading + startInRaw + lr.end,
        });
      }
    }
  }
  return ranges;
}

function splitLongSegmentRanges(t: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  let remaining = t;

  while (remaining.length > 0) {
    if (remaining.length <= COMPOSER_MAX_CHARS) {
      ranges.push({ start: offset, end: offset + remaining.length });
      break;
    }

    const splitIdx = pickSplitIndex(remaining);
    const rawPiece = remaining.slice(0, splitIdx);
    const piece = rawPiece.trim();
    const lead = rawPiece.length - rawPiece.trimStart().length;
    ranges.push({ start: offset + lead, end: offset + lead + piece.length });

    const sliced = remaining.slice(splitIdx);
    const trimLead = sliced.length - sliced.trimStart().length;
    offset += splitIdx + trimLead;
    remaining = sliced.trim();
  }

  return ranges;
}

function findLastSentenceBreak(text: string, maxIdx: number): number {
  let best = -1;
  for (let i = maxIdx; i > maxIdx * 0.4; i--) {
    if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
      if (i + 1 < text.length && text[i + 1] === ' ') {
        best = i + 1;
        break;
      }
    }
  }
  return best;
}
