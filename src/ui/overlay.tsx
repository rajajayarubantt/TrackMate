// Floating surfaces: popovers, menus, sheets, alerts and toasts. All custom — no native browser UI.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createStore, useStore } from '../lib/store';
import { Icon } from './icons';

const host = (): HTMLElement => document.getElementById('overlays') as HTMLElement;
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max));

// ── Escape closes whichever surface was opened last ────────────────────────────────────────────

const escapeStack: (() => void)[] = [];
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && escapeStack.length) {
    event.preventDefault();
    escapeStack[escapeStack.length - 1]();
  }
});

function useEscape(active: boolean, onClose: () => void): void {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!active) return;
    const close = () => latest.current();
    escapeStack.push(close);
    return () => {
      const index = escapeStack.indexOf(close);
      if (index >= 0) escapeStack.splice(index, 1);
    };
  }, [active]);
}

/** Keeps a surface mounted for a moment after it closes so it can animate out. */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);
  return { mounted: open || mounted, closing: !open && mounted };
}

// ── Popover ────────────────────────────────────────────────────────────────────────────────────

export type Anchor = HTMLElement | { x: number; y: number } | null;

/** Small helper for "open this menu next to the thing that was pressed". */
export function useAnchor(): { anchor: Anchor; open: boolean; show: (target: Anchor) => void; hide: () => void } {
  const [anchor, setAnchor] = useState<Anchor>(null);
  return { anchor, open: anchor !== null, show: setAnchor, hide: () => setAnchor(null) };
}

interface PopoverProps {
  open: boolean;
  anchor: Anchor;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end' | 'center';
  className?: string;
  width?: number;
  label?: string;
  /** Passive popovers float without taking focus or blocking the page (the slash menu). */
  passive?: boolean;
}

interface Placement {
  left: number;
  top: number;
  maxHeight: number;
  originX: number;
  below: boolean;
}

export function Popover({ open, anchor, onClose, children, align = 'start', className = '', width, label, passive }: PopoverProps) {
  const { mounted, closing } = usePresence(open, 150);
  const ref = useRef<HTMLDivElement>(null);
  const lastAnchor = useRef<Anchor>(anchor);
  if (anchor) lastAnchor.current = anchor;
  const [place, setPlace] = useState<Placement | null>(null);
  useEscape(open && !passive, onClose);

  useLayoutEffect(() => {
    if (!open) {
      if (!mounted) setPlace(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const target = lastAnchor.current;
      const viewW = window.innerWidth;
      const viewH = window.visualViewport?.height ?? window.innerHeight;
      const rect =
        target instanceof HTMLElement
          ? target.getBoundingClientRect()
          : new DOMRect(target ? target.x : viewW / 2, target ? target.y : viewH / 2, 0, 0);
      const w = el.offsetWidth;
      const h = el.scrollHeight + 2;
      const gap = 8;
      const margin = 10;
      let left = align === 'end' ? rect.right - w : align === 'center' ? rect.left + rect.width / 2 - w / 2 : rect.left;
      left = clamp(left, margin, viewW - w - margin);
      const roomBelow = viewH - rect.bottom - gap - margin;
      const roomAbove = rect.top - gap - margin;
      const below = h <= roomBelow || roomBelow >= roomAbove;
      const maxHeight = Math.max(140, below ? roomBelow : roomAbove);
      const height = Math.min(h, maxHeight);
      const top = clamp(below ? rect.bottom + gap : rect.top - gap - height, margin, viewH - height - margin);
      const next = { left, top, maxHeight, originX: clamp(rect.left + rect.width / 2 - left, 12, w - 12), below };
      setPlace((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight && prev.below === next.below ? prev : next,
      );
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    window.addEventListener('resize', compute);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [open, mounted, align, anchor]);

  // Move focus into the popover, and give it back afterwards.
  useEffect(() => {
    if (!open || passive) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>('[data-autofocus]') ?? el).focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, [open, passive]);

  if (!mounted) return null;
  const style = {
    left: place?.left ?? 0,
    top: place?.top ?? 0,
    maxHeight: place?.maxHeight,
    width,
    visibility: place ? 'visible' : 'hidden',
    '--ox': `${place?.originX ?? 0}px`,
    '--oy': place?.below === false ? '100%' : '0%',
  } as CSSProperties;
  return createPortal(
    <div
      className={`pop-layer ${passive ? 'passive' : ''}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={`popover glass thick ${className} ${closing ? 'closing' : ''}`}
        style={style}
      >
        {children}
      </div>
    </div>,
    host(),
  );
}

// ── Menu ───────────────────────────────────────────────────────────────────────────────────────

export type MenuEntry =
  | {
      label: string;
      icon?: ReactNode;
      checked?: boolean;
      destructive?: boolean;
      disabled?: boolean;
      hint?: string;
      swatch?: string;
      onSelect: () => void;
    }
  | { separator: true }
  | { header: string };

interface MenuProps {
  open: boolean;
  anchor: Anchor;
  onClose: () => void;
  items: MenuEntry[];
  align?: 'start' | 'end' | 'center';
  width?: number;
}

export function Menu({ open, anchor, onClose, items, align = 'end', width }: MenuProps) {
  const [active, setActive] = useState(-1);
  useEffect(() => {
    if (open) setActive(-1);
  }, [open]);
  const selectable = items.map((item, index) => ('label' in item && !item.disabled ? index : -1)).filter((i) => i >= 0);
  const hasChecks = items.some((item) => 'label' in item && item.checked !== undefined);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const at = selectable.indexOf(active);
      const next = event.key === 'ArrowDown' ? (at + 1) % selectable.length : (at - 1 + selectable.length) % selectable.length;
      setActive(selectable[next] ?? -1);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      const item = items[active];
      if ('label' in item) {
        onClose();
        item.onSelect();
      }
    }
  };

  return (
    <Popover open={open} anchor={anchor} onClose={onClose} align={align} width={width} className="menu-pop">
      <div className="menu" role="menu" onKeyDown={onKeyDown}>
        {items.map((item, index) => {
          if ('separator' in item) return <div key={index} className="menu-sep" role="separator" />;
          if ('header' in item) return <div key={index} className="menu-header">{item.header}</div>;
          return (
            <button
              key={index}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`menu-item ${item.destructive ? 'destructive' : ''}`}
              data-active={active === index || undefined}
              onPointerEnter={() => setActive(index)}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              {hasChecks && <span className="menu-check">{item.checked && <Icon.check />}</span>}
              {item.swatch && <span className="menu-swatch" style={{ background: item.swatch }} />}
              <span className="menu-label">{item.label}</span>
              {item.hint && <span className="menu-hint">{item.hint}</span>}
              {item.icon && <span className="menu-icon">{item.icon}</span>}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

// ── Sheet ──────────────────────────────────────────────────────────────────────────────────────

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Shows a tinted confirm button in the header. */
  onConfirm?: () => void;
  confirmDisabled?: boolean;
  confirmLabel?: string;
  size?: 'md' | 'lg' | 'full';
  className?: string;
  headerLeading?: ReactNode;
}

export function Sheet({
  open, onClose, title, children, onConfirm, confirmDisabled, confirmLabel = 'Done', size = 'md', className = '', headerLeading,
}: SheetProps) {
  const { mounted, closing } = usePresence(open, 280);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; lastY: number; lastT: number; velocity: number } | null>(null);
  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = sheetRef.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]');
    // On touch devices focusing a field pops the keyboard immediately, so only do it when asked to.
    (first ?? el)?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, [open]);

  // Pull the sheet down by its header to dismiss it (phone layout).
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 720 || (event.target as HTMLElement).closest('button, input, a')) return;
    drag.current = { startY: event.clientY, lastY: event.clientY, lastT: event.timeStamp, velocity: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheetRef.current;
    if (!d || !el) return;
    const dy = Math.max(0, event.clientY - d.startY);
    const dt = Math.max(1, event.timeStamp - d.lastT);
    d.velocity = (event.clientY - d.lastY) / dt;
    d.lastY = event.clientY;
    d.lastT = event.timeStamp;
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = sheetRef.current;
    drag.current = null;
    if (!d || !el) return;
    const dy = event.clientY - d.startY;
    el.style.transition = '';
    if (dy > 140 || (dy > 40 && d.velocity > 0.6)) {
      el.style.transform = 'translateY(100%)';
      onClose();
    } else {
      el.style.transform = '';
    }
  };

  if (!mounted) return null;
  return createPortal(
    <div className={`sheet-layer ${closing ? 'closing' : ''}`}>
      <div className="sheet-scrim" onClick={onClose} />
      <div ref={sheetRef} className={`sheet sheet-${size} ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="sheet-head" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <span className="sheet-grabber" />
          {headerLeading ?? (
            <button type="button" className="icon-btn sm gray" aria-label="Close" onClick={onClose}>
              <Icon.close />
            </button>
          )}
          <div className="sheet-title">{title}</div>
          {onConfirm ? (
            <button type="button" className="icon-btn sm filled" aria-label={confirmLabel} disabled={confirmDisabled} onClick={onConfirm}>
              <Icon.check />
            </button>
          ) : (
            <span className="sheet-head-spacer" />
          )}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    host(),
  );
}

// ── Alerts and toasts (called from anywhere) ───────────────────────────────────────────────────

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Hide the cancel button for plain "OK" alerts. */
  alert?: boolean;
}
const dialog = createStore<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

/** An Apple-style alert. Resolves true when the person confirms. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => dialog.set({ ...options, resolve }));
}

export interface ToastOptions {
  message: string;
  tone?: 'default' | 'success' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}
const toastState = createStore<(ToastOptions & { id: number }) | null>(null);
let toastId = 0;

export function toast(options: ToastOptions | string): void {
  toastState.set({ ...(typeof options === 'string' ? { message: options } : options), id: ++toastId });
}

function AlertDialog() {
  const current = useStore(dialog);
  const { mounted, closing } = usePresence(!!current, 160);
  const last = useRef(current);
  if (current) last.current = current;
  const shown = last.current;
  const answer = (ok: boolean) => {
    current?.resolve(ok);
    dialog.set(null);
  };
  useEscape(!!current, () => answer(false));
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (current) confirmRef.current?.focus();
  }, [current]);
  if (!mounted || !shown) return null;
  return createPortal(
    <div className={`alert-layer ${closing ? 'closing' : ''}`}>
      <div className="sheet-scrim" onClick={() => answer(false)} />
      <div className="alert glass thick" role="alertdialog" aria-modal="true" aria-label={shown.title}>
        <div className="alert-title">{shown.title}</div>
        {shown.message && <div className="alert-message">{shown.message}</div>}
        <div className="alert-actions">
          {!shown.alert && (
            <button type="button" className="btn btn-gray btn-md" onClick={() => answer(false)}>
              {shown.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={`btn btn-md ${shown.destructive ? 'btn-destructive' : 'btn-filled'}`}
            onClick={() => answer(true)}
          >
            {shown.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>,
    host(),
  );
}

function Toaster() {
  const current = useStore(toastState);
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => {
      if (toastState.get()?.id === current.id) toastState.set(null);
    }, current.duration ?? (current.actionLabel ? 6000 : 3200));
    return () => clearTimeout(timer);
  }, [current]);
  if (!current) return null;
  return createPortal(
    <div className="toast-layer" role="status" aria-live="polite">
      <div key={current.id} className="toast glass thick" data-tone={current.tone ?? 'default'}>
        <span className="toast-icon">{current.tone === 'warning' ? <Icon.warning /> : <Icon.checkCircle />}</span>
        <span className="toast-text">{current.message}</span>
        {current.actionLabel && (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              current.onAction?.();
              toastState.set(null);
            }}
          >
            {current.actionLabel}
          </button>
        )}
      </div>
    </div>,
    host(),
  );
}

/** Mount once at the root of the app. */
export function OverlayHost() {
  return (
    <>
      <AlertDialog />
      <Toaster />
    </>
  );
}
