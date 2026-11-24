// Which sheets are open. Any screen can open the task editor, event editor, quick capture, etc.
import type { CalEvent, Task } from '../db/types';
import { createStore, useStore } from '../lib/store';

export interface SheetState {
  task: { id?: string; draft?: Partial<Task> } | null;
  event: { id?: string; occurrence?: number; draft?: Partial<CalEvent> } | null;
  link: { id: string; fresh?: boolean } | null;
  tag: { id?: string } | null;
  capture: { text?: string } | null;
  settings: boolean;
  alerts: boolean;
}

const closed: SheetState = { task: null, event: null, link: null, tag: null, capture: null, settings: false, alerts: false };
export const sheets = createStore<SheetState>(closed);
export const useSheets = (): SheetState => useStore(sheets);

export function openSheet<K extends keyof SheetState>(key: K, value: SheetState[K]): void {
  sheets.set((state) => ({ ...state, [key]: value }));
}
export function closeSheet(key: keyof SheetState): void {
  sheets.set((state) => ({ ...state, [key]: closed[key] }));
}
export const closeAllSheets = (): void => sheets.set(closed);
