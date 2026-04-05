import { useEffect } from 'preact/hooks';
import { showAuthDialog, showSignUpDialog } from '@/lib/store';

const PROVIDERS = [
  { name: 'Bluesky', href: 'https://bsky.app/' },
  { name: 'Blacksky', href: 'https://blacksky.community/' },
  { name: 'Northsky', href: 'https://northskysocial.com/join' },
  { name: 'Eurosky', href: 'https://eurosky.tech/signup/' },
] as const;

export function SignUpDialog() {
  useEffect(() => {
    if (!showSignUpDialog.value) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showSignUpDialog.value]);

  if (!showSignUpDialog.value) return null;

  const close = () => {
    showSignUpDialog.value = false;
  };

  const openLogin = () => {
    showSignUpDialog.value = false;
    showAuthDialog.value = true;
  };

  return (
    <div class="auth-overlay" onClick={(e: Event) => { if (e.target === e.currentTarget) close(); }}>
      <div class="auth-dialog signup-dialog">
        <h2>Create an account</h2>
        <p class="signup-dialog-lede">
          ForumSky signs you in with an AT Protocol account. Choose a host below to register, then come back here to log in.
        </p>
        <ul class="signup-provider-list">
          {PROVIDERS.map(p => (
            <li key={p.href}>
              <a
                class="btn btn-primary signup-provider-btn"
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {p.name}
              </a>
            </li>
          ))}
        </ul>
        <p class="signup-dialog-footer">
          <button type="button" class="signup-dialog-signin" onClick={openLogin}>
            Already have an account? Sign in
          </button>
        </p>
        <div class="signup-dialog-actions">
          <button type="button" class="btn btn-outline" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
