import { useEffect, useState } from 'preact/hooks';

const VERSION_URL = '/version.json';
const CACHE_KEY = 'forumsky_version';
const FIRST_RUN_KEY = 'forumsky_first_run';

interface VersionInfo {
  version: string;
  timestamp: string;
}

export function useIosUpdate() {
  const [needsUpdate, setNeedsUpdate] = useState(false);

  useEffect(() => {
    const checkForUpdate = async () => {
      const storedVersion = localStorage.getItem(CACHE_KEY);
      const isFirstRun = !localStorage.getItem(FIRST_RUN_KEY);

      try {
        const res = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;

        const info: VersionInfo = await res.json();
        const latestVersion = info.version;

        if (isFirstRun) {
          localStorage.setItem(CACHE_KEY, latestVersion);
          localStorage.setItem(FIRST_RUN_KEY, 'true');
          return;
        }

        if (storedVersion && storedVersion !== latestVersion) {
          setNeedsUpdate(true);
        }
      } catch {
        // Network error or offline - skip
      }
    };

    checkForUpdate();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const dismissUpdate = () => {
    const storedVersion = localStorage.getItem(CACHE_KEY);
    if (storedVersion) {
      localStorage.setItem(CACHE_KEY, storedVersion);
    }
    setNeedsUpdate(false);
  };

  const forceReload = () => {
    const storedVersion = localStorage.getItem(CACHE_KEY);
    if (storedVersion) {
      localStorage.setItem(CACHE_KEY, storedVersion);
    }
    window.location.reload();
  };

  return { needsUpdate, dismissUpdate, forceReload };
}

if (typeof window !== 'undefined') {
  (window as unknown as { __clearVersion: () => void }).__clearVersion = () => {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(FIRST_RUN_KEY);
    console.log('Version cleared. Reload to test update prompt.');
  };
}
