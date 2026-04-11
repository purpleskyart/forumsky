import { render } from 'preact';
import { App } from './app';
import './styles/global.css';

console.log('[ForumSky] main.tsx loaded');

try {
  const appElement = document.getElementById('app');
  if (!appElement) {
    console.error('[ForumSky] ERROR: #app element not found in DOM');
  } else {
    console.log('[ForumSky] #app element found, rendering App...');
    render(<App />, appElement);
    console.log('[ForumSky] render() called successfully');
  }
} catch (error) {
  console.error('[ForumSky] FATAL Render error:', error);
}
