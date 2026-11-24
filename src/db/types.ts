export type ItemType = 'link' | 'task' | 'note' | 'event';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  /** 'multi' gives every app its own tint; otherwise one colour key used everywhere. */
  tint: string;
  /** Liquid Glass: 0 = ultra clear, 100 = fully tinted. */
  glass: number;
  aurora: boolean;
  time24: boolean;
  /** 0 Sunday, 1 Monday, 6 Saturday. */
  weekStart: number;
  taskView: 'list' | 'board';
  linkView: 'grid' | 'list';
  calView: 'day' | 'week' | 'month' | 'agenda';
  notify: boolean;
  chime: boolean;
  /** Where link previews come from: 'auto' asks TrackMate's server first, then Microlink. */
  linkProvider: 'auto' | 'server' | 'microlink' | 'off';
  /** Minutes before start for new events; null = no alert. */
  defaultAlert: number | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  settings: Settings;
  created_at: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  icon: string;
  sort: number;
  created_at: number;
}

export interface LinkItem {
  id: string;
  url: string;
  title: string;
  description: string;
  note: string;
  image: string;
  favicon: string;
  site_name: string;
  pinned: number;
  is_read: number;
  opens: number;
  created_at: number;
  updated_at: number;
  tagIds: string[];
}

export interface Stage {
  id: string;
  name: string;
  color: string;
  sort: number;
  is_done: number;
  wip_limit: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export type Priority = 0 | 1 | 2 | 3;

export interface Task {
  id: string;
  title: string;
  notes: string;
  stage_id: string;
  sort: number;
  priority: Priority;
  due_at: number | null;
  due_has_time: number;
  remind_at: number | null;
  checklist: ChecklistItem[];
  completed_at: number | null;
  focus_minutes: number;
  created_at: number;
  updated_at: number;
  tagIds: string[];
}

export type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'todo' | 'quote' | 'callout' | 'code' | 'divider';

export interface Block {
  id: string;
  type: BlockType;
  html: string;
  checked?: boolean;
}

export interface Note {
  id: string;
  title: string;
  content: Block[];
  plain: string;
  pinned: number;
  created_at: number;
  updated_at: number;
  tagIds: string[];
}

export type EventKind = 'meeting' | 'event' | 'reminder';
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export interface CalEvent {
  id: string;
  title: string;
  kind: EventKind;
  start_at: number;
  end_at: number;
  all_day: number;
  location: string;
  meeting_url: string;
  attendees: string;
  notes: string;
  color: string;
  remind_min: number | null;
  repeat: Repeat;
  repeat_until: number | null;
  exdates: number[];
  created_at: number;
  updated_at: number;
  tagIds: string[];
}

/** One concrete occurrence of an event (recurring events expand into many). */
export interface Occurrence {
  event: CalEvent;
  start: number;
  end: number;
}

export interface ReminderEntry {
  key: string;
  title: string;
  body: string;
  item_type: 'task' | 'event' | 'focus';
  item_id: string;
  fire_at: number;
  fired_at: number;
  seen: number;
}

export interface FocusSession {
  id: string;
  task_id: string | null;
  minutes: number;
  ended_at: number;
}
