export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const startOfDay = (t: number): number => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const addDays = (t: number, n: number): number => {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
};
export const daysInMonth = (year: number, month: number): number => new Date(year, month + 1, 0).getDate();
export const addMonths = (t: number, n: number): number => {
  const d = new Date(t);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return d.getTime();
};
export const startOfMonth = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};
export const startOfWeek = (t: number, weekStart: number): number => {
  const d = new Date(startOfDay(t));
  return addDays(d.getTime(), -((d.getDay() - weekStart + 7) % 7));
};
export const sameDay = (a: number, b: number): boolean => startOfDay(a) === startOfDay(b);
export const minutesOfDay = (t: number): number => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};
/** A timestamp on the given day at `minutes` past midnight. */
export const atMinutes = (day: number, minutes: number): number => {
  const d = new Date(startOfDay(day));
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
};
export const dayDiff = (a: number, b: number): number => Math.round((startOfDay(a) - startOfDay(b)) / DAY);

const formatter = (options: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat(undefined, options);
  return (t: number) => f.format(t);
};
const time12 = formatter({ hour: 'numeric', minute: '2-digit', hour12: true });
const time24 = formatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hour12 = formatter({ hour: 'numeric', hour12: true });

export const fmt = {
  time: (t: number, h24: boolean): string => (h24 ? time24(t) : time12(t)),
  hour: (t: number, h24: boolean): string => (h24 ? time24(t) : hour12(t)),
  dayLong: formatter({ weekday: 'long', month: 'long', day: 'numeric' }),
  dayShort: formatter({ weekday: 'short', month: 'short', day: 'numeric' }),
  monthDay: formatter({ month: 'short', day: 'numeric' }),
  monthDayYear: formatter({ month: 'short', day: 'numeric', year: 'numeric' }),
  monthYear: formatter({ month: 'long', year: 'numeric' }),
  month: formatter({ month: 'long' }),
  monthShort: formatter({ month: 'short' }),
  weekday: formatter({ weekday: 'long' }),
  weekdayShort: formatter({ weekday: 'short' }),
  weekdayNarrow: formatter({ weekday: 'narrow' }),
};

/** "Today", "Tomorrow", "Wednesday", "Nov 28" or "Nov 28, 2027". */
export function relDay(t: number, now = Date.now()): string {
  const diff = dayDiff(t, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return fmt.weekday(t);
  return new Date(t).getFullYear() === new Date(now).getFullYear() ? fmt.monthDay(t) : fmt.monthDayYear(t);
}

export function relDateTime(t: number, hasTime: boolean, h24: boolean, now = Date.now()): string {
  return hasTime ? `${relDay(t, now)}, ${fmt.time(t, h24)}` : relDay(t, now);
}

/** "now", "5m", "3h", "2d", then a date. */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, now - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return relDay(t, now);
}

export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "in 25 min", "in 2 h", "now", "10 min ago". */
export function until(t: number, now = Date.now()): string {
  const m = Math.round((t - now) / MIN);
  if (Math.abs(m) < 1) return 'now';
  const a = Math.abs(m);
  const text = a < 60 ? `${a} min` : a < 48 * 60 ? `${Math.round(a / 60)} h` : `${Math.round(a / 1440)} days`;
  return m > 0 ? `in ${text}` : `${text} ago`;
}

export function greeting(now = Date.now()): string {
  const h = new Date(now).getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Weekday headings starting from the chosen first day of the week. */
export function weekdayLabels(weekStart: number, style: 'narrow' | 'short' = 'short'): string[] {
  const base = startOfWeek(Date.now(), weekStart);
  return Array.from({ length: 7 }, (_, i) => (style === 'narrow' ? fmt.weekdayNarrow : fmt.weekdayShort)(addDays(base, i)));
}
