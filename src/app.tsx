import { useEffect, useLayoutEffect } from 'preact/hooks';
import { Router, Route } from 'preact-router';
import type { RouterOnChangeArgs } from 'preact-router';
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
import { FOLLOWED_COMMUNITY_TAG } from './lib/preferences';
import { browserHistory } from '@/lib/app-base-path';
import { navigate } from './lib/router';
import { authInitDone, currentUser, sessionRestorePending } from './lib/store';

function FollowedFeedRoute() {
  return <Community tag={FOLLOWED_COMMUNITY_TAG} />;
}

/** Logged-in users land on Following; guests see the communities list (same as /communities). */
function RootRoute() {
  if (authInitDone.value && currentUser.value) {
    return <FollowedFeedRoute />;
  }
  if (sessionRestorePending()) {
    return (
      <div class="panel" style={{ padding: '48px 24px', display: 'flex', justifyContent: 'center' }}>
        <div class="loading">
          <div class="spinner" />
        </div>
      </div>
    );
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

  return (
    <Layout>
      <Router history={browserHistory} onChange={onRouterChange}>
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
      </Router>
    </Layout>
  );
}
