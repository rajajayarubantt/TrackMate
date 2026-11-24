// Quick capture: turns a typed line such as
//   "Call the bank tomorrow 3pm #personal !high"
// into a title, a date, tags and a priority. No AI involved — just patterns.
import type { EventKind, Priority } from '../db/types';
import { addDays, addMonths, atMinutes, HOUR, MIN, startOfDay } from './dates';
import { parseUrl } from './linkmeta';

export type QuickKind = 'task' | 'event' | 'note' | 'link';

export interface Parsed {
  kind: QuickKind;
  /** True when the line itself said what it is ("note …", "meeting …", a pasted link). */
  explicit: boolean;
  eventKind: EventKind;
  title: string;
  /** Start of day, or the exact time when `hasTime` is set. */
  date: number | null;
  hasTime: boolean;
  durationMin: number | null;
  tagNames: string[];
  priority: Priority;
  url: string | null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const weekdayIndex = (word: string): number => WEEKDAYS.findIndex((day) => day.startsWith(word.toLowerCase().slice(0, 3)));
const monthIndex = (word: string): number => MONTHS.findIndex((month) => month.startsWith(word.toLowerCase().slice(0, 3)));
const DAY_WORD = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|sday|nesday|rsday|urday)?';
const MONTH_WORD = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';

export function parseQuick(input: string, now = Date.now()): Parsed {
  let text = ` ${input.trim()} `;
  const today = startOfDay(now);
  const result: Parsed = {
    kind: 'task', explicit: false, eventKind: 'event', title: '', date: null, hasTime: false,
    durationMin: null, tagNames: [], priority: 0, url: null,
  };

  /** Run a pattern; when it matches, remove the match from the text and hand it to `use`. */
  const take = (pattern: RegExp, use: (match: RegExpExecArray) => boolean | void): boolean => {
    const match = pattern.exec(text);
    if (!match || use(match) === false) return false;
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
    return true;
  };

  // A bare link is saved as a link; anything else typed with it becomes its note.
  const whole = parseUrl(input.trim());
  const embedded = /(?:^|\s)(https?:\/\/\S+)/i.exec(input);
  if (whole || embedded) {
    const url = whole ?? parseUrl(embedded?.[1] ?? '');
    if (url) {
      const rest = whole ? '' : input.replace(embedded?.[1] ?? '', ' ');
      const tags = [...rest.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]);
      return {
        ...result, kind: 'link', explicit: true, url, tagNames: tags,
        title: rest.replace(/(?:^|\s)#[\p{L}\p{N}_-]+/gu, ' ').replace(/\s+/g, ' ').trim(),
      };
    }
  }

  // What kind of thing is it?
  take(/^\s*(note|task|todo|to-do|meeting|meet|event)\s*[:\s]\s*/i, (m) => {
    const word = m[1].toLowerCase();
    result.explicit = true;
    if (word === 'note') result.kind = 'note';
    else if (word === 'task' || word === 'todo' || word === 'to-do') result.kind = 'task';
    else {
      result.kind = 'event';
      result.eventKind = word === 'event' ? 'event' : 'meeting';
    }
  }) ||
    take(/^\s*remind(?:er)?(?:\s+me)?(?:\s+to)?\s*[:\s]\s*/i, () => {
      result.explicit = true;
      result.kind = 'event';
      result.eventKind = 'reminder';
    });

  // Tags and priority
  while (take(/\s#([\p{L}\p{N}_-]+)(?=\s)/u, (m) => void result.tagNames.push(m[1]))) { /* collect every #tag */ }
  take(/\s!(high|hi|h|3)(?=\s)/i, () => void (result.priority = 3)) ||
    take(/\s!(medium|med|m|2)(?=\s)/i, () => void (result.priority = 2)) ||
    take(/\s!(low|lo|l|1)(?=\s)/i, () => void (result.priority = 1)) ||
    take(/\s(!{1,3})(?=\s)/, (m) => void (result.priority = m[1].length as Priority));

  if (result.kind === 'note') {
    result.title = tidy(text);
    return result;
  }

  // Duration: "for 45m", "for 1.5 hours"
  take(/\sfor\s+(\d+(?:\.\d+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)(?=\s)/i, (m) => {
    const amount = parseFloat(m[1]);
    result.durationMin = Math.round(m[2].toLowerCase().startsWith('h') ? amount * 60 : amount);
  });

  // Relative offsets: "in 3 days", "in 2 hours"
  let offsetTime: number | null = null;
  take(/\sin\s+(\d+|an?)\s*(minute|min|hour|hr|day|week|month)s?(?=\s)/i, (m) => {
    const amount = /^an?$/i.test(m[1]) ? 1 : parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit.startsWith('min')) offsetTime = now + amount * MIN;
    else if (unit.startsWith('h')) offsetTime = now + amount * HOUR;
    else if (unit === 'day') result.date = addDays(today, amount);
    else if (unit === 'week') result.date = addDays(today, amount * 7);
    else result.date = addMonths(today, amount);
  });

  // Days
  if (result.date === null && offsetTime === null) {
    take(/\s(?:on\s+|by\s+|due\s+)?(today|tonight|tod)(?=\s)/i, (m) => {
      result.date = today;
      if (m[1].toLowerCase() === 'tonight') offsetTime = atMinutes(today, 20 * 60);
    }) ||
      take(/\s(?:on\s+|by\s+|due\s+)?(tomorrow|tmrw|tmr|tom)(?=\s)/i, () => void (result.date = addDays(today, 1))) ||
      take(/\s(?:on\s+|by\s+|due\s+)?next\s+week(?=\s)/i, () => {
        const day = new Date(today).getDay();
        result.date = addDays(today, ((8 - day) % 7) || 7);
      }) ||
      take(/\s(?:on\s+|by\s+|due\s+)?this\s+weekend(?=\s)/i, () => {
        const day = new Date(today).getDay();
        result.date = addDays(today, (6 - day + 7) % 7);
      }) ||
      take(new RegExp(`\\s(?:on\\s+|by\\s+|due\\s+)?(next\\s+)?${DAY_WORD}(?=\\s)`, 'i'), (m) => {
        const target = weekdayIndex(m[2]);
        if (target < 0) return false;
        const day = new Date(today).getDay();
        let ahead = (target - day + 7) % 7 || 7;
        // "next friday" means the one in the following week.
        if (m[1] && ahead <= ((7 - day) % 7 || 7) && day !== 0) ahead += 7;
        result.date = addDays(today, ahead);
      }) ||
      take(/\s(?:on\s+|by\s+|due\s+)?(\d{4})-(\d{2})-(\d{2})(?=\s)/, (m) => {
        const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        if (Number.isNaN(date.getTime())) return false;
        result.date = date.getTime();
      }) ||
      take(new RegExp(`\\s(?:on\\s+|by\\s+|due\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_WORD}(?:\\s+(\\d{4}))?(?=\\s)`, 'i'), (m) =>
        setMonthDay(result, today, monthIndex(m[2]), Number(m[1]), m[3])) ||
      take(new RegExp(`\\s(?:on\\s+|by\\s+|due\\s+)?${MONTH_WORD}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?=\\s)`, 'i'), (m) =>
        setMonthDay(result, today, monthIndex(m[1]), Number(m[2]), m[3]));
  }

  // Time of day
  let minutes: number | null = null;
  let endMinutes: number | null = null;
  take(/\s(?:at\s+|from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (m) => {
    const endHalf = m[6].toLowerCase();
    const startHalf = (m[3] ?? endHalf).toLowerCase();
    minutes = clock(Number(m[1]), Number(m[2] ?? 0), startHalf);
    endMinutes = clock(Number(m[4]), Number(m[5] ?? 0), endHalf);
    if (minutes === null || endMinutes === null) return false;
    // "11-1pm" starts in the morning.
    if (!m[3] && minutes >= endMinutes) minutes -= 12 * 60;
    return minutes >= 0 && endMinutes > minutes;
  }) ||
    take(/\s(?:at\s+|by\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (m) => {
      minutes = clock(Number(m[1]), Number(m[2] ?? 0), m[3].toLowerCase());
      return minutes !== null;
    }) ||
    take(/\s(?:at\s+|by\s+|@\s*)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => void (minutes = Number(m[1]) * 60 + Number(m[2]))) ||
    take(/\s(?:at|@)\s*(\d{1,2})(?=\s)/i, (m) => {
      const hour = Number(m[1]);
      if (hour > 23) return false;
      // A bare "at 3" most likely means the afternoon; "at 9" the morning.
      minutes = (hour >= 1 && hour <= 7 ? hour + 12 : hour) * 60;
    }) ||
    take(/\s(?:at\s+)?(noon|midday)(?=\s)/i, () => void (minutes = 12 * 60)) ||
    take(/\s(?:at\s+)?midnight(?=\s)/i, () => void (minutes = 0)) ||
    take(/\s(?:by\s+)?(eod|end of day)(?=\s)/i, () => void (minutes = 17 * 60)) ||
    take(/\s(?:in the\s+|this\s+)?(morning)(?=\s)/i, () => void (minutes = 9 * 60)) ||
    take(/\s(?:in the\s+|this\s+)?(afternoon)(?=\s)/i, () => void (minutes = 15 * 60)) ||
    take(/\s(?:in the\s+|this\s+)?(evening)(?=\s)/i, () => void (minutes = 18 * 60));

  if (offsetTime !== null) {
    result.date = offsetTime;
    result.hasTime = true;
  } else if (minutes !== null) {
    let day = result.date ?? today;
    // A time that has already passed today means tomorrow.
    if (result.date === null && atMinutes(day, minutes) <= now) day = addDays(day, 1);
    result.date = atMinutes(day, minutes);
    result.hasTime = true;
    if (endMinutes !== null && result.durationMin === null) result.durationMin = endMinutes - minutes;
  }

  // Something with a length is an event, unless the line said otherwise.
  if (!result.explicit && result.durationMin !== null && result.hasTime) result.kind = 'event';
  result.title = tidy(text);
  return result;
}

function setMonthDay(result: Parsed, today: number, month: number, day: number, year?: string): boolean {
  if (month < 0 || day < 1 || day > 31) return false;
  const base = new Date(today);
  let date = new Date(year ? Number(year) : base.getFullYear(), month, day);
  if (date.getMonth() !== month) return false;
  // A date earlier this year means next year.
  if (!year && date.getTime() < today) date = new Date(base.getFullYear() + 1, month, day);
  result.date = date.getTime();
  return true;
}

function clock(hour: number, minute: number, half: string): number | null {
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return ((hour % 12) + (half === 'pm' ? 12 : 0)) * 60 + minute;
}

function tidy(text: string): string {
  const clean = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(on|at|by|due|from|in|for)$/i, '')
    .replace(/^[-–:,]\s*/, '')
    .trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
