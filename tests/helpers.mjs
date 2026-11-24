// Helpers for exercising the API in-process: no HTTP server, the handler is called directly.
import { handle } from '../server/app.js';
import { useDatabase } from '../server/db.js';
import { createMemoryDb } from '../server/memory-db.js';

/** Start every test file from an empty stand-in database. */
export function freshDatabase() {
  const db = createMemoryDb();
  useDatabase(db);
  return db;
}

/**
 * Call the API. `jar` is a plain object that keeps the session cookie between calls, like a browser would.
 * @returns {Promise<{ status: number, body: any, cookie: string }>}
 */
export async function call(method, path, body, jar = {}, headers = {}) {
  const request = new Request(`http://trackmate.test${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(jar.cookie ? { cookie: jar.cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const response = await handle(request);
  const setCookie = response.headers.get('set-cookie') || '';
  if (setCookie) jar.cookie = setCookie.split(';')[0];
  return { status: response.status, body: await response.json(), cookie: setCookie };
}

let counter = 0;
export async function newAccount(name = 'Test Person') {
  const jar = {};
  const email = `person${++counter}-${Date.now()}@example.com`;
  const password = 'correct horse battery';
  const answer = await call('POST', '/api/signup', { name, email, password }, jar);
  if (answer.status !== 201) throw new Error(`sign-up failed: ${JSON.stringify(answer.body)}`);
  return { jar, email, password, user: answer.body.user };
}

const t = 1_700_000_000_000;
/** One valid document of every kind. */
export const SAMPLE = {
  tags: { id: 'tag1', name: 'Work', color: '#007AFF', icon: 'briefcase', sort: 1, created_at: t },
  links: {
    id: 'link1', url: 'https://example.com/a', title: 'Example', description: 'A page', note: 'my note', image: '', favicon: '',
    site_name: 'example.com', pinned: 1, is_read: 0, opens: 3, created_at: t, updated_at: t, tagIds: ['tag1'],
  },
  stages: { id: 'stage1', name: 'To do', color: '#8E8E93', sort: 1, is_done: 0, wip_limit: 0 },
  tasks: {
    id: 'task1', title: 'Write tests', notes: '', stage_id: 'stage1', sort: 1, priority: 2, due_at: t + 86_400_000, due_has_time: 1,
    remind_at: null, checklist: [{ id: 'c1', text: 'first', done: true }], completed_at: null, focus_minutes: 25,
    created_at: t, updated_at: t, tagIds: ['tag1'], sample: true,
  },
  notes: {
    id: 'note1', title: 'Hello', content: [{ id: 'b1', type: 'h1', html: 'Hello' }, { id: 'b2', type: 'todo', html: 'x <b>y</b>', checked: true }],
    plain: 'Hello\nx y', pinned: 0, created_at: t, updated_at: t, tagIds: [],
  },
  events: {
    id: 'event1', title: 'Stand-up', kind: 'meeting', start_at: t, end_at: t + 900_000, all_day: 0, location: '', meeting_url: 'https://meet.example/x',
    attendees: 'Priya', notes: '', color: '', remind_min: 10, repeat: 'weekdays', repeat_until: null, exdates: [t + 86_400_000],
    created_at: t, updated_at: t, tagIds: ['tag1'],
  },
  reminders: { key: 'task:task1:1700000000000', title: 'Write tests', body: '', item_type: 'task', item_id: 'task1', fire_at: t, fired_at: t, seen: 0 },
  focus: { id: 'focus1', task_id: 'task1', minutes: 25, ended_at: t },
};

export const SETTINGS = {
  theme: 'dark', tint: 'green', glass: 40, aurora: false, time24: true, weekStart: 1, taskView: 'board', linkView: 'list',
  calView: 'month', notify: false, chime: true, linkProvider: 'auto', defaultAlert: null,
};

export const putAll = () => Object.entries(SAMPLE).map(([c, d]) => ({ t: 'put', c, d }));
