// Focus timer state. Kept in localStorage so a running session survives a reload.
import { addFocusSession } from '../db/repo';
import { MIN } from './dates';
import { createStore } from './store';

export interface FocusState {
  taskId: string | null;
  title: string;
  totalMin: number;
  endAt: number;
  /** Milliseconds left when paused; null while running. */
  pausedLeft: number | null;
}

const KEY = 'tm.focus';

function load(): FocusState | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null') as FocusState | null;
  } catch {
    return null;
  }
}

export const focus = createStore<FocusState | null>(load());
focus.subscribe(() => {
  const state = focus.get();
  if (state) localStorage.setItem(KEY, JSON.stringify(state));
  else localStorage.removeItem(KEY);
});

export const focusLeft = (state: FocusState, now = Date.now()): number => state.pausedLeft ?? Math.max(0, state.endAt - now);

export function startFocus(taskId: string | null, title: string, minutes: number): void {
  focus.set({ taskId, title, totalMin: minutes, endAt: Date.now() + minutes * MIN, pausedLeft: null });
}

export function toggleFocusPause(): void {
  const state = focus.get();
  if (!state) return;
  if (state.pausedLeft === null) focus.set({ ...state, pausedLeft: focusLeft(state) });
  else focus.set({ ...state, endAt: Date.now() + state.pausedLeft, pausedLeft: null });
}

export function extendFocus(minutes: number): void {
  const state = focus.get();
  if (!state) return;
  focus.set({
    ...state, totalMin: state.totalMin + minutes,
    endAt: state.endAt + minutes * MIN, pausedLeft: state.pausedLeft === null ? null : state.pausedLeft + minutes * MIN,
  });
}

/** End the session and log the minutes actually spent. Returns those minutes. */
export function endFocus(): number {
  const state = focus.get();
  if (!state) return 0;
  const spent = Math.round(state.totalMin - focusLeft(state) / MIN);
  focus.set(null);
  if (spent >= 1) addFocusSession(state.taskId, spent);
  return spent;
}
