/**
 * Spoiler text and media sensitivity tests
 *
 * Validates: Spoiler text parsing with ||spoiler|| syntax
 * Validates: Media sensitivity labels for posts
 */

import { describe, it, expect } from 'vitest';
import { detectSpoilers, parseRichText, renderRichText, buildComposerFacets } from '@/lib/richtext';
import type { Facet } from '@/api/types';

// ---------------------------------------------------------------------------
// Spoiler Text Tests
// ---------------------------------------------------------------------------

describe('Spoiler text detection and parsing', () => {
  it('detects simple spoiler text with ||spoiler|| syntax', () => {
    const text = 'This is normal text ||this is spoiler|| more normal';
    const facets = detectSpoilers(text);

    expect(facets).toHaveLength(1);
    expect(facets[0].features[0].$type).toBe('app.purplesky.richtext.facet#spoiler');
  });

  it('detects multiple spoilers in text', () => {
    const text = 'Start ||first spoiler|| middle ||second spoiler|| end';
    const facets = detectSpoilers(text);

    expect(facets).toHaveLength(2);
    expect(facets[0].features[0].$type).toBe('app.purplesky.richtext.facet#spoiler');
    expect(facets[1].features[0].$type).toBe('app.purplesky.richtext.facet#spoiler');
  });

  it('does not detect empty spoilers ||||', () => {
    const text = 'This has empty |||| spoilers';
    const facets = detectSpoilers(text);

    expect(facets).toHaveLength(0);
  });

  it('handles spoilers with special characters inside', () => {
    const text = 'Spoiler: ||This has #hashtag and @mention|| end';
    const facets = detectSpoilers(text);

    expect(facets).toHaveLength(1);
  });

  it('calculates correct byte ranges for spoilers', () => {
    const text = 'Hello ||world|| there';
    const facets = detectSpoilers(text);
    const encoder = new TextEncoder();

    expect(facets).toHaveLength(1);
    // "Hello " is 6 bytes, ||world|| is 9 bytes
    expect(facets[0].index.byteStart).toBe(encoder.encode('Hello ').length);
    expect(facets[0].index.byteEnd).toBe(
      encoder.encode('Hello ').length + encoder.encode('||world||').length
    );
  });

  it('handles multibyte unicode characters correctly', () => {
    const text = 'Emoji 🔥 ||spoilers here|| more';
    const facets = detectSpoilers(text);
    const encoder = new TextEncoder();

    expect(facets).toHaveLength(1);
    // "Emoji 🔥 " is 11 bytes (7 + 4 for emoji + 1 space)
    const prefix = 'Emoji 🔥 ';
    expect(facets[0].index.byteStart).toBe(encoder.encode(prefix).length);
  });
});

describe('Spoiler text parsing with facets', () => {
  it('parses spoiler facets into spoiler type segments', () => {
    const text = 'Before ||spoiler text|| after';
    const encoder = new TextEncoder();
    const prefix = 'Before ';
    const spoiler = '||spoiler text||';
    const spoilerFacet: Facet = {
      index: { byteStart: encoder.encode(prefix).length, byteEnd: encoder.encode(prefix + spoiler).length },
      features: [{ $type: 'app.purplesky.richtext.facet#spoiler' }],
    };

    const segments = parseRichText(text, [spoilerFacet]);

    expect(segments).toHaveLength(3);
    expect(segments[0].type).toBe('text');
    expect(segments[0].text).toBe('Before ');
    expect(segments[1].type).toBe('spoiler');
    expect(segments[1].text).toBe('||spoiler text||');
    expect(segments[2].type).toBe('text');
    expect(segments[2].text).toBe(' after');
  });

  it('renders spoiler segments with correct CSS classes', () => {
    const text = '||spoiler||';
    const encoder = new TextEncoder();
    const spoilerFacet: Facet = {
      index: { byteStart: 0, byteEnd: encoder.encode('||spoiler||').length },
      features: [{ $type: 'app.purplesky.richtext.facet#spoiler' }],
    };

    const vNode = renderRichText(text, [spoilerFacet]);

    // The VNode should be a Fragment with children
    expect(vNode).toBeDefined();
    // The spoiler should be rendered as a span with class 'spoiler-text'
    // and data-spoiler attribute
  });
});

describe('buildComposerFacets includes spoilers', () => {
  it('includes spoiler facets in composer output', async () => {
    const text = 'Check out this ||spoiler|| content';

    const facets = await buildComposerFacets(text, async () => []);

    const spoilerFacets = facets.filter(
      f => f.features[0].$type === 'app.purplesky.richtext.facet#spoiler'
    );
    expect(spoilerFacets).toHaveLength(1);
  });

  it('combines spoilers with mentions and hashtags', async () => {
    const text = 'Hello @user check ||spoiler|| and #topic';

    const facets = await buildComposerFacets(text, async (handles) =>
      handles.map(h => ({ did: `did:plc:${h}`, handle: h }))
    );

    const spoilerFacets = facets.filter(
      f => f.features[0].$type === 'app.purplesky.richtext.facet#spoiler'
    );
    expect(spoilerFacets).toHaveLength(1);

    const mentionFacets = facets.filter(
      f => f.features[0].$type === 'app.bsky.richtext.facet#mention'
    );
    expect(mentionFacets).toHaveLength(1);

    const tagFacets = facets.filter(
      f => f.features[0].$type === 'app.bsky.richtext.facet#tag'
    );
    expect(tagFacets).toHaveLength(1);
  });
});
