// In-app notification banners, styled after iOS notifications.
import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createStore, useStore } from '../lib/store';
import { Icon } from '../ui/icons';

export interface Banner {
  id: string;
  title: string;
  text?: string;
  icon?: ReactNode;
  color?: string;
  actions?: { label: string; primary?: boolean; onSelect: () => void }[];
  onOpen?: () => void;
  /** Stay until dismissed. */
  sticky?: boolean;
}

const banners = createStore<Banner[]>([]);

export function pushBanner(banner: Banner): void {
  banners.set((list) => [banner, ...list.filter((b) => b.id !== banner.id)].slice(0, 3));
}
export function dismissBanner(id: string): void {
  banners.set((list) => list.filter((b) => b.id !== id));
}

function BannerCard({ banner }: { banner: Banner }) {
  useEffect(() => {
    if (banner.sticky) return;
    const timer = window.setTimeout(() => dismissBanner(banner.id), 9000);
    return () => clearTimeout(timer);
  }, [banner.id, banner.sticky]);
  return (
    <div className="banner glass thick" role="alert">
      <span className="banner-icon" style={{ '--c': banner.color ?? 'var(--tint)' } as CSSProperties}>
        {banner.icon ?? <Icon.bell />}
      </span>
      <div
        className="banner-body"
        onClick={() => {
          if (!banner.onOpen) return;
          banner.onOpen();
          dismissBanner(banner.id);
        }}
      >
        <div className="banner-title">{banner.title}</div>
        {banner.text && <div className="banner-text">{banner.text}</div>}
        {banner.actions && (
          <div className="banner-actions">
            {banner.actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className={action.primary ? 'primary' : ''}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onSelect();
                  dismissBanner(banner.id);
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="banner-close" aria-label="Dismiss" onClick={() => dismissBanner(banner.id)}>
        <Icon.close />
      </button>
    </div>
  );
}

export function Banners() {
  const list = useStore(banners);
  if (!list.length) return null;
  return createPortal(
    <div className="banners">
      {list.map((banner) => (
        <BannerCard key={banner.id} banner={banner} />
      ))}
    </div>,
    document.getElementById('overlays') as HTMLElement,
  );
}
