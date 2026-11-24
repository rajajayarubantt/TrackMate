// Reminders: the engine that decides when one is due, and the list of what has gone off.
// Everything runs in the page, so reminders only fire while TrackMate is open.
import { useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '../db/hooks';
import {
  clearReminders, getEvent, getTask, listEvents, listTasks, logReminder, markRemindersSeen, pendingSnoozes, pruneReminders,
  recentReminders, reminderKeys, setTaskDone,
} from '../db/repo';
import type { ReminderEntry } from '../db/types';
import { ago, DAY, fmt, MIN, relDateTime, until } from '../lib/dates';
import { KIND_COLOR, occurrencesBetween, TASK_COLOR } from '../lib/events';
import { uid } from '../lib/id';
import { playChime, systemNotify } from '../lib/notify';
import { getSettings, useSettings } from '../lib/session';
import { EmptyState, Group, useTick } from '../ui/controls';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/overlay';
import { pushBanner } from './Banners';
import { closeSheet, openSheet } from './sheets';

type Due = Omit<ReminderEntry, 'fired_at' | 'seen'>;

function openItem(entry: Pick<ReminderEntry, 'item_type' | 'item_id'>): void {
  if (entry.item_type === 'task' && getTask(entry.item_id)) openSheet('task', { id: entry.item_id });
  else if (entry.item_type === 'event' && getEvent(entry.item_id)) openSheet('event', { id: entry.item_id });
}

/** Reminders that are due now (`upTo` = now) or coming up (`upTo` in the future). */
function collect(from: number, upTo: number, h24: boolean): Due[] {
  const list: Due[] = [];
  for (const task of listTasks()) {
    if (task.remind_at === null || task.completed_at !== null || task.remind_at > upTo || task.remind_at < from) continue;
    if (task.remind_at < task.created_at) continue; // set in the past: nothing to announce
    list.push({
      key: `task:${task.id}:${task.remind_at}`, title: task.title, item_type: 'task', item_id: task.id, fire_at: task.remind_at,
      body: task.due_at !== null ? `Due ${relDateTime(task.due_at, !!task.due_has_time, h24)}` : 'Task reminder',
    });
  }
  const events = listEvents().filter((event) => event.remind_min !== null);
  for (const occ of occurrencesBetween(events, from - DAY, upTo + 2 * DAY)) {
    const fireAt = occ.start - (occ.event.remind_min as number) * MIN;
    if (fireAt > upTo || fireAt < from || fireAt < occ.event.created_at) continue;
    list.push({
      key: `event:${occ.event.id}:${occ.start}`, title: occ.event.title, item_type: 'event', item_id: occ.event.id, fire_at: fireAt,
      body: `${occ.event.all_day ? relDateTime(occ.start, false, h24) : fmt.time(occ.start, h24)}${occ.event.location ? ` · ${occ.event.location}` : ''}`,
    });
  }
  return list.sort((a, b) => a.fire_at - b.fire_at);
}

function snooze(entry: Due, minutes: number): void {
  logReminder({ ...entry, key: `snooze:${uid(8)}`, fire_at: Date.now() + minutes * MIN, fired_at: 0 });
}

function announce(entry: Due): void {
  const event = entry.item_type === 'event' ? getEvent(entry.item_id) : undefined;
  const joinUrl = event?.meeting_url;
  pushBanner({
    id: entry.key, title: entry.title, text: entry.body, sticky: true,
    color: entry.item_type === 'task' ? TASK_COLOR : event ? event.color || KIND_COLOR[event.kind] : 'var(--red)',
    icon: entry.item_type === 'task' ? <Icon.checkCircle /> : event?.kind === 'meeting' ? <Icon.video /> : <Icon.bell />,
    onOpen: () => openItem(entry),
    actions: [
      ...(entry.item_type === 'task' ? [{ label: 'Mark done', primary: true, onSelect: () => setTaskDone(entry.item_id, true) }] : []),
      ...(joinUrl ? [{ label: 'Join', primary: true, onSelect: () => void window.open(joinUrl, '_blank', 'noopener,noreferrer') }] : []),
      { label: 'Snooze 10 min', onSelect: () => snooze(entry, 10) },
    ],
  });
}

function check(): void {
  const now = Date.now();
  const settings = getSettings();
  const known = reminderKeys();
  const due = [
    ...collect(now - 2 * DAY, now, settings.time24).filter((entry) => !known.has(entry.key)),
    ...pendingSnoozes(now),
  ];
  if (!due.length) return;
  // Anything that came due a while ago (TrackMate was closed) is listed quietly rather than replayed.
  const fresh = due.filter((entry) => now - entry.fire_at < 5 * MIN);
  const missed = due.filter((entry) => now - entry.fire_at >= 5 * MIN);
  for (const entry of due) logReminder({ ...entry, fired_at: now });
  fresh.forEach(announce);
  if (missed.length) {
    pushBanner({
      id: 'missed', color: 'var(--orange)',
      title: missed.length === 1 ? `Missed reminder: ${missed[0].title}` : `${missed.length} reminders came due while you were away`,
      text: 'Tap to see them.', onOpen: () => openSheet('alerts', true),
    });
  }
  if (fresh.length) {
    if (settings.chime) playChime();
    if (settings.notify) fresh.forEach((entry) => void systemNotify(entry.title, entry.body, entry.key));
  }
}

/** Start checking for due reminders. Mounted once, by the shell. */
export function useReminderEngine(): void {
  useEffect(() => {
    pruneReminders(Date.now() - 60 * DAY);
    const first = window.setTimeout(check, 1200);
    const timer = window.setInterval(check, 15_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

export function AlertsSheet({ open }: { open: boolean }) {
  const settings = useSettings();
  const recent = useQuery(recentReminders);
  const now = useTick(30_000);
  const upcoming = useQuery(() => (open ? collect(now + 1, now + 2 * DAY, settings.time24).slice(0, 6) : []), [open, now, settings.time24]);
  const unseen = useMemo(() => new Set(recent.filter((entry) => !entry.seen).map((entry) => entry.key)), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(markRemindersSeen, 800);
    return () => clearTimeout(timer);
  }, [open]);

  const close = () => closeSheet('alerts');
  const row = (entry: Due | ReminderEntry, when: string, fresh: boolean) => (
    <div key={entry.key} className="item-row alert-row" role="button" tabIndex={0}
      onClick={() => {
        close();
        openItem(entry);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          close();
          openItem(entry);
        }
      }}>
      <span className="row-icon filled" style={{ '--c': entry.item_type === 'task' ? TASK_COLOR : 'var(--red)' } as CSSProperties}>
        {entry.item_type === 'task' ? <Icon.checkCircle /> : <Icon.bell />}
      </span>
      <div className="item-main">
        <div className="item-title clamp-1">{entry.title}</div>
        <div className="item-meta"><span className="meta clamp-1">{entry.body}</span></div>
      </div>
      <span className="alert-when">{when}</span>
      {fresh && <i className="unread-dot" />}
    </div>
  );

  return (
    <Sheet open={open} onClose={close} title="Reminders">
      {upcoming.length === 0 && recent.length === 0 && (
        <EmptyState icon={<Icon.bell />} title="No reminders yet"
          text="Add a reminder to a task, or an alert to an event, and it will show up here when it is due." />
      )}
      {upcoming.length > 0 && (
        <Group title="Coming up">{upcoming.map((entry) => row(entry, until(entry.fire_at, now), false))}</Group>
      )}
      {recent.length > 0 && (
        <Group title="Earlier">{recent.map((entry) => row(entry, ago(entry.fired_at, now), unseen.has(entry.key)))}</Group>
      )}
      {recent.length > 0 && (
        <div className="sheet-foot">
          <button type="button" className="btn btn-gray btn-md btn-full" onClick={clearReminders}>Clear earlier reminders</button>
        </div>
      )}
      <p className="about">
        {settings.notify ? 'System notifications are on.' : 'Turn on system notifications in Settings to be alerted outside this tab.'}
        {' '}Reminders fire while TrackMate is open.
      </p>
    </Sheet>
  );
}
