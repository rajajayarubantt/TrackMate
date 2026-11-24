// Starter content: default board stages for every account, plus optional sample content.
import { addDays, atMinutes, startOfDay, startOfWeek, MIN } from '../lib/dates';
import { uid } from '../lib/id';
import { createEvent, createLink, createNote, createStage, createTag, createTask, listStages } from './repo';
import type { Block, BlockType } from './types';

/**
 * The board's starting stages. Their ids are fixed, so if two devices both set up the same new
 * account (one of them offline, say) they store the same four stages instead of eight.
 */
export function seedDefaults(): void {
  if (listStages().length) return;
  createStage('To do', '#8E8E93', false, 'stage-todo');
  createStage('In progress', '#007AFF', false, 'stage-doing');
  createStage('In review', '#AF52DE', false, 'stage-review');
  createStage('Done', '#34C759', true, 'stage-done');
}

const block = (type: BlockType, html = '', checked?: boolean): Block => ({ id: uid(8), type, html, checked });
const plainOf = (blocks: Block[]): string => blocks.map((b) => b.html.replace(/<[^>]+>/g, '')).filter(Boolean).join('\n');

export function seedSamples(): void {
  const now = Date.now();
  const today = startOfDay(now);
  const [todo, doing, review, done] = listStages();

  const work = createTag({ name: 'Work', color: '#007AFF', icon: 'briefcase' }, true);
  const personal = createTag({ name: 'Personal', color: '#34C759', icon: 'home' }, true);
  const ideas = createTag({ name: 'Ideas', color: '#FFCC00', icon: 'bulb' }, true);
  const reading = createTag({ name: 'Reading', color: '#AF52DE', icon: 'book' }, true);
  const urgent = createTag({ name: 'Urgent', color: '#FF3B30', icon: 'flame' }, true);
  const learning = createTag({ name: 'Learning', color: '#FF9500', icon: 'school' }, true);

  // Links
  const link = (url: string, title: string, site: string, description: string, tagIds: string[], extra: object = {}, age = 0) =>
    createLink({ url, title, site_name: site, description, tagIds, created_at: now - age * 3_600_000, ...extra }, true);
  link('https://developer.apple.com/design/human-interface-guidelines', 'Human Interface Guidelines', 'Apple Developer',
    'Guidance and best practices for designing great experiences on Apple platforms.', [reading.id, work.id],
    { note: 'Re-read the sections on materials and tab bars.', pinned: 1 }, 2);
  link('https://www.mongodb.com/docs/atlas/getting-started/', 'Get Started with Atlas', 'MongoDB Docs',
    'Create a cluster, connect to it and load your first data in a few minutes.', [learning.id], {}, 9);
  link('https://react.dev/learn', 'Quick Start – React', 'React',
    'The React concepts you will use every day: components, state, effects and rendering lists.', [learning.id, work.id], { is_read: 1 }, 26);
  link('https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter', 'backdrop-filter – CSS', 'MDN Web Docs',
    'Apply blur or colour shifting to the area behind an element.', [work.id], {}, 50);
  link('https://en.wikipedia.org/wiki/Kanban', 'Kanban', 'Wikipedia',
    'A scheduling system for lean and just-in-time manufacturing, later adopted for software work.', [reading.id], { is_read: 1 }, 75);
  link('https://www.typescriptlang.org/docs/handbook/intro.html', 'The TypeScript Handbook', 'TypeScript',
    'A guide to the everyday features of the TypeScript language.', [learning.id], {}, 120);

  // Tasks
  const item = (text: string, isDone = false) => ({ id: uid(8), text, done: isDone });
  createTask({
    title: 'Prepare slides for Thursday’s review', stage_id: doing.id, priority: 3, tagIds: [work.id],
    due_at: atMinutes(addDays(today, 1), 17 * 60), due_has_time: 1, remind_at: atMinutes(addDays(today, 1), 16 * 60),
    notes: 'Keep it to ten slides. Lead with the numbers.',
    checklist: [item('Collect last quarter’s numbers', true), item('Draft the outline'), item('Rehearse once')],
  }, true);
  createTask({ title: 'Reply to Priya about the offsite venue', stage_id: todo.id, priority: 2, tagIds: [work.id], due_at: today }, true);
  createTask({ title: 'Renew car insurance', stage_id: todo.id, priority: 3, tagIds: [personal.id, urgent.id], due_at: addDays(today, -1) }, true);
  createTask({ title: 'Book a dentist appointment', stage_id: todo.id, priority: 1, tagIds: [personal.id], due_at: addDays(today, 3) }, true);
  createTask({ title: 'Read chapter 5 of Designing Data-Intensive Applications', stage_id: todo.id, tagIds: [reading.id, learning.id] }, true);
  createTask({ title: 'Plan the weekend hike', stage_id: todo.id, tagIds: [personal.id], due_at: addDays(startOfWeek(today, 1), 5) }, true);
  createTask({ title: 'Sketch ideas for the garden', stage_id: doing.id, priority: 1, tagIds: [ideas.id, personal.id] }, true);
  createTask({
    title: 'Refactor the import script', stage_id: review.id, priority: 2, tagIds: [work.id],
    checklist: [item('Split parsing from validation', true), item('Add tests for empty rows', true), item('Update the README')],
  }, true);
  createTask({ title: 'Set up TrackMate', stage_id: done.id, completed_at: now - 20 * MIN }, true);
  createTask({ title: 'Pay the electricity bill', stage_id: done.id, tagIds: [personal.id], completed_at: now - 26 * 3_600_000 }, true);

  // Notes
  const welcome: Block[] = [
    block('p', 'Everything you add is saved to your account, so it is there on every device you sign in on. TrackMate also keeps working offline and syncs when you reconnect.'),
    block('h2', 'Try these'),
    block('todo', 'Create your account', true),
    block('todo', 'Paste a link in <b>Links</b> to save it with its preview'),
    block('todo', 'Drag a card across the <b>Tasks</b> board'),
    block('todo', 'Type <b>/</b> on an empty line here for headings, lists and to-dos'),
    block('h2', 'Quick capture'),
    block('p', 'Press the search button, or ⌘K on a keyboard, and type things the way you would say them:'),
    block('bullet', '<b>Call the bank tomorrow 3pm #personal !high</b> makes a task with a due date, a tag and a priority'),
    block('bullet', '<b>meeting Design review fri 10am for 45m</b> makes a calendar meeting'),
    block('bullet', '<b>note Ideas for the offsite</b> starts a new note'),
    block('callout', 'Back up now and then: Settings → Data → Download a backup.'),
  ];
  createNote({ title: 'Welcome to TrackMate', content: welcome, plain: plainOf(welcome), pinned: 1, tagIds: [ideas.id] }, true);

  const offsite: Block[] = [
    block('h2', 'Venue shortlist'),
    block('bullet', 'Lakeside lodge: quiet, 90 minutes away, sleeps 14'),
    block('bullet', 'City loft: easy to reach, no outdoor space'),
    block('h2', 'Open questions'),
    block('todo', 'Confirm the dates with Priya'),
    block('todo', 'Ask about dietary needs'),
    block('quote', 'Aim for one long working session and one long walk each day.'),
  ];
  createNote({ title: 'Offsite planning', content: offsite, plain: plainOf(offsite), tagIds: [work.id], updated_at: now - 5 * 3_600_000 }, true);

  const books: Block[] = [
    block('p', 'Things worth reading next.'),
    block('number', 'Designing Data-Intensive Applications'),
    block('number', 'The Design of Everyday Things'),
    block('number', 'A Philosophy of Software Design'),
    block('code', 'SELECT title FROM books WHERE finished = 0 ORDER BY added DESC;'),
  ];
  createNote({ title: 'Reading list', content: books, plain: plainOf(books), tagIds: [reading.id], updated_at: now - 30 * 3_600_000 }, true);

  // Calendar
  const at = (dayOffset: number, minutes: number) => atMinutes(addDays(today, dayOffset), minutes);
  const soon = Math.ceil((now + 40 * MIN) / (30 * MIN)) * 30 * MIN;
  createEvent({
    title: 'Project sync', kind: 'meeting', start_at: soon, end_at: soon + 30 * MIN, remind_min: 10,
    meeting_url: 'https://example.com/meet/project-sync', attendees: 'Priya, Marcus', tagIds: [work.id],
  }, true);
  createEvent({
    title: 'Daily stand-up', kind: 'meeting', start_at: at(-7, 9 * 60 + 30), end_at: at(-7, 9 * 60 + 45), repeat: 'weekdays',
    meeting_url: 'https://example.com/meet/stand-up', remind_min: 5, tagIds: [work.id],
  }, true);
  createEvent({ title: 'Lunch with Sam', kind: 'event', start_at: at(0, 12 * 60 + 30), end_at: at(0, 13 * 60 + 30), location: 'Cafe Luna', tagIds: [personal.id] }, true);
  createEvent({
    title: 'Design review', kind: 'meeting', start_at: at(1, 14 * 60), end_at: at(1, 15 * 60), remind_min: 10,
    attendees: 'Priya, Marcus, Elena', location: 'Room 4B', tagIds: [work.id],
  }, true);
  createEvent({ title: 'Gym', kind: 'event', start_at: at(-6, 18 * 60 + 30), end_at: at(-6, 19 * 60 + 30), repeat: 'weekly', tagIds: [personal.id] }, true);
  createEvent({ title: 'Submit expense report', kind: 'reminder', start_at: at(2, 10 * 60), end_at: at(2, 10 * 60 + 15), remind_min: 0, tagIds: [work.id] }, true);
  createEvent({ title: 'Team offsite', kind: 'event', all_day: 1, start_at: addDays(today, 8), end_at: addDays(today, 10), location: 'Lakeside lodge', tagIds: [work.id] }, true);
}
