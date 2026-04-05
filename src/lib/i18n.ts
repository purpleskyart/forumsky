/**
 * Lightweight i18n: locale-aware dates/numbers; UI strings default to English.
 * Expand `MESSAGES` per locale as needed.
 */

const MESSAGES: Record<string, Record<string, string>> = {
  en: {
    'thread.unreadReplies': 'New replies since you last marked read',
    'thread.jumpToNew': 'Jump to new',
    'thread.markRead': 'Mark read',
    'thread.subscribe': 'Subscribe',
    'thread.subscribed': 'Subscribed',
    'drafts.title': 'Drafts',
    'drafts.empty': 'No saved drafts.',
    'drafts.discard': 'Discard',
    'common.close': 'Close',
    'rel.justNow': 'just now',
  },
};

function resolveLocale(): string {
  if (typeof navigator === 'undefined') return 'en';
  const primary = (navigator.language || 'en').split('-')[0];
  return MESSAGES[primary] ? primary : 'en';
}

export function t(key: string): string {
  const loc = resolveLocale();
  return MESSAGES[loc]?.[key] ?? MESSAGES.en[key] ?? key;
}

export function formatListDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(resolveLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(resolveLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t('rel.justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return formatShortDate(iso);
}
