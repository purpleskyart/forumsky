import { useEffect, useState } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { useIosUpdate } from '@/hooks/useIosUpdate';

export function ReloadPrompt() {
  const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      if (!r) return;
      console.log('Service worker registered:', swUrl);
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    },
  });

  const { needsUpdate: iosNeedsUpdate, dismissUpdate, forceReload, clearVersion } = useIosUpdate();

  const showPrompt = needRefresh || offlineReady || iosNeedsUpdate;
  const isUpdate = needRefresh || iosNeedsUpdate;

  const close = () => {
    dismissUpdate();
  };

  const reload = () => {
    if (iosNeedsUpdate) {
      forceReload();
    } else {
      updateServiceWorker(true);
    }
  };

  if (!showPrompt) return null;

  return (
    <div class="pwa-toast" role="alert">
      <div class="pwa-toast-message">
        {isUpdate ? (
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
        {isUpdate && (
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
