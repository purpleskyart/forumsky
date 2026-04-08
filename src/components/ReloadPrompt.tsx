import { useState, useEffect } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { useIosUpdate } from '@/hooks/useIosUpdate';

export function ReloadPrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const { needsUpdate: iosNeedsUpdate, dismissUpdate, forceReload } = useIosUpdate();

  const {
    needRefresh: [needRefreshLocal, setNeedRefreshLocal],
    offlineReady: [offlineReadyLocal, setOfflineReadyLocal],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      if (!r) return;
      console.log('Service worker registered:', swUrl);
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  useEffect(() => {
    setNeedRefresh(needRefreshLocal);
    setOfflineReady(offlineReadyLocal);
  }, [needRefreshLocal, offlineReadyLocal]);

  const close = () => {
    setNeedRefreshLocal(false);
    setOfflineReadyLocal(false);
    dismissUpdate();
  };

  const reload = () => {
    if (iosNeedsUpdate) {
      forceReload();
    } else {
      updateServiceWorker(true);
    }
  };

  if (!needRefresh && !offlineReady && !iosNeedsUpdate) return null;

  return (
    <div class="pwa-toast" role="alert">
      <div class="pwa-toast-message">
        {needRefresh || iosNeedsUpdate ? (
          <>
            <strong>New version available</strong>
            <span> A new version has been downloaded. Reload to update.</span>
          </>
        ) : (
          <>
            <strong>App ready</strong>
            <span> Available offline now.</span>
          </>
        )}
      </div>
      <div class="pwa-toast-actions">
        {(needRefresh || iosNeedsUpdate) && (
          <button
            type="button"
            class="pwa-toast-btn pwa-toast-reload"
            onClick={reload}
          >
            Reload
          </button>
        )}
        <button
          type="button"
          class="pwa-toast-btn pwa-toast-close"
          onClick={close}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
