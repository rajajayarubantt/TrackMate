// Today: what is next, what is due, and what you saved for later — across every app.
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useQuery, useTagMap, useTags } from '../db/hooks';
import { focusSince, listEvents, listLinks, listNotes, listStages, listTasks, unseenReminderCount } from '../db/repo';
import type { Occurrence } from '../db/types';
import { addDays, fmt, greeting, HOUR, startOfDay, until } from '../lib/dates';
import { eventColor, occurrencesBetween } from '../lib/events';
import { hostOf } from '../lib/linkmeta';
import { navigate } from '../lib/router';
import { useUser } from '../lib/session';
import { Screen } from '../shell/Screen';
import { openSheet } from '../shell/sheets';
import { Group, IconButton, useTick } from '../ui/controls';
import { Icon } from '../ui/icons';
import { TagChip } from '../ui/pickers';
import { AgendaRow, calendarItems } from './Calendar';
import { LinkBanner } from './Links';
import { newNote } from './Notes';
import { TaskRow } from './rows';

function Ring({ ratio, color }: { ratio: number; color: string }) {
  const circumference = 2 * Math.PI * 30;
  return (
    <svg className="ring" viewBox="0 0 72 72" aria-hidden="true">
      <circle cx="36" cy="36" r="30" className="ring-track" style={{ stroke: color }} />
      <circle cx="36" cy="36" r="30" className="ring-value" style={{ stroke: color }}
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, ratio)))} />
    </svg>
  );
}

function UpNext({ occ, now, color, h24 }: { occ: Occurrence | undefined; now: number; color: string; h24: boolean }) {
  if (!occ) {
    return (
      <div className="upnext card" data-empty>
        <div className="upnext-label">Up next</div>
        <div className="upnext-title">Nothing else on the calendar</div>
        <p className="upnext-sub">The next day and a half is clear. A good moment for focused work.</p>
      </div>
    );
  }
  const { event } = occ;
  const live = occ.start <= now;
  return (
    <div className="upnext" role="button" tabIndex={0} style={{ '--c': color } as CSSProperties}
      onClick={() => openSheet('event', { id: event.id, occurrence: occ.start })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) openSheet('event', { id: event.id, occurrence: occ.start });
      }}>
      <div className="upnext-label">
        {live ? <><i className="pulse" />Happening now</> : <>Up next · {until(occ.start, now)}</>}
      </div>
      <div className="upnext-title">{event.title}</div>
      <p className="upnext-sub">
        {fmt.time(occ.start, h24)}{event.kind === 'reminder' ? '' : ` – ${fmt.time(occ.end, h24)}`}
        {event.location ? ` · ${event.location}` : ''}
        {event.attendees ? ` · ${event.attendees}` : ''}
      </p>
      {event.meeting_url && (
        <a className="upnext-join" href={event.meeting_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <Icon.video />
          Join
        </a>
      )}
    </div>
  );
}

export function TodayScreen() {
  const user = useUser();
  const h24 = user.settings.time24;
  const now = useTick(30_000);
  const today = startOfDay(now);
  const tags = useTags();
  const tagMap = useTagMap();
  const events = useQuery(listEvents);
  const tasks = useQuery(listTasks);
  const stages = useQuery(listStages);
  const links = useQuery(listLinks);
  const notes = useQuery(listNotes);
  const unseen = useQuery(unseenReminderCount);
  const sessions = useQuery(() => focusSince(addDays(today, -6)), [today]);

  const next = useMemo(
    () => occurrencesBetween(events, now - 6 * HOUR, now + 36 * HOUR).find((occ) => !occ.event.all_day && occ.end > now),
    [events, now],
  );
  const schedule = useMemo(() => {
    const tomorrow = addDays(today, 1);
    return calendarItems(occurrencesBetween(events, today, tomorrow), tasks.filter((task) => task.due_has_time), tagMap, today, tomorrow);
  }, [events, tasks, tagMap, today]);

  const stageMap = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const due = useMemo(
    () => tasks.filter((task) => task.completed_at === null && task.due_at !== null && startOfDay(task.due_at) <= today)
      .sort((a, b) => (a.due_at ?? 0) - (b.due_at ?? 0) || b.priority - a.priority),
    [tasks, today],
  );
  const doneToday = tasks.filter((task) => task.completed_at !== null && task.completed_at >= today).length;
  const totalToday = doneToday + due.length;

  const focusByDay = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => ({ day: addDays(today, i - 6), minutes: 0 }));
    for (const session of sessions) {
      const slot = days.find((d) => d.day === startOfDay(session.ended_at));
      if (slot) slot.minutes += session.minutes;
    }
    return days;
  }, [sessions, today]);
  const focusToday = focusByDay[6].minutes;
  const focusMax = Math.max(30, ...focusByDay.map((d) => d.minutes));

  const unread = links.filter((link) => !link.is_read).slice(0, 8);
  const pinned = [...notes].sort((a, b) => b.pinned - a.pinned || b.updated_at - a.updated_at).slice(0, 6);
  const firstName = user.name.split(/\s+/)[0];

  return (
    <Screen
      title={`${greeting(now)}, ${firstName}`} wide eyebrow={fmt.dayLong(now)}
      actions={
        <>
          <IconButton variant="glass" icon={<Icon.search />} label="Search or add" onClick={() => openSheet('capture', {})} />
          <IconButton variant="glass" icon={<Icon.bellOutline />} label="Reminders" badge={unseen} onClick={() => openSheet('alerts', true)} />
        </>
      }
    >
      <div className="today">
        <div className="today-main">
          <UpNext occ={next} now={now} h24={h24} color={next ? eventColor(next.event, tagMap) : ''} />

          <div className="section-head">
            <h2>Schedule</h2>
            <button type="button" onClick={() => navigate('calendar')}>Calendar</button>
          </div>
          {schedule.length ? (
            <div className="group">{schedule.map((item) => <AgendaRow key={item.key} item={item} h24={h24} />)}</div>
          ) : (
            <button type="button" className="empty-row card" onClick={() => openSheet('event', { draft: {} })}>
              <Icon.add />
              Nothing scheduled today. Add an event.
            </button>
          )}

          <div className="section-head">
            <h2>Due</h2>
            <button type="button" onClick={() => navigate('tasks')}>All tasks</button>
          </div>
          {due.length ? (
            <Group>{due.slice(0, 6).map((task) => <TaskRow key={task.id} task={task} tags={tagMap} h24={h24} stage={stageMap.get(task.stage_id)} />)}</Group>
          ) : (
            <button type="button" className="empty-row card" onClick={() => openSheet('task', { draft: { due_at: today } })}>
              <Icon.add />
              Nothing due today. Add a task.
            </button>
          )}
          {due.length > 6 && <button type="button" className="more-link" onClick={() => navigate('tasks')}>{due.length - 6} more due</button>}
        </div>

        <div className="today-side">
          <div className="widgets">
            <button type="button" className="widget card" onClick={() => navigate('tasks')}>
              <span className="widget-label"><Icon.checkCircle style={{ color: 'var(--orange)' }} />Tasks today</span>
              <span className="widget-ring">
                <Ring ratio={totalToday ? doneToday / totalToday : 0} color="var(--orange)" />
                <span className="widget-ring-text round"><b>{doneToday}</b>/{totalToday}</span>
              </span>
              <span className="widget-foot">{totalToday === 0 ? 'Nothing due' : due.length === 0 ? 'All done' : `${due.length} to go`}</span>
            </button>
            <div className="widget card">
              <span className="widget-label"><Icon.timer style={{ color: 'var(--indigo)' }} />Focus</span>
              <span className="widget-number round">{focusToday}<small>min</small></span>
              <span className="bars" aria-label="Focus minutes over the last 7 days">
                {focusByDay.map((d) => (
                  <i key={d.day} data-today={d.day === today || undefined} style={{ height: `${Math.max(8, (d.minutes / focusMax) * 100)}%` }} />
                ))}
              </span>
              <span className="widget-foot">Last 7 days</span>
            </div>
          </div>

          {unread.length > 0 && (
            <>
              <div className="section-head">
                <h2>Read later</h2>
                <button type="button" onClick={() => navigate('links')}>All links</button>
              </div>
              <div className="strip no-bar">
                {unread.map((link) => (
                  <button key={link.id} type="button" className="strip-card card" onClick={() => openSheet('link', { id: link.id })}>
                    <LinkBanner link={link} />
                    <span className="strip-title clamp-2">{link.title || hostOf(link.url)}</span>
                    <span className="strip-sub clamp-1">{link.site_name || hostOf(link.url)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="section-head">
            <h2>Notes</h2>
            <button type="button" onClick={() => newNote()}>New note</button>
          </div>
          {pinned.length ? (
            <div className="strip no-bar">
              {pinned.map((note) => (
                <button key={note.id} type="button" className="strip-card strip-note card" onClick={() => navigate('notes', note.id)}>
                  <span className="strip-title clamp-2">
                    {note.pinned ? <Icon.pin className="note-card-pin" /> : null}
                    {note.title || 'Untitled'}
                  </span>
                  <span className="strip-body clamp-3">{note.plain || 'No additional text'}</span>
                </button>
              ))}
            </div>
          ) : (
            <button type="button" className="empty-row card" onClick={() => newNote()}>
              <Icon.add />
              Start your first note.
            </button>
          )}

          {tags.length > 0 && (
            <>
              <div className="section-head">
                <h2>Tags</h2>
                <button type="button" onClick={() => navigate('tags')}>Manage</button>
              </div>
              <div className="chips">
                {tags.map((tag) => <TagChip key={tag.id} tag={tag} onClick={() => navigate('tags', tag.id)} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}
