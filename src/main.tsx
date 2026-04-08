import { render } from 'preact';
import { App } from './app';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';
import { SWR_INTERVAL_MS } from './lib/constants';

registerSW({
  immediate: true,
  onRegistered(registration) {
    if (!registration) return;
    const checkForUpdate = () => {
      void registration.update();
    };
    window.setInterval(checkForUpdate, SWR_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
  },
});

render(<App />, document.getElementById('app')!);
