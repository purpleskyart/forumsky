import { useState, useEffect, useRef } from 'preact/hooks';

export function ReloadPrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const reloadAfterActivateRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.ready.then(reg => {
      setRegistration(reg);
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            setNeedRefresh(true);
          }
        });
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadAfterActivateRef.current) {
        reloadAfterActivateRef.current = false;
        window.location.reload();
      }
    });
  }, []);

  const updateSW = () => {
    reloadAfterActivateRef.current = true;
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  };

  if (needRefresh) {
    return (
      <div class="toast" style="display:flex;align-items:center;gap:12px">
        <span>New version available!</span>
        <button class="btn btn-primary btn-sm" onClick={updateSW}>Update</button>
      </div>
    );
  }

  return null;
}
