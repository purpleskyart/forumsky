import { render } from 'preact';
import { App } from './app';
import './styles/global.css';

console.log('[ForumSky] main.tsx loaded');
console.log('[ForumSky] App component:', App);

try {
  const appElement = document.getElementById('app');
  console.log('[ForumSky] app element:', appElement);
  render(<App />, appElement!);
  console.log('[ForumSky] render completed');
} catch (error) {
  console.error('[ForumSky] Render error:', error);
}
