import { useEffect, useState } from 'preact/hooks';

const VERSION_URL = '/version.json';
const CACHE_KEY = 'forumsky_version';

interface VersionInfo {
  version: string;
  timestamp: string;
}

export function useIosUpdate() {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    let lastVersion = '';

    const checkForUpdate = async () => {
      const storedVersion = localStorage.getItem(CACHE_KEY);

      try {
        const res = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;

        const info: VersionInfo = await res.json();
        const latestVersion = info.version;

        setCurrentVersion(latestVersion);

        if (!storedVersion) {
          localStorage.setItem(CACHE_KEY, latestVersion);
          return;
        }

        if (storedVersion !== latestVersion) {
          lastVersion = latestVersion;
          setNeedsUpdate(true);
        }
      } catch {
        // Network error or offline - skip
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    };

    checkForUpdate();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const dismissUpdate = () => {
    if (currentVersion) {
      localStorage.setItem(CACHE_KEY, currentVersion);
    }
    setNeedsUpdate(false);
  };

  const forceReload = () => {
    if (currentVersion) {
      localStorage.setItem(CACHE_KEY, currentVersion);
    }
    window.location.reload();
  };

  const clearVersion = () => {
    localStorage.removeItem(CACHE_KEY);
    setNeedsUpdate(false);
  };

  return { needsUpdate, dismissUpdate, forceReload, clearVersion };
}

if (typeof window !== 'undefined') {
  (window as unknown as { __clearVersion: () => void }).__clearVersion = () => {
    localStorage.removeItem(CACHE_KEY);
    console.log('Version cleared. Reload to test update prompt.');
  };
}
