import { useState } from 'react';
import type { ReactNode } from 'react';
import { useUser } from '../lib/session';
import { openSheet } from './sheets';

interface ScreenProps {
  title: string;
  /** Small line above the large title (a date, a count). */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
  /** Content manages its own scrolling and fills the screen (board, calendar). */
  fill?: boolean;
  wide?: boolean;
  hideAvatar?: boolean;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

/** A page with the iOS large title that collapses into a glass bar as you scroll. */
export function Screen({ title, eyebrow, actions, leading, children, fill, wide, hideAvatar }: ScreenProps) {
  const [scrolled, setScrolled] = useState(false);
  const user = useUser();
  return (
    <div className="screen">
      <header className="navbar" data-scrolled={scrolled || fill || undefined}>
        <div className="navbar-side">{leading}</div>
        <div className="navbar-title">{title}</div>
        <div className="navbar-side navbar-actions">
          {actions}
          {!hideAvatar && (
            <button type="button" className="avatar avatar-nav" aria-label="Settings" onClick={() => openSheet('settings', true)}>
              {initials(user.name)}
            </button>
          )}
        </div>
      </header>
      {fill ? (
        <div className="screen-fill">{children}</div>
      ) : (
        <div className="screen-scroll" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 40)}>
          <div className={`screen-inner ${wide ? 'wide' : ''}`}>
            <div className="large-title">
              {eyebrow && <div className="eyebrow">{eyebrow}</div>}
              <h1 className="t-large">{title}</h1>
            </div>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
