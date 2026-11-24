// Typed queries and changes. Everything here runs synchronously against the in-memory copy of the
// account's data (store.ts), which saves each change to MongoDB in the background.
//
// Stored documents are never edited in place: a change builds a new document and stores that.
// What the queries return are copies, so screens are free to modify them.
import { uid } from '../lib/id';
import { find, put, remove, rows } from './store';
import type { CollectionName, Doc } from './store';
import type {
  Block, CalEvent, ChecklistItem, FocusSession, ItemType, LinkItem, Note, Priority, ReminderEntry, Stage, Tag, Task,
} from './types';

let userId = '';
export const setRepoUser = (id: string): void => {
  userId = id;
};
export const repoUser = (): string => userId;

const now = (): number => Date.now();

/** Sample content is marked so it can be removed later; the mark never leaves this file. */
type Stored<T> = T & { sample?: boolean };
const marked = (sample: boolean): { sample?: boolean } => (sample ? { sample: true } : {});

const COLLECTION: Record<ItemType, CollectionName> = { link: 'links', task: 'tasks', note: 'notes', event: 'events' };
const ITEM_TYPES = Object.keys(COLLECTION) as ItemType[];

const save = (collection: CollectionName, doc: object): void => put(collection, doc as Doc);

/** Change only the listed fields of a document. Fields left undefined are untouched. */
function patch<T extends object>(collection: CollectionName, id: string, fields: Partial<T>, allowed: readonly (keyof T)[], stamp: boolean): void {
  const current = find<T>(collection, id);
  if (!current) return;
  const next = { ...current } as Record<string, unknown>;
  let changed = false;
  for (const key of allowed) {
    const value = fields[key] as unknown;
    if (value === undefined) continue;
    // Yes/no fields are stored as 1 and 0.
    next[key as string] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    changed = true;
  }
  if (!changed) return;
  if (stamp) next.updated_at = now();
  put(collection, next);
}

const compareText = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
const maxOf = (values: number[]): number => values.reduce((top, value) => Math.max(top, value), 0);

// ── Tags ───────────────────────────────────────────────────────────────────────────────────────

export function listTags(): Tag[] {
  return rows<Stored<Tag>>('tags')
    .map((tag): Tag => ({ id: tag.id, name: tag.name, color: tag.color, icon: tag.icon, sort: tag.sort, created_at: tag.created_at }))
    .sort((a, b) => a.sort - b.sort || compareText(a.name, b.name));
}

export function createTag(data: { name: string; color: string; icon: string }, sample = false): Tag {
  const tag: Tag = {
    id: uid(), name: data.name.trim(), color: data.color, icon: data.icon,
    sort: maxOf(rows<Tag>('tags').map((t) => t.sort)) + 1, created_at: now(),
  };
  save('tags', { ...tag, ...marked(sample) });
  return tag;
}

export function updateTag(id: string, fields: Partial<Pick<Tag, 'name' | 'color' | 'icon' | 'sort'>>): void {
  patch<Tag>('tags', id, fields, ['name', 'color', 'icon', 'sort'], false);
}

export function deleteTag(id: string): void {
  for (const type of ITEM_TYPES) {
    for (const item of rows<{ id: string; tagIds: string[] }>(COLLECTION[type])) {
      if (item.tagIds.includes(id)) save(COLLECTION[type], { ...item, tagIds: item.tagIds.filter((tagId) => tagId !== id) });
    }
  }
  remove('tags', id);
}

export type TagCounts = Record<string, Record<ItemType, number>>;
export function tagCounts(): TagCounts {
  const known = new Set(rows<Tag>('tags').map((tag) => tag.id));
  const counts: TagCounts = {};
  for (const type of ITEM_TYPES) {
    for (const item of rows<{ tagIds: string[] }>(COLLECTION[type])) {
      for (const tagId of item.tagIds) {
        if (!known.has(tagId)) continue;
        counts[tagId] ??= { link: 0, task: 0, note: 0, event: 0 };
        counts[tagId][type]++;
      }
    }
  }
  return counts;
}

/** Puts an item's tags in the order the Tag Manager shows them, leaving out tags that no longer exist. */
function tagSorter(): (ids: string[]) => string[] {
  const rank = new Map(listTags().map((tag, index) => [tag.id, index]));
  return (ids) => ids.filter((id) => rank.has(id)).sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number));
}

export function setItemTags(type: ItemType, itemId: string, tagIds: string[]): void {
  const item = find<object>(COLLECTION[type], itemId);
  if (item) save(COLLECTION[type], { ...item, tagIds: [...new Set(tagIds)] });
}

// ── Links ──────────────────────────────────────────────────────────────────────────────────────

type LinkRow = Omit<LinkItem, 'tagIds'>;

const toLink = (row: Stored<LinkItem>, sortTags: (ids: string[]) => string[]): LinkItem => ({
  id: row.id, url: row.url, title: row.title, description: row.description, note: row.note, image: row.image, favicon: row.favicon,
  site_name: row.site_name, pinned: row.pinned, is_read: row.is_read, opens: row.opens, created_at: row.created_at,
  updated_at: row.updated_at, tagIds: sortTags(row.tagIds),
});

export function listLinks(): LinkItem[] {
  const sortTags = tagSorter();
  return rows<Stored<LinkItem>>('links').map((row) => toLink(row, sortTags)).sort((a, b) => b.created_at - a.created_at);
}

export function insertLink(link: LinkItem, sample = false): void {
  save('links', {
    id: link.id, url: link.url, title: link.title, description: link.description, note: link.note, image: link.image,
    favicon: link.favicon, site_name: link.site_name, pinned: link.pinned ? 1 : 0, is_read: link.is_read ? 1 : 0, opens: link.opens,
    created_at: link.created_at, updated_at: link.updated_at, tagIds: [...new Set(link.tagIds)], ...marked(sample),
  });
}

export function createLink(data: Partial<LinkItem> & { url: string }, sample = false): LinkItem {
  const t = now();
  const link: LinkItem = {
    id: uid(), url: data.url, title: data.title ?? '', description: data.description ?? '', note: data.note ?? '',
    image: data.image ?? '', favicon: data.favicon ?? '', site_name: data.site_name ?? '', pinned: data.pinned ?? 0,
    is_read: data.is_read ?? 0, opens: 0, created_at: data.created_at ?? t, updated_at: t, tagIds: data.tagIds ?? [],
  };
  insertLink(link, sample);
  return link;
}

export function updateLink(id: string, fields: Partial<LinkRow>): void {
  patch<LinkRow>('links', id, fields, [
    'url', 'title', 'description', 'note', 'image', 'favicon', 'site_name', 'pinned', 'is_read', 'opens', 'created_at',
  ], true);
}

export function deleteLink(id: string): void {
  remove('links', id);
}

// ── Stages (board columns) ─────────────────────────────────────────────────────────────────────

export function listStages(): Stage[] {
  return rows<Stage>('stages').map((stage) => ({ ...stage })).sort((a, b) => a.sort - b.sort);
}

export function createStage(name: string, color: string, isDone = false, id = uid()): Stage {
  const stage: Stage = {
    id, name: name.trim(), color, sort: maxOf(rows<Stage>('stages').map((s) => s.sort)) + 1, is_done: isDone ? 1 : 0, wip_limit: 0,
  };
  save('stages', stage);
  return stage;
}

export function updateStage(id: string, fields: Partial<Pick<Stage, 'name' | 'color' | 'wip_limit'>>): void {
  patch<Stage>('stages', id, fields, ['name', 'color', 'wip_limit'], false);
}

/** Mark a column as the place finished work goes; tasks in it are completed (or reopened). */
export function setStageDone(id: string, isDone: boolean): void {
  patch<Stage>('stages', id, { is_done: isDone ? 1 : 0 }, ['is_done'], false);
  const t = now();
  for (const task of rows<Stored<Task>>('tasks')) {
    if (task.stage_id !== id) continue;
    if (isDone && task.completed_at === null) save('tasks', { ...task, completed_at: t });
    else if (!isDone && task.completed_at !== null) save('tasks', { ...task, completed_at: null });
  }
}

export function reorderStages(ids: string[]): void {
  ids.forEach((id, index) => {
    const stage = find<Stage>('stages', id);
    if (stage && stage.sort !== index + 1) save('stages', { ...stage, sort: index + 1 });
  });
}

/** Delete a column, moving its tasks to another one. */
export function deleteStage(id: string, moveTo: string): void {
  const target = find<Stage>('stages', moveTo);
  const tasks = rows<Stored<Task>>('tasks');
  const top = maxOf(tasks.filter((task) => task.stage_id === moveTo).map((task) => task.sort));
  const t = now();
  tasks
    .filter((task) => task.stage_id === id)
    .sort((a, b) => a.sort - b.sort)
    .forEach((task, index) => {
      save('tasks', { ...task, stage_id: moveTo, sort: top + index + 1, completed_at: target?.is_done ? t : null });
    });
  remove('stages', id);
}

// ── Tasks ──────────────────────────────────────────────────────────────────────────────────────

const checklistOf = (items: ChecklistItem[] | undefined): ChecklistItem[] =>
  (items ?? []).map((item) => ({ id: item.id, text: item.text, done: !!item.done }));

const toTask = (row: Stored<Task>, sortTags: (ids: string[]) => string[]): Task => ({
  id: row.id, title: row.title, notes: row.notes, stage_id: row.stage_id, sort: row.sort, priority: row.priority, due_at: row.due_at,
  due_has_time: row.due_has_time, remind_at: row.remind_at, checklist: checklistOf(row.checklist), completed_at: row.completed_at,
  focus_minutes: row.focus_minutes, created_at: row.created_at, updated_at: row.updated_at, tagIds: sortTags(row.tagIds),
});

export function listTasks(): Task[] {
  const sortTags = tagSorter();
  return rows<Stored<Task>>('tasks').map((row) => toTask(row, sortTags)).sort((a, b) => a.sort - b.sort);
}

export function getTask(id: string): Task | undefined {
  const row = find<Stored<Task>>('tasks', id);
  return row && toTask(row, tagSorter());
}

export function insertTask(task: Task, sample = false): void {
  save('tasks', {
    id: task.id, title: task.title, notes: task.notes, stage_id: task.stage_id, sort: task.sort, priority: task.priority,
    due_at: task.due_at ?? null, due_has_time: task.due_has_time ? 1 : 0, remind_at: task.remind_at ?? null,
    checklist: checklistOf(task.checklist), completed_at: task.completed_at ?? null, focus_minutes: task.focus_minutes,
    created_at: task.created_at, updated_at: task.updated_at, tagIds: [...new Set(task.tagIds)], ...marked(sample),
  });
}

export function createTask(data: Partial<Task> & { title: string }, sample = false): Task {
  const stages = listStages();
  const stage = stages.find((s) => s.id === data.stage_id) ?? stages.find((s) => !s.is_done) ?? stages[0];
  if (!stage) throw new Error('Add a stage before creating tasks.');
  const top = maxOf(rows<Task>('tasks').filter((task) => task.stage_id === stage.id).map((task) => task.sort));
  const t = now();
  const task: Task = {
    id: uid(), title: data.title.trim(), notes: data.notes ?? '', stage_id: stage.id, sort: top + 1,
    priority: (data.priority ?? 0) as Priority, due_at: data.due_at ?? null, due_has_time: data.due_has_time ?? 0,
    remind_at: data.remind_at ?? null, checklist: data.checklist ?? [],
    completed_at: stage.is_done ? (data.completed_at ?? t) : null, focus_minutes: 0,
    created_at: data.created_at ?? t, updated_at: t, tagIds: data.tagIds ?? [],
  };
  insertTask(task, sample);
  return task;
}

export function updateTask(
  id: string,
  fields: Partial<Pick<Task, 'title' | 'notes' | 'priority' | 'due_at' | 'due_has_time' | 'remind_at' | 'focus_minutes'>> & {
    checklist?: ChecklistItem[];
  },
): void {
  const { checklist, ...rest } = fields;
  patch<Task>('tasks', id, { ...rest, checklist: checklist ? checklistOf(checklist) : undefined }, [
    'title', 'notes', 'priority', 'due_at', 'due_has_time', 'remind_at', 'focus_minutes', 'checklist',
  ], true);
}

/** Put a task at a position in a column and renumber that column. */
export function moveTask(id: string, stageId: string, index: number): void {
  const stage = find<Stage>('stages', stageId);
  if (!stage) return;
  const order = rows<Stored<Task>>('tasks')
    .filter((task) => task.stage_id === stageId && task.id !== id)
    .sort((a, b) => a.sort - b.sort)
    .map((task) => task.id);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  const t = now();
  order.forEach((taskId, position) => {
    const task = find<Stored<Task>>('tasks', taskId);
    if (!task) return;
    if (taskId === id) {
      save('tasks', {
        ...task, sort: position + 1, stage_id: stageId, completed_at: stage.is_done ? (task.completed_at ?? t) : null, updated_at: t,
      });
    } else if (task.sort !== position + 1) {
      save('tasks', { ...task, sort: position + 1 });
    }
  });
}

/** Tick or untick a task. Completed tasks move to the first "done" column when there is one. */
export function setTaskDone(id: string, done: boolean): void {
  const task = find<Stored<Task>>('tasks', id);
  if (!task) return;
  const stages = listStages();
  const current = stages.find((s) => s.id === task.stage_id);
  const target = done
    ? (current?.is_done ? current : stages.find((s) => s.is_done))
    : (current && !current.is_done ? current : stages.find((s) => !s.is_done));
  if (target && target.id !== task.stage_id) {
    moveTask(id, target.id, done ? 0 : Number.MAX_SAFE_INTEGER);
  } else {
    const t = now();
    save('tasks', { ...task, completed_at: done ? t : null, updated_at: t });
  }
}

export function deleteTask(id: string): void {
  remove('tasks', id);
}

// ── Notes ──────────────────────────────────────────────────────────────────────────────────────

const blocksOf = (blocks: Block[] | undefined): Block[] =>
  (blocks ?? []).map((block) => ({
    id: block.id, type: block.type, html: block.html, ...(typeof block.checked === 'boolean' ? { checked: block.checked } : {}),
  }));

const toNote = (row: Stored<Note>, sortTags: (ids: string[]) => string[], withContent: boolean): Note => ({
  id: row.id, title: row.title, content: withContent ? blocksOf(row.content) : [], plain: row.plain, pinned: row.pinned,
  created_at: row.created_at, updated_at: row.updated_at, tagIds: sortTags(row.tagIds),
});

/** Notes without their block content (the list only needs the preview text). */
export function listNotes(): Note[] {
  const sortTags = tagSorter();
  return rows<Stored<Note>>('notes').map((row) => toNote(row, sortTags, false)).sort((a, b) => b.updated_at - a.updated_at);
}

export function getNote(id: string): Note | undefined {
  const row = find<Stored<Note>>('notes', id);
  return row && toNote(row, tagSorter(), true);
}

export function insertNote(note: Note, sample = false): void {
  save('notes', {
    id: note.id, title: note.title, content: blocksOf(note.content), plain: note.plain, pinned: note.pinned ? 1 : 0,
    created_at: note.created_at, updated_at: note.updated_at, tagIds: [...new Set(note.tagIds)], ...marked(sample),
  });
}

export function createNote(data: Partial<Note> = {}, sample = false): Note {
  const t = now();
  const note: Note = {
    id: uid(), title: data.title ?? '', content: data.content ?? [{ id: uid(8), type: 'p', html: '' }],
    plain: data.plain ?? '', pinned: data.pinned ?? 0, created_at: data.created_at ?? t,
    updated_at: data.updated_at ?? t, tagIds: data.tagIds ?? [],
  };
  insertNote(note, sample);
  return note;
}

export function updateNote(id: string, fields: { title?: string; content?: Block[]; plain?: string; pinned?: number }): void {
  const { content, ...rest } = fields;
  // Pinning is not an edit, so it does not change the "last edited" time.
  const stamp = fields.title !== undefined || content !== undefined;
  patch<Note>('notes', id, { ...rest, content: content ? blocksOf(content) : undefined }, ['title', 'content', 'plain', 'pinned'], stamp);
}

export function deleteNote(id: string): void {
  remove('notes', id);
}

// ── Calendar events ────────────────────────────────────────────────────────────────────────────

const toEvent = (row: Stored<CalEvent>, sortTags: (ids: string[]) => string[]): CalEvent => ({
  id: row.id, title: row.title, kind: row.kind, start_at: row.start_at, end_at: row.end_at, all_day: row.all_day,
  location: row.location, meeting_url: row.meeting_url, attendees: row.attendees, notes: row.notes, color: row.color,
  remind_min: row.remind_min, repeat: row.repeat, repeat_until: row.repeat_until, exdates: [...row.exdates],
  created_at: row.created_at, updated_at: row.updated_at, tagIds: sortTags(row.tagIds),
});

export function listEvents(): CalEvent[] {
  const sortTags = tagSorter();
  return rows<Stored<CalEvent>>('events').map((row) => toEvent(row, sortTags)).sort((a, b) => a.start_at - b.start_at);
}

export function getEvent(id: string): CalEvent | undefined {
  const row = find<Stored<CalEvent>>('events', id);
  return row && toEvent(row, tagSorter());
}

export function insertEvent(event: CalEvent, sample = false): void {
  save('events', {
    id: event.id, title: event.title, kind: event.kind, start_at: event.start_at, end_at: event.end_at, all_day: event.all_day ? 1 : 0,
    location: event.location, meeting_url: event.meeting_url, attendees: event.attendees, notes: event.notes, color: event.color,
    remind_min: event.remind_min ?? null, repeat: event.repeat, repeat_until: event.repeat_until ?? null, exdates: [...(event.exdates ?? [])],
    created_at: event.created_at, updated_at: event.updated_at, tagIds: [...new Set(event.tagIds)], ...marked(sample),
  });
}

export function createEvent(data: Partial<CalEvent> & { title: string; start_at: number; end_at: number }, sample = false): CalEvent {
  const t = now();
  const event: CalEvent = {
    id: uid(), title: data.title.trim(), kind: data.kind ?? 'event', start_at: data.start_at, end_at: data.end_at,
    all_day: data.all_day ?? 0, location: data.location ?? '', meeting_url: data.meeting_url ?? '',
    attendees: data.attendees ?? '', notes: data.notes ?? '', color: data.color ?? '',
    remind_min: data.remind_min === undefined ? null : data.remind_min, repeat: data.repeat ?? 'none',
    repeat_until: data.repeat_until ?? null, exdates: [], created_at: t, updated_at: t, tagIds: data.tagIds ?? [],
  };
  insertEvent(event, sample);
  return event;
}

export function updateEvent(id: string, fields: Partial<Omit<CalEvent, 'id' | 'tagIds' | 'exdates'>> & { exdates?: number[] }): void {
  const { exdates, ...rest } = fields;
  patch<CalEvent>('events', id, { ...rest, exdates: exdates ? [...exdates] : undefined }, [
    'title', 'kind', 'start_at', 'end_at', 'all_day', 'location', 'meeting_url', 'attendees', 'notes', 'color', 'remind_min', 'repeat',
    'repeat_until', 'exdates', 'created_at',
  ], true);
}

export function deleteEvent(id: string): void {
  remove('events', id);
}

// ── Reminder log ───────────────────────────────────────────────────────────────────────────────

const reminders = (): ReminderEntry[] => rows<ReminderEntry>('reminders');

/** Keys of reminders that have already gone off. */
export function reminderKeys(): Set<string> {
  return new Set(reminders().filter((entry) => entry.fired_at > 0).map((entry) => entry.key));
}

export function pruneReminders(before: number): void {
  for (const entry of reminders()) {
    if (entry.fired_at > 0 && entry.fired_at < before) remove('reminders', entry.key);
  }
}

export function logReminder(entry: Omit<ReminderEntry, 'seen'> & { seen?: number }): void {
  save('reminders', {
    key: entry.key, title: entry.title, body: entry.body ?? '', item_type: entry.item_type, item_id: entry.item_id,
    fire_at: entry.fire_at, fired_at: entry.fired_at, seen: entry.seen ? 1 : 0,
  });
}

/** Snoozed reminders waiting for their new time. */
export function pendingSnoozes(until: number): ReminderEntry[] {
  return reminders().filter((entry) => entry.fired_at === 0 && entry.fire_at <= until).map((entry) => ({ ...entry }));
}

export function recentReminders(limit = 40): ReminderEntry[] {
  return reminders()
    .filter((entry) => entry.fired_at > 0)
    .sort((a, b) => b.fired_at - a.fired_at)
    .slice(0, limit)
    .map((entry) => ({ ...entry }));
}

export const unseenReminderCount = (): number => reminders().filter((entry) => entry.fired_at > 0 && entry.seen === 0).length;

export function markRemindersSeen(): void {
  for (const entry of reminders()) {
    if (entry.seen === 0) save('reminders', { ...entry, seen: 1 });
  }
}

export function clearReminders(): void {
  for (const entry of reminders()) {
    if (entry.fired_at > 0) remove('reminders', entry.key);
  }
}

// ── Focus sessions ─────────────────────────────────────────────────────────────────────────────

export function addFocusSession(taskId: string | null, minutes: number): void {
  if (minutes < 1) return;
  save('focus', { id: uid(), task_id: taskId, minutes, ended_at: now() });
  const task = taskId ? find<Stored<Task>>('tasks', taskId) : undefined;
  if (task) save('tasks', { ...task, focus_minutes: task.focus_minutes + minutes });
}

export function focusSince(since: number): FocusSession[] {
  return rows<FocusSession>('focus')
    .filter((entry) => entry.ended_at >= since)
    .sort((a, b) => a.ended_at - b.ended_at)
    .map((entry) => ({ ...entry }));
}

// ── Search across everything ───────────────────────────────────────────────────────────────────

export interface SearchHit {
  type: ItemType | 'tag';
  id: string;
  title: string;
  detail: string;
}

export function search(query: string, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const has = (...texts: string[]): boolean => texts.some((text) => text.toLowerCase().includes(q));
  const open = (task: Task): number => (task.completed_at === null ? 0 : 1);
  return [
    ...rows<Task>('tasks')
      .filter((task) => has(task.title, task.notes))
      .sort((a, b) => open(a) - open(b) || b.updated_at - a.updated_at)
      .slice(0, limit)
      .map((task): SearchHit => ({ type: 'task', id: task.id, title: task.title, detail: task.notes })),
    ...rows<Note>('notes')
      .filter((note) => has(note.title, note.plain))
      .sort((a, b) => b.updated_at - a.updated_at)
      .slice(0, limit)
      .map((note): SearchHit => ({ type: 'note', id: note.id, title: note.title, detail: note.plain })),
    ...rows<LinkItem>('links')
      .filter((link) => has(link.title, link.url, link.description, link.note))
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, limit)
      .map((link): SearchHit => ({ type: 'link', id: link.id, title: link.title || link.url, detail: link.url })),
    ...rows<CalEvent>('events')
      .filter((event) => has(event.title, event.location, event.notes))
      .sort((a, b) => b.start_at - a.start_at)
      .slice(0, limit)
      .map((event): SearchHit => ({ type: 'event', id: event.id, title: event.title, detail: event.location })),
    ...rows<Tag>('tags')
      .filter((tag) => has(tag.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, limit)
      .map((tag): SearchHit => ({ type: 'tag', id: tag.id, title: tag.name, detail: '' })),
  ];
}

// ── Housekeeping ───────────────────────────────────────────────────────────────────────────────

const SAMPLED: CollectionName[] = ['tags', 'links', 'tasks', 'notes', 'events'];

export function sampleCount(): number {
  return SAMPLED.reduce((sum, name) => sum + rows<Stored<object>>(name).filter((doc) => doc.sample).length, 0);
}

export function removeSamples(): void {
  for (const type of ITEM_TYPES) {
    for (const item of rows<Stored<{ id: string }>>(COLLECTION[type])) {
      if (item.sample) remove(COLLECTION[type], item.id);
    }
  }
  // Sample tags are only removed when nothing of yours uses them.
  const used = new Set(ITEM_TYPES.flatMap((type) => rows<{ tagIds: string[] }>(COLLECTION[type]).flatMap((item) => item.tagIds)));
  for (const tag of rows<Stored<Tag>>('tags')) {
    if (tag.sample && !used.has(tag.id)) remove('tags', tag.id);
  }
}

export function counts(): { links: number; tasks: number; notes: number; events: number; tags: number } {
  const n = (name: CollectionName): number => rows(name).length;
  return { links: n('links'), tasks: n('tasks'), notes: n('notes'), events: n('events'), tags: n('tags') };
}
