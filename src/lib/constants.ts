export const SWR_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
export const AUTH_TIMEOUT_MS = 120_000; // 2 minutes
export const TIMELINE_LIMIT = 30;
export const TIMELINE_INITIAL_MAX_ROUNDS = 3;
export const SEARCH_LIMIT = 25;
export const AUTHOR_FEED_LIMIT = 30;
export const POST_URI_CHUNK_SIZE = 25;
export const COMMUNITY_STATS_TTL = 120_000; // 2 minutes
export const TIMELINE_PREVIEW_LIMIT = 40;

// Composer timing constants
export const COMPOSER_DRAFT_AUTOSAVE_MS = 450;
export const COMPOSER_LINK_PREVIEW_DEBOUNCE_MS = 450;
export const COMPOSER_MENTION_SEARCH_DEBOUNCE_MS = 200;
export const COMPOSER_MENTION_SEARCH_LIMIT = 8;

// XRPC retry constants
export const XRPC_GET_MAX_ATTEMPTS = 4;
export const XRPC_RETRY_BASE_DELAY_MS = 400;

// OAuth constants
export const OAUTH_INIT_TIMEOUT_MS = 5000;

// Cache limits
export const CACHE_MAX_KEYS = 500;
export const CACHE_EVICTION_BATCH_SIZE = 10;

// Thread merger cache limits
export const THREAD_MERGER_CACHE_MAX_SIZE = 100;

// Image preview cleanup delay
export const IMAGE_PREVIEW_CLEANUP_DELAY_MS = 0;

// Toast duration constants
export const TOAST_DURATION_DEFAULT_MS = 3000;
export const TOAST_DURATION_LONG_MS = 5000;
export const TOAST_DURATION_SHORT_MS = 3500;

// Accessibility announcements
export const ANNOUNCEMENT_DELAY_MS = 150;

// Focus trap constants
export const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// URL validation
export const ALLOWED_URL_SCHEMES = ['http:', 'https:'];
export const BLOCKED_URL_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:'];

// Storage quota warnings
export const STORAGE_QUOTA_WARNING_THRESHOLD = 0.85; // 85% full

// Outbox retry
export const OUTBOX_MAX_RETRIES = 3;
export const OUTBOX_RETRY_DELAY_MS = 5000;
