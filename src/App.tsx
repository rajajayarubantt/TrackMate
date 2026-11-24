import { useEffect, useState } from 'react';
import { boot, session } from './lib/session';
import { useStore } from './lib/store';
import { AuthScreen } from './shell/Auth';
import { Banners } from './shell/Banners';
import { Shell } from './shell/Shell';
import { OverlayHost, toast } from './ui/overlay';

let starting: Promise<void> | null = null;
const start = (): Promise<void> =>
  (starting ??= boot((message) => toast(message)).then(() => {
    // Ask the browser not to evict the offline copy when storage runs low.
    void navigator.storage?.persist?.();
  }));

export function App() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const user = useStore(session);

  useEffect(() => {
    start().then(
      () => setState('ready'),
      (reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setState('error');
      },
    );
  }, []);

  if (state === 'loading') {
    return (
      <div className="splash">
        <img src="icons/icon.svg" alt="" />
        <div className="spinner" role="status" aria-label="Opening TrackMate" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="splash">
        <img src="icons/icon.svg" alt="" />
        <h1 className="t-title2">TrackMate couldn’t start</h1>
        <p>The app loaded, but its server is not ready. If you deployed this app, the message below says what to fix.</p>
        <pre>{error}</pre>
        <button type="button" className="btn btn-filled btn-md" onClick={() => location.reload()}>Try again</button>
      </div>
    );
  }
  return (
    <>
      {user ? <Shell key={user.id} /> : <AuthScreen />}
      <Banners />
      <OverlayHost />
    </>
  );
}
