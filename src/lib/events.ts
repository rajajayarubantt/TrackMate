// Calendar helpers: recurrence expansion and colours.
import type { CalEvent, EventKind, Occurrence, Repeat, Tag } from '../db/types';
import { DAY, daysInMonth } from './dates';

export const KIND_LABEL: Record<EventKind, string> = { meeting: 'Meeting', event: 'Event', reminder: 'Reminder' };
export const KIND_COLOR: Record<EventKind, string> = { meeting: '#5856D6', event: '#007AFF', reminder: '#FF9500' };
export const TASK_COLOR = '#34C759';

export const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

export const ALERT_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 0, label: 'At time of event' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 1440, label: '1 day before' },
];

/** An event's colour: its own, else its first tag's, else the default for its kind. */
export function eventColor(event: CalEvent, tags: Map<string, Tag>): string {
  return event.color || tags.get(event.tagIds[0])?.color || KIND_COLOR[event.kind];
}

/** Every occurrence of an event that overlaps [from, to). */
export function expand(event: CalEvent, from: number, to: number): Occurrence[] {
  const length = event.end_at - event.start_at;
  const out: Occurrence[] = [];
  const push = (start: number) => {
    if (start + length > from && start < to && !event.exdates.includes(start)) out.push({ event, start, end: start + length });
  };
  if (event.repeat === 'none') {
    push(event.start_at);
    return out;
  }
  const until = Math.min(to, event.repeat_until ?? Number.POSITIVE_INFINITY);
  const base = new Date(event.start_at);
  const [y, m, d, h, min] = [base.getFullYear(), base.getMonth(), base.getDate(), base.getHours(), base.getMinutes()];
  // Skip straight to the visible range for the frequent patterns.
  const elapsedDays = Math.floor((from - event.start_at - length) / DAY) - 1;
  let i = 0;
  if (elapsedDays > 0) {
    if (event.repeat === 'daily' || event.repeat === 'weekdays') i = elapsedDays;
    else if (event.repeat === 'weekly') i = Math.floor(elapsedDays / 7);
  }
  for (let guard = 0; guard < 5000; guard++, i++) {
    let date: Date;
    if (event.repeat === 'weekly') date = new Date(y, m, d + i * 7, h, min);
    else if (event.repeat === 'monthly') {
      date = new Date(y, m + i, 1, h, min);
      if (d > daysInMonth(date.getFullYear(), date.getMonth())) continue;
      date.setDate(d);
    } else if (event.repeat === 'yearly') {
      date = new Date(y + i, m, d, h, min);
      if (date.getMonth() !== m) continue;
    } else date = new Date(y, m, d + i, h, min);
    const start = date.getTime();
    if (start >= until) break;
    if (event.repeat === 'weekdays' && (date.getDay() === 0 || date.getDay() === 6)) continue;
    push(start);
  }
  return out;
}

export function occurrencesBetween(events: CalEvent[], from: number, to: number): Occurrence[] {
  return events.flatMap((event) => expand(event, from, to)).sort((a, b) => a.start - b.start || a.end - b.end);
}

export function nextOccurrence(event: CalEvent, after: number): Occurrence | undefined {
  return expand(event, after, after + 400 * DAY)[0];
}
