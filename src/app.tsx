import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { Router, Route } from 'preact-router';
import type { RouterOnChangeArgs } from 'preact-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import {
  attachPopstateScrollGuard,
  attachScrollPositionPersistence,
  patchHistoryScrollSave,
  scheduleScrollRestore,
  setManualScrollRestoration,
} from '@/lib/scroll-restore';
import { Home } from './pages/Home';
import { Community } from './pages/Community';
import { Thread } from './pages/Thread';
import { Profile } from './pages/Profile';
import { Search } from './pages/Search';
import { Activity } from './pages/Activity';
import { SavedThreads } from './pages/SavedThreads';
import { Drafts } from './pages/Drafts';
import { Settings } from './pages/Settings';
import { FOLLOWED_COMMUNITY_TAG } from '@/lib/preferences';
import { browserHistory } from '@/lib/app-base-path';
import { navigate } from './lib/router';
import { authInitDone, currentUser } from './lib/store';

function FollowedFeedRoute() {
  return <Community tag={FOLLOWED_COMMUNITY_TAG} />;
}

/** Logged-in users land on Following; guests see the communities list (same as /communities). */
function RootRoute() {
  if (authInitDone.value && currentUser.value) {
    return <FollowedFeedRoute />;
  }
  return <Home />;
}

/** Old URLs `/followed` and `/c/_followed` → canonical followed feed at `/`. */
function RedirectFollowedUrlsToHome() {
  useLayoutEffect(() => {
    navigate('/', true);
  }, []);
  return null;
}

function onRouterChange(_args: RouterOnChangeArgs) {
  scheduleScrollRestore();
}

export function App() {
  const [transitionKey, setTransitionKey] = useState(0);
  
  useEffect(() => {
    setManualScrollRestoration();
    const detachPop = attachPopstateScrollGuard();
    const unpatchHistory = patchHistoryScrollSave();
    const detachScroll = attachScrollPositionPersistence();
    return () => {
      detachPop();
      unpatchHistory();
      detachScroll();
    };
  }, []);

  const handleRouteChange = (args: RouterOnChangeArgs) => {
    setTransitionKey(prev => prev + 1);
    onRouterChange(args);
  };

  return (
    <Layout>
      <ErrorBoundary>
        <div class={`page-transition-enter`} key={transitionKey}>
          <Router history={browserHistory} onChange={handleRouteChange}>
          <Route path="/" component={RootRoute} />
          <Route path="/communities" component={Home} />
          <Route path="/followed" component={RedirectFollowedUrlsToHome} />
          <Route path="/c/_followed" component={RedirectFollowedUrlsToHome} />
          <Route path="/c/:tag" component={Community} />
          <Route path="/t/:actor/:rkey" component={Thread} />
          <Route path="/u/:handle" component={Profile} />
          <Route path="/search" component={Search} />
          <Route path="/activity" component={Activity} />
          <Route path="/saved" component={SavedThreads} />
          <Route path="/drafts" component={Drafts} />
          <Route path="/settings" component={Settings} />
          </Router>
        </div>
      </ErrorBoundary>
    </Layout>
  );
}
