import { useEffect, useState } from 'preact/hooks';

const VERSION_URL = '/version.json';
const CACHE_KEY = 'forumsky_version';
const PROMPT_KEY = 'forumsky_update_dismissed';

interface VersionInfo {
  version: string;
  timestamp: string;
}

export function useIosUpdate() {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    let dismissed = false;

    const checkForUpdate = async () => {
      if (dismissed) return;

      const storedVersion = localStorage.getItem(CACHE_KEY);

      try {
        const res = await fetch(VERSION_URL + '?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;

        const info: VersionInfo = await res.json();
        const latestVersion = info.version;

        if (!storedVersion) {
          localStorage.setItem(CACHE_KEY, latestVersion);
          setCurrentVersion(latestVersion);
          return;
        }

        if (storedVersion !== latestVersion) {
          setNeedsUpdate(true);
          setCurrentVersion(latestVersion);
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

    const handleLoad = () => {
      checkForUpdate();
    };

    window.addEventListener('load', handleLoad);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      dismissed = true;
      window.removeEventListener('load', handleLoad);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const dismissUpdate = () => {
    localStorage.setItem(PROMPT_KEY, currentVersion);
    setNeedsUpdate(false);
  };

  const forceReload = () => {
    localStorage.setItem(CACHE_KEY, currentVersion);
    window.location.reload();
  };

  return { needsUpdate, dismissUpdate, forceReload };
}
