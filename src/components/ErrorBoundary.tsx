import { Component } from 'preact';
import { showAuthDialog } from '@/lib/store';

interface Props {
  children: preact.ComponentChildren;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: preact.ErrorInfo) {
    if (import.meta.env.DEV) console.error('[ForumSky] ErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleSignIn = () => {
    showAuthDialog.value = true;
  };

  isAuthError = () => {
    const error = this.state.error;
    if (!error) return false;
    return error.message === 'You must be signed in to do this' ||
           (error as any).errorType === 'AuthRequired';
  };

  render() {
    if (this.state.hasError) {
      const isAuth = this.isAuthError();
      return (
        <div class="panel" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <h2 style={{ marginBottom: '16px' }}>
            {isAuth ? 'Sign in required' : 'Something went wrong'}
          </h2>
          <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          {isAuth ? (
            <button class="btn btn-primary" onClick={this.handleSignIn}>
              Sign In
            </button>
          ) : (
            <button class="btn btn-primary" onClick={this.handleRetry}>
              Try Again
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
