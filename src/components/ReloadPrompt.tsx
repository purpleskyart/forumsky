import { useEffect, useState } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { useIosUpdate } from '@/hooks/useIosUpdate';

export function ReloadPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isUpdate, setIsUpdate] = useState(false);
  const { needsUpdate: iosNeedsUpdate, dismissUpdate, forceReload } = useIosUpdate();

  const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      if (!r) return;
      console.log('Service worker registered:', swUrl);
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  useEffect(() => {
    if (needRefresh) {
      setShowPrompt(true);
      setIsUpdate(true);
    } else if (offlineReady) {
      setShowPrompt(true);
      setIsUpdate(false);
    } else {
      setShowPrompt(false);
    }
  }, [needRefresh, offlineReady]);

  const close = () => {
    setShowPrompt(false);
    dismissUpdate();
  };

  const reload = () => {
    if (iosNeedsUpdate) {
      forceReload();
    } else {
      updateServiceWorker(true);
    }
  };

  if (!showPrompt && !iosNeedsUpdate) return null;

  return (
    <div class="pwa-toast" role="alert">
      <div class="pwa-toast-message">
        {isUpdate || iosNeedsUpdate ? (
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
        {(isUpdate || iosNeedsUpdate) && (
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
