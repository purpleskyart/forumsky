import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { getOutbox, dequeueOutbox, type OutboxPostPayload } from '@/lib/forumsky-local';
import { showToast, currentUser } from '@/lib/store';
import { createPostWithDid } from '@/api/post';

async function flushOne(item: OutboxPostPayload): Promise<boolean> {
  const u = currentUser.value;
  if (!u || u.did !== item.did) return false;
  await createPostWithDid(item.did, {
    text: item.text,
    reply: item.reply,
    facets: item.facets,
    embed: item.embed,
  });
  dequeueOutbox(item.id);
  return true;
}

export function OutboxRetryBar() {
  const [, bump] = useState(0);
  const flushing = useRef(false);
  const [busyUi, setBusyUi] = useState(false);

  const refresh = useCallback(() => bump(n => n + 1), []);

  const tryFlushAll = useCallback(async () => {
    if (flushing.current || !navigator.onLine) return;
    const q = getOutbox();
    if (q.length === 0) return;
    flushing.current = true;
    setBusyUi(true);
    try {
      for (const item of [...q]) {
        try {
          const ok = await flushOne(item);
          if (ok) showToast('Queued post sent');
        } catch {
          break;
        }
      }
    } finally {
      flushing.current = false;
      setBusyUi(false);
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    const onOnline = () => {
      refresh();
      void tryFlushAll();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh, tryFlushAll]);

  const q = getOutbox();
  if (q.length === 0) return null;

  return (
    <div class="outbox-retry-bar" role="region" aria-label="Failed posts queue">
      <span>
        {q.length} post{q.length === 1 ? '' : 's'} could not be sent (saved on this device).
      </span>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        disabled={!navigator.onLine || busyUi}
        onClick={() => void tryFlushAll()}
      >
        {busyUi ? 'Retrying…' : 'Retry now'}
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline"
        onClick={() => {
          for (const item of getOutbox()) dequeueOutbox(item.id);
          refresh();
          showToast('Outbox cleared');
        }}
      >
        Discard all
      </button>
    </div>
  );
}
