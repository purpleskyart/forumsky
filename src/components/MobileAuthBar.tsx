import { showAuthDialog, showSignUpDialog } from '@/lib/store';

export function MobileAuthBar() {
  return (
    <div class="mobile-auth-bar">
      <a
        href="#"
        onClick={(e: Event) => {
          e.preventDefault();
          showSignUpDialog.value = false;
          showAuthDialog.value = true;
        }}
        class="btn btn-outline btn-sm"
      >
        Login
      </a>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onClick={() => {
          showAuthDialog.value = false;
          showSignUpDialog.value = true;
        }}
      >
        Create Account
      </button>
    </div>
  );
}
