import { render } from 'preact';
import { App } from './app';
import './styles/global.css';
import { registerSW } from 'virtual:pwa-register';

registerSW({
  immediate: true,
  onRegistered(registration) {
    if (!registration) return;
    const checkForUpdate = () => {
      void registration.update();
    };
    window.setInterval(checkForUpdate, 45 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
  },
});

render(<App />, document.getElementById('app')!);
