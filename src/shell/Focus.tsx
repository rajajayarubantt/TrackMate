// The focus timer: a small always-on-top pill, in the spirit of a Live Activity.
import { useEffect } from 'react';
import { endFocus, extendFocus, focus, focusLeft, toggleFocusPause } from '../lib/focus';
import { MIN } from '../lib/dates';
import { playChime, systemNotify } from '../lib/notify';
import { getSettings } from '../lib/session';
import { useStore } from '../lib/store';
import { useTick } from '../ui/controls';
import { Icon } from '../ui/icons';
import { Menu, toast, useAnchor } from '../ui/overlay';
import { pushBanner } from './Banners';

export function FocusPill() {
  const state = useStore(focus);
  const now = useTick(state && state.pausedLeft === null ? 1000 : 60_000);
  const menu = useAnchor();
  const left = state ? focusLeft(state, now) : 0;

  // Time is up: log the session and say so.
  useEffect(() => {
    if (!state || state.pausedLeft !== null || left > 0) return;
    const minutes = endFocus();
    const settings = getSettings();
    if (settings.chime) playChime();
    pushBanner({ id: 'focus', title: 'Focus session complete', text: `${minutes} min on “${state.title}”`, color: 'var(--orange)', icon: <Icon.timer /> });
    if (settings.notify) void systemNotify('Focus session complete', `${minutes} min on “${state.title}”`, 'focus');
  }, [state, left]);

  if (!state) return null;
  const total = state.totalMin * MIN;
  const ratio = Math.min(1, Math.max(0, 1 - left / total));
  const seconds = Math.ceil(left / 1000);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const circumference = 2 * Math.PI * 11;
  return (
    <>
      <button type="button" className="focus-pill" aria-label={`Focus timer, ${clock} left`} onClick={(event) => menu.show(event.currentTarget)}>
        <svg className="focus-ring" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r="11" stroke="rgba(255,255,255,0.22)" />
          <circle cx="14" cy="14" r="11" stroke="var(--orange)" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} />
        </svg>
        <span className="focus-title">{state.pausedLeft !== null ? 'Paused' : state.title}</span>
        <span className="focus-time">{clock}</span>
      </button>
      <Menu open={menu.open} anchor={menu.anchor} onClose={menu.hide} align="center" items={[
        { header: state.title },
        { label: state.pausedLeft === null ? 'Pause' : 'Resume', icon: state.pausedLeft === null ? <Icon.pause /> : <Icon.play />, onSelect: toggleFocusPause },
        { label: 'Add 5 minutes', icon: <Icon.add />, onSelect: () => extendFocus(5) },
        { separator: true },
        {
          label: 'End session', icon: <Icon.stop />, destructive: true,
          onSelect: () => {
            const minutes = endFocus();
            toast(minutes ? `Logged ${minutes} min of focus` : 'Focus session ended');
          },
        },
      ]} />
    </>
  );
}
