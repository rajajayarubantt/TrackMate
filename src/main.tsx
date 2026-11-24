import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadCachedAppearance } from './lib/appearance';
import './styles/base.css';
import './styles/overlays.css';
import './styles/shell.css';
import './styles/modules.css';
import './styles/editor.css';
import './styles/calendar.css';

declare const __DEV__: boolean;

loadCachedAppearance();

// Track the on-screen keyboard so sheets and toolbars stay above it (iOS does not resize the page).
const viewport = window.visualViewport;
if (viewport) {
  const update = () => {
    const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(inset)}px`);
  };
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
}

if ('serviceWorker' in navigator) {
  if (__DEV__) {
    // A worker left over from a production preview would serve stale files during development.
    void navigator.serviceWorker.getRegistrations().then((list) => list.forEach((registration) => void registration.unregister()));
  } else {
    window.addEventListener('load', () => void navigator.serviceWorker.register('sw.js').catch(() => undefined));
  }
}

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
