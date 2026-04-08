import { useState, useEffect } from 'preact/hooks';
import { useIosUpdate } from '@/hooks/useIosUpdate';

export function ReloadPrompt() {
  const { needsUpdate, dismissUpdate, forceReload } = useIosUpdate();

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(needsUpdate);
  }, [needsUpdate]);

  const handleReload = () => {
    dismissUpdate();
    forceReload();
  };

  const handleClose = () => {
    dismissUpdate();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div class="pwa-toast" role="alert">
      <div class="pwa-toast-content">
        <strong>New version available</strong>
        <span> Reload to update.</span>
      </div>
      <div class="pwa-toast-actions">
        <button
          type="button"
          class="pwa-toast-btn pwa-toast-reload"
          onClick={handleReload}
        >
          Reload
        </button>
        <button
          type="button"
          class="pwa-toast-btn pwa-toast-close"
          onClick={handleClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
