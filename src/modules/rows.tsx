// Compact rows for links, tasks, notes and events. Shared by Today, Tags, search and the lists.
import { useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { setTaskDone } from '../db/repo';
import type { LinkItem, Note, Occurrence, Stage, Tag, Task } from '../db/types';
import { ago, fmt, relDay, startOfDay } from '../lib/dates';
import { eventColor } from '../lib/events';
import { faviconFor, hostOf } from '../lib/linkmeta';
import { navigate } from '../lib/router';
import { hueOf, PRIORITY } from '../lib/tints';
import { openSheet } from '../shell/sheets';
import { Check } from '../ui/controls';
import { Icon } from '../ui/icons';
import { TagChip } from '../ui/pickers';

const onEnter = (action: () => void) => (event: KeyboardEvent<HTMLElement>) => {
  if (event.key === 'Enter' && event.target === event.currentTarget) action();
};

export function Favicon({ url, favicon, size = 20 }: { url: string; favicon: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  const style = { '--h': hueOf(host), '--s': `${size}px` } as CSSProperties;
  if (failed) {
    return <span className="favicon letter" style={style}>{host.charAt(0).toUpperCase()}</span>;
  }
  return (
    <img className="favicon" style={style} src={favicon || faviconFor(url)} alt="" loading="lazy" referrerPolicy="no-referrer"
      onError={() => setFailed(true)} />
  );
}

export function dueInfo(task: Task, h24: boolean, now = Date.now()): { label: string; overdue: boolean } | null {
  if (task.due_at === null) return null;
  const late = task.due_has_time ? task.due_at < now : startOfDay(task.due_at) < startOfDay(now);
  const label = task.due_has_time ? `${relDay(task.due_at, now)}, ${fmt.time(task.due_at, h24)}` : relDay(task.due_at, now);
  return { label, overdue: late && task.completed_at === null };
}

interface TaskRowProps {
  task: Task;
  tags: Map<string, Tag>;
  h24: boolean;
  stage?: Stage;
  trailing?: ReactNode;
}

export function TaskRow({ task, tags, h24, stage, trailing }: TaskRowProps) {
  const done = task.completed_at !== null;
  const due = dueInfo(task, h24);
  const open = () => openSheet('task', { id: task.id });
  const checked = task.checklist.filter((item) => item.done).length;
  return (
    <div className="item-row task-row" role="button" tabIndex={0} data-done={done || undefined} onClick={open} onKeyDown={onEnter(open)}>
      <Check
        checked={done} label={done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
        color={task.priority ? PRIORITY[task.priority].color : undefined}
        onChange={(next) => setTaskDone(task.id, next)}
      />
      <div className="item-main">
        <div className="item-title">{task.title}</div>
        {(due || stage || task.tagIds.length > 0 || task.checklist.length > 0 || task.remind_at || task.priority > 0) && (
          <div className="item-meta">
            {due && (
              <span className="meta" data-overdue={due.overdue || undefined}>
                <Icon.calendarOutline />
                {due.label}
              </span>
            )}
            {task.priority > 0 && (
              <span className="meta" style={{ color: PRIORITY[task.priority].color }}>
                <Icon.flag />
                {PRIORITY[task.priority].label}
              </span>
            )}
            {task.checklist.length > 0 && (
              <span className="meta">
                <Icon.checkboxOutline />
                {checked}/{task.checklist.length}
              </span>
            )}
            {task.remind_at !== null && !done && <span className="meta"><Icon.bellOutline /></span>}
            {stage && (
              <span className="meta">
                <i className="dot" style={{ background: stage.color }} />
                {stage.name}
              </span>
            )}
            {task.tagIds.map((id) => {
              const tag = tags.get(id);
              return tag ? <TagChip key={id} tag={tag} size="sm" /> : null;
            })}
          </div>
        )}
      </div>
      {trailing}
    </div>
  );
}

export function LinkRow({ link }: { link: LinkItem }) {
  const open = () => openSheet('link', { id: link.id });
  return (
    <div className="item-row" role="button" tabIndex={0} onClick={open} onKeyDown={onEnter(open)}>
      <span className="item-lead"><Favicon url={link.url} favicon={link.favicon} size={22} /></span>
      <div className="item-main">
        <div className="item-title clamp-1">{link.title || hostOf(link.url)}</div>
        <div className="item-meta"><span className="meta">{link.site_name || hostOf(link.url)} · {ago(link.created_at)}</span></div>
      </div>
      {!link.is_read && <i className="unread-dot" aria-label="Unread" />}
    </div>
  );
}

export function NoteRow({ note }: { note: Note }) {
  const open = () => navigate('notes', note.id);
  return (
    <div className="item-row" role="button" tabIndex={0} onClick={open} onKeyDown={onEnter(open)}>
      <span className="item-lead ink"><Icon.noteOutline /></span>
      <div className="item-main">
        <div className="item-title clamp-1">{note.title || 'Untitled'}</div>
        <div className="item-meta"><span className="meta clamp-1">{ago(note.updated_at)}{note.plain ? ` · ${note.plain.slice(0, 80)}` : ''}</span></div>
      </div>
    </div>
  );
}

export function EventRow({ occ, tags, h24, showDay }: { occ: Occurrence; tags: Map<string, Tag>; h24: boolean; showDay?: boolean }) {
  const { event } = occ;
  const open = () => openSheet('event', { id: event.id, occurrence: occ.start });
  const when = event.all_day ? 'All day' : `${fmt.time(occ.start, h24)} – ${fmt.time(occ.end, h24)}`;
  return (
    <div className="item-row event-row" role="button" tabIndex={0} onClick={open} onKeyDown={onEnter(open)}
      style={{ '--c': eventColor(event, tags) } as CSSProperties}>
      <i className="event-bar" />
      <div className="item-main">
        <div className="item-title clamp-1">{event.title}</div>
        <div className="item-meta">
          <span className="meta">
            {showDay ? `${relDay(occ.start)} · ` : ''}{when}
            {event.location ? ` · ${event.location}` : ''}
          </span>
          {event.repeat !== 'none' && <span className="meta"><Icon.repeat /></span>}
        </div>
      </div>
      {event.meeting_url && (
        <a className="join" href={event.meeting_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
          <Icon.video />
          Join
        </a>
      )}
    </div>
  );
}
