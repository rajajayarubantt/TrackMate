// Calendar: day, week, month and agenda views. Shows events, meetings, reminders and dated tasks,
// and lets you create any of them by tapping a time slot (or dragging across one with a mouse).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useQuery, useTagMap } from '../db/hooks';
import { listEvents, listTasks, setTaskDone } from '../db/repo';
import type { Occurrence, Tag, Task } from '../db/types';
import { addDays, addMonths, atMinutes, DAY, fmt, HOUR, MIN, minutesOfDay, relDay, sameDay, startOfDay, startOfMonth, startOfWeek, weekdayLabels } from '../lib/dates';
import { eventColor, occurrencesBetween, TASK_COLOR } from '../lib/events';
import { updateSettings, useSettings } from '../lib/session';
import { Screen } from '../shell/Screen';
import { openSheet } from '../shell/sheets';
import { Check, EmptyState, IconButton, Segmented, useTick } from '../ui/controls';
import { Icon } from '../ui/icons';

type View = 'day' | 'week' | 'month' | 'agenda';

/** Anything the calendar can draw: one occurrence of an event, or a task on its due date. */
export interface CalItem {
  key: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  color: string;
  occ?: Occurrence;
  task?: Task;
}

export function calendarItems(occurrences: Occurrence[], tasks: Task[], tags: Map<string, Tag>, from: number, to: number): CalItem[] {
  const items: CalItem[] = occurrences.map((occ) => ({
    key: `e:${occ.event.id}:${occ.start}`, title: occ.event.title, start: occ.start, end: occ.end,
    allDay: !!occ.event.all_day, color: eventColor(occ.event, tags), occ,
  }));
  for (const task of tasks) {
    if (task.due_at === null || task.due_at < from || task.due_at >= to) continue;
    items.push({
      key: `t:${task.id}`, title: task.title, start: task.due_at, end: task.due_at + (task.due_has_time ? 30 * MIN : DAY),
      allDay: !task.due_has_time, color: TASK_COLOR, task,
    });
  }
  return items.sort((a, b) => a.start - b.start || b.end - a.end);
}

const openItem = (item: CalItem): void => {
  if (item.task) openSheet('task', { id: item.task.id });
  else if (item.occ) openSheet('event', { id: item.occ.event.id, occurrence: item.occ.start });
};

function useWide(): boolean {
  const query = useMemo(() => matchMedia('(min-width: 720px)'), []);
  const [wide, setWide] = useState(query.matches);
  useEffect(() => {
    const onChange = () => setWide(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return wide;
}

// ── Time grid (day and week) ───────────────────────────────────────────────────────────────────

const HOUR_PX = 54;

interface Placed {
  item: CalItem;
  top: number;
  height: number;
  column: number;
  columns: number;
}

/** Lay out one day's timed items side by side where they overlap. */
function placeDay(items: CalItem[], day: number): Placed[] {
  const dayEnd = addDays(day, 1);
  const timed = items
    .filter((item) => !item.allDay && item.start < dayEnd && item.end > day)
    .map((item) => ({ item, from: Math.max(item.start, day), to: Math.max(Math.min(item.end, dayEnd), Math.max(item.start, day) + 20 * MIN) }))
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const placed: Placed[] = [];
  let cluster: { entry: (typeof timed)[number]; column: number }[] = [];
  let ends: number[] = [];
  let clusterEnd = 0;
  const flush = () => {
    for (const { entry, column } of cluster) {
      placed.push({
        item: entry.item, column, columns: ends.length,
        top: ((entry.from - day) / HOUR) * HOUR_PX, height: Math.max(22, ((entry.to - entry.from) / HOUR) * HOUR_PX - 2),
      });
    }
    cluster = [];
    ends = [];
  };
  for (const entry of timed) {
    if (cluster.length && entry.from >= clusterEnd) flush();
    let column = ends.findIndex((end) => end <= entry.from);
    if (column < 0) column = ends.length;
    ends[column] = entry.to;
    clusterEnd = Math.max(clusterEnd, entry.to);
    cluster.push({ entry, column });
  }
  flush();
  return placed;
}

function TimeGrid({ days, items, h24, now }: { days: number[]; items: CalItem[]; h24: boolean; now: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ day: number; from: number; to: number } | null>(null);
  const drag = useRef<{ day: number; anchor: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const today = startOfDay(now);

  // Open around the current time (or 7 am on other days).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focusMinutes = days.includes(today) ? Math.max(0, minutesOfDay(now) - 90) : 7 * 60;
    el.scrollTop = (focusMinutes / 60) * HOUR_PX;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], days.length]);

  const minutesAt = (event: { currentTarget: HTMLElement; clientY: number }, snap: number): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = ((event.clientY - rect.top) / HOUR_PX) * 60;
    return Math.min(24 * 60 - snap, Math.max(0, Math.floor(raw / snap) * snap));
  };

  const create = (day: number, from: number, to: number) => {
    openSheet('event', { draft: { start_at: atMinutes(day, from), end_at: atMinutes(day, Math.min(to, 24 * 60 - 1)) } });
  };

  // Mouse: drag across a column to choose the time range. A tap or plain click adds a one-hour slot.
  // (The slot is created on click, not pointer-up: on touch screens the click that follows a
  // pointer-up would otherwise land on the freshly opened sheet's backdrop and close it.)
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, day: number) => {
    if (event.target !== event.currentTarget || event.pointerType !== 'mouse' || event.button !== 0) return;
    drag.current = { day, anchor: minutesAt(event, 15), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const at = minutesAt(event, 15);
    if (!d.moved && Math.abs(at - d.anchor) < 15) return;
    d.moved = true;
    setSelection({ day: d.day, from: Math.min(d.anchor, at), to: Math.max(d.anchor, at) + 15 });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved && selection) {
      skipClick.current = true;
      create(selection.day, selection.from, selection.to);
    }
    setSelection(null);
  };
  const onClick = (event: ReactMouseEvent<HTMLDivElement>, day: number) => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (event.target !== event.currentTarget) return;
    const from = minutesAt(event, 30);
    create(day, from, from + 60);
  };

  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const allDay = days.map((day) => items.filter((item) => item.allDay && item.start < addDays(day, 1) && item.end > day));
  const hasAllDay = allDay.some((list) => list.length);

  return (
    <div className="tg" style={{ '--days': days.length, '--hour': `${HOUR_PX}px` } as CSSProperties}>
      <div className="tg-head">
        <div className="tg-gutter" />
        {days.map((day) => (
          <div key={day} className="tg-day" data-today={day === today || undefined}>
            <span className="tg-dow">{fmt.weekdayShort(day)}</span>
            <span className="tg-date round">{new Date(day).getDate()}</span>
          </div>
        ))}
      </div>
      {hasAllDay && (
        <div className="tg-allday">
          <div className="tg-gutter">all-day</div>
          {allDay.map((list, index) => (
            <div key={days[index]} className="tg-allday-cell">
              {list.map((item) => <ItemChip key={item.key} item={item} />)}
            </div>
          ))}
        </div>
      )}
      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body">
          <div className="tg-gutter tg-hours">
            {hours.map((hour) => (
              <span key={hour} style={{ top: hour * HOUR_PX }}>{hour === 0 ? '' : fmt.hour(atMinutes(today, hour * 60), h24)}</span>
            ))}
          </div>
          {days.map((day) => (
            <div
              key={day} className="tg-col" data-today={day === today || undefined}
              onPointerDown={(event) => onPointerDown(event, day)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
              onClick={(event) => onClick(event, day)}
              onPointerCancel={() => {
                drag.current = null;
                setSelection(null);
              }}
            >
              {placeDay(items, day).map(({ item, top, height, column, columns }) => (
                <button
                  key={item.key} type="button" className="tg-event" data-task={item.task ? true : undefined}
                  data-done={item.task?.completed_at ? true : undefined} data-short={height < 40 || undefined}
                  style={{
                    '--c': item.color, top, height,
                    left: `calc(${(column / columns) * 100}% + 2px)`, width: `calc(${100 / columns}% - 4px)`,
                  } as CSSProperties}
                  onClick={() => openItem(item)}
                >
                  <span className="tg-event-title">
                    {item.task && <Icon.checkCircleOutline />}
                    {item.occ?.event.kind === 'meeting' && <Icon.video />}
                    {item.occ?.event.kind === 'reminder' && <Icon.bell />}
                    {item.title}
                  </span>
                  <span className="tg-event-time">
                    {fmt.time(item.start, h24)}{item.occ?.event.location ? ` · ${item.occ.event.location}` : ''}
                  </span>
                </button>
              ))}
              {selection?.day === day && (
                <div className="tg-select" style={{ top: (selection.from / 60) * HOUR_PX, height: ((selection.to - selection.from) / 60) * HOUR_PX }}>
                  {fmt.time(atMinutes(day, selection.from), h24)} – {fmt.time(atMinutes(day, Math.min(selection.to, 1439)), h24)}
                </div>
              )}
              {day === today && <div className="tg-now" style={{ top: (minutesOfDay(now) / 60) * HOUR_PX }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ItemChip({ item }: { item: CalItem }) {
  return (
    <button type="button" className="cal-chip" data-task={item.task ? true : undefined} data-done={item.task?.completed_at ? true : undefined}
      style={{ '--c': item.color } as CSSProperties} onClick={(event) => { event.stopPropagation(); openItem(item); }}>
      {item.task && <Icon.checkCircleOutline />}
      <span>{item.title}</span>
    </button>
  );
}

// ── Month ──────────────────────────────────────────────────────────────────────────────────────

function DayList({ day, items, h24 }: { day: number; items: CalItem[]; h24: boolean }) {
  return (
    <div className="day-list">
      <div className="day-list-head">
        <div>
          <div className="day-list-title">{relDay(day)}</div>
          <div className="day-list-sub">{fmt.dayLong(day)}</div>
        </div>
        <IconButton variant="tinted" size="sm" icon={<Icon.add />} label={`Add to ${fmt.dayLong(day)}`}
          onClick={() => openSheet('event', { draft: { start_at: atMinutes(day, 9 * 60), end_at: atMinutes(day, 10 * 60) } })} />
      </div>
      {items.length === 0 ? (
        <p className="day-list-empty">Nothing planned.</p>
      ) : (
        <div className="group">
          {items.map((item) => <AgendaRow key={item.key} item={item} h24={h24} />)}
        </div>
      )}
    </div>
  );
}

export function AgendaRow({ item, h24 }: { item: CalItem; h24: boolean }) {
  const event = item.occ?.event;
  return (
    <div className="item-row agenda-row" role="button" tabIndex={0} style={{ '--c': item.color } as CSSProperties}
      onClick={() => openItem(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openItem(item);
      }}>
      <div className="agenda-time round">
        {item.allDay ? <span>all-day</span> : (
          <>
            <span>{fmt.time(item.start, h24)}</span>
            {!item.task && event?.kind !== 'reminder' && <span className="dim">{fmt.time(item.end, h24)}</span>}
          </>
        )}
      </div>
      <i className="event-bar" />
      <div className="item-main">
        <div className="item-title clamp-1" data-done={item.task?.completed_at ? true : undefined}>{item.title}</div>
        <div className="item-meta">
          <span className="meta">
            {item.task ? 'Task' : event?.kind === 'meeting' ? 'Meeting' : event?.kind === 'reminder' ? 'Reminder' : 'Event'}
            {event?.location ? ` · ${event.location}` : ''}
          </span>
          {event && event.repeat !== 'none' && <span className="meta"><Icon.repeat /></span>}
          {event?.remind_min !== null && event?.remind_min !== undefined && <span className="meta"><Icon.bellOutline /></span>}
        </div>
      </div>
      {item.task && (
        <Check checked={item.task.completed_at !== null} label={`Mark “${item.title}” as done`} color={TASK_COLOR}
          onChange={(done) => setTaskDone((item.task as Task).id, done)} />
      )}
      {event?.meeting_url && (
        <a className="join" href={event.meeting_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <Icon.video />Join
        </a>
      )}
    </div>
  );
}

function MonthView({ cursor, items, weekStart, h24, onPick, now }: { cursor: number; items: CalItem[]; weekStart: number; h24: boolean; onPick: (day: number) => void; now: number }) {
  const month = startOfMonth(cursor);
  const first = startOfWeek(month, weekStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const today = startOfDay(now);
  const monthIndex = new Date(month).getMonth();
  const byDay = useMemo(() => {
    const map = new Map<number, CalItem[]>();
    for (const day of days) map.set(day, items.filter((item) => item.start < addDays(day, 1) && item.end > day));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, first]);
  return (
    <div className="mv">
      <div className="mv-grid-wrap">
        <div className="mv-week">
          {weekdayLabels(weekStart).map((label, i) => <span key={i}>{label}</span>)}
        </div>
        <div className="mv-grid">
          {days.map((day) => {
            const list = byDay.get(day) ?? [];
            return (
              <div key={day} className="mv-cell" role="button" tabIndex={0} aria-label={fmt.dayLong(day)}
                data-out={new Date(day).getMonth() !== monthIndex || undefined} data-today={day === today || undefined}
                data-selected={sameDay(day, cursor) || undefined}
                onClick={() => onPick(day)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onPick(day);
                }}>
                <span className="mv-num round">{new Date(day).getDate()}</span>
                <div className="mv-chips">
                  {list.slice(0, 3).map((item) => <ItemChip key={item.key} item={item} />)}
                  {list.length > 3 && <span className="mv-more">+{list.length - 3} more</span>}
                </div>
                <div className="mv-dots">
                  {list.slice(0, 4).map((item) => <i key={item.key} style={{ background: item.color }} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <DayList day={startOfDay(cursor)} items={byDay.get(startOfDay(cursor)) ?? []} h24={h24} />
    </div>
  );
}

// ── Agenda ─────────────────────────────────────────────────────────────────────────────────────

function AgendaView({ from, items, h24, now }: { from: number; items: CalItem[]; h24: boolean; now: number }) {
  const days = useMemo(() => {
    const out: { day: number; items: CalItem[] }[] = [];
    for (let i = 0; i < 45; i++) {
      const day = addDays(from, i);
      const list = items.filter((item) => item.start < addDays(day, 1) && item.end > day);
      if (list.length || day === startOfDay(now)) out.push({ day, items: list });
    }
    return out;
  }, [items, from, now]);
  if (!days.some((d) => d.items.length)) {
    return <EmptyState icon={<Icon.calendar />} title="Nothing in the next six weeks" text="Events, meetings, reminders and dated tasks will be listed here." />;
  }
  return (
    <div className="agenda">
      {days.map(({ day, items: list }) => (
        <section key={day} className="agenda-day">
          <header data-today={sameDay(day, now) || undefined}>
            <span className="agenda-num round">{new Date(day).getDate()}</span>
            <span className="agenda-label">
              <b>{relDay(day, now)}</b>
              <span>{fmt.weekday(day)}, {fmt.monthDay(day)}</span>
            </span>
          </header>
          {list.length ? (
            <div className="group">{list.map((item) => <AgendaRow key={item.key} item={item} h24={h24} />)}</div>
          ) : (
            <p className="day-list-empty">Nothing planned.</p>
          )}
        </section>
      ))}
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────────────────────

export function CalendarScreen() {
  const settings = useSettings();
  const tags = useTagMap();
  const events = useQuery(listEvents);
  const tasks = useQuery(listTasks);
  const wide = useWide();
  const now = useTick(30_000);
  const [cursor, setCursor] = useState(() => startOfDay(Date.now()));
  const view = settings.calView as View;
  const span = wide ? 7 : 3;

  const days = useMemo(() => {
    if (view === 'day') return [cursor];
    const first = wide ? startOfWeek(cursor, settings.weekStart) : cursor;
    return Array.from({ length: span }, (_, i) => addDays(first, i));
  }, [view, cursor, wide, span, settings.weekStart]);

  const [from, to] = useMemo((): [number, number] => {
    if (view === 'month') {
      const first = startOfWeek(startOfMonth(cursor), settings.weekStart);
      return [first, addDays(first, 42)];
    }
    if (view === 'agenda') return [cursor, addDays(cursor, 45)];
    return [days[0], addDays(days[days.length - 1], 1)];
  }, [view, cursor, days, settings.weekStart]);

  const items = useMemo(
    () => calendarItems(occurrencesBetween(events, from, to), tasks, tags, from, to),
    [events, tasks, tags, from, to],
  );

  const step = (direction: 1 | -1) => {
    if (view === 'month') setCursor(startOfDay(addMonths(cursor, direction)));
    else if (view === 'agenda') setCursor(addDays(cursor, direction * 14));
    else setCursor(addDays(cursor, direction * (view === 'day' ? 1 : span)));
  };

  const heading = view === 'day' ? (wide ? fmt.dayLong(cursor) : fmt.dayShort(cursor)) : fmt.monthYear(view === 'week' ? days[Math.floor(days.length / 2)] : cursor);
  const isToday = sameDay(cursor, now);

  return (
    <Screen
      title="Calendar" fill
      actions={
        <IconButton variant="glass" icon={<Icon.add />} label="New event"
          onClick={() => {
            const base = sameDay(cursor, now) ? Math.ceil((now + 5 * MIN) / (30 * MIN)) * 30 * MIN : atMinutes(cursor, 9 * 60);
            openSheet('event', { draft: { start_at: base, end_at: base + HOUR } });
          }} />
      }
    >
      <div className="cal-head">
        <h2 className="cal-title">{heading}</h2>
        <div className="cal-nav">
          <button type="button" className="icon-btn sm gray" aria-label="Previous" onClick={() => step(-1)}><Icon.chevronBack /></button>
          <button type="button" className="cal-today" disabled={isToday} onClick={() => setCursor(startOfDay(Date.now()))}>Today</button>
          <button type="button" className="icon-btn sm gray" aria-label="Next" onClick={() => step(1)}><Icon.chevronForward /></button>
        </div>
      </div>
      <div className="cal-tools">
        <Segmented
          label="Calendar view" size="sm" full value={view} onChange={(calView) => updateSettings({ calView })}
          options={[
            { value: 'day', label: 'Day' }, { value: 'week', label: wide ? 'Week' : '3 Day' },
            { value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' },
          ]}
        />
      </div>
      <div className="cal-body" data-view={view}>
        {(view === 'day' || view === 'week') && <TimeGrid days={days} items={items} h24={settings.time24} now={now} />}
        {view === 'month' && <MonthView cursor={cursor} items={items} weekStart={settings.weekStart} h24={settings.time24} onPick={setCursor} now={now} />}
        {view === 'agenda' && <AgendaView from={cursor} items={items} h24={settings.time24} now={now} />}
      </div>
    </Screen>
  );
}
