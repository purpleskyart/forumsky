import { useState, useEffect } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';

export function ReloadPrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

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
  };

  if (!needRefresh && !offlineReady) return null;

  return (
    <div class="pwa-toast" role="alert">
      <div class="pwa-toast-message">
        {needRefresh ? (
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
        {needRefresh && (
          <button
            type="button"
            class="pwa-toast-btn pwa-toast-reload"
            onClick={() => updateServiceWorker(true)}
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
