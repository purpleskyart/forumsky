#!/usr/bin/env node
/**
 * Writes public/client-metadata.json for the deployed origin (required for ATProto OAuth).
 * Set SITE_ORIGIN to the public site root with no trailing slash, e.g.
 *   https://YOUR_USER.github.io/YOUR_REPO
 * or https://forumsky.app
 *
 * If SITE_ORIGIN is unset, the script exits 0 and leaves the existing file unchanged.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'public', 'client-metadata.json');

const origin = process.env.SITE_ORIGIN?.replace(/\/$/, '');
if (!origin) {
  console.warn('SITE_ORIGIN not set; leaving public/client-metadata.json unchanged.');
  process.exit(0);
}

/** Keep in sync with oauthScope() in src/api/auth.ts */
const scope = [
  'atproto',
  'transition:generic',
  'rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app#bsky_appview',
  'rpc:app.bsky.feed.getFeed?aud=did:web:api.bsky.app#bsky_appview',
].join(' ');

const doc = {
  client_id: `${origin}/client-metadata.json`,
  client_name: 'ForumSky',
  client_uri: origin,
  redirect_uris: [`${origin}/`],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  scope,
  application_type: 'web',
  dpop_bound_access_tokens: true,
  token_endpoint_auth_method: 'none',
};

writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
console.log('Wrote', out);
