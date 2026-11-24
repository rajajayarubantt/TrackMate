#!/usr/bin/env node
// Checks that TrackMate works against YOUR database, using the same code that runs on Vercel.
//
//   npm run check:db              uses MONGODB_URI (and MONGODB_DB) from .env.local
//   npm run check:db -- --stand-in   runs the same steps against the built-in stand-in instead
//
// It creates two throw-away accounts, saves and reads one of everything, changes a password,
// then deletes both accounts again. Nothing else in the database is touched.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadEnv } from './env.mjs';

loadEnv();
const standIn = process.argv.includes('--stand-in');
if (standIn) {
  delete process.env.MONGODB_URI;
  process.env.TRACKMATE_DEV_DB = 'off';
} else if (!(process.env.MONGODB_URI || '').trim()) {
  console.error('\n  MONGODB_URI is not set.\n  Copy .env.example to .env.local, paste your MongoDB Atlas connection string into it, and run this again.\n');
  process.exit(1);
}
process.env.SESSION_SECRET ||= randomBytes(32).toString('hex');

const { handle } = await import('../server/app.js');
const { closeDatabase, database, databaseName, COLLECTIONS } = await import('../server/db.js');
const { describeDatabaseError, isDatabaseError } = await import('../server/errors.js');

async function call(method, path, body, jar = {}) {
  const response = await handle(
    new Request(`http://localhost/api/${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(jar.cookie ? { cookie: jar.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const cookie = response.headers.get('set-cookie');
  if (cookie) jar.cookie = cookie.split(';')[0];
  return { status: response.status, body: await response.json() };
}

const run = randomBytes(4).toString('hex');
const t = Date.now();
const docs = {
  tags: { id: 'tag1', name: 'Check', color: '#007AFF', icon: 'briefcase', sort: 1, created_at: t },
  links: { id: 'link1', url: 'https://example.com/', title: 'Example', description: '', note: '', image: '', favicon: '', site_name: '', pinned: 0, is_read: 0, opens: 0, created_at: t, updated_at: t, tagIds: ['tag1'] },
  stages: { id: 'stage1', name: 'To do', color: '#8E8E93', sort: 1, is_done: 0, wip_limit: 0 },
  tasks: { id: 'task1', title: 'Check the database', notes: '', stage_id: 'stage1', sort: 1, priority: 1, due_at: null, due_has_time: 0, remind_at: null, checklist: [{ id: 'c1', text: 'one', done: false }], completed_at: null, focus_minutes: 0, created_at: t, updated_at: t, tagIds: [] },
  notes: { id: 'note1', title: 'Note', content: [{ id: 'b1', type: 'p', html: 'Unicode survives: café, 日本語, 🚀' }], plain: 'Unicode survives: café, 日本語, 🚀', pinned: 0, created_at: t, updated_at: t, tagIds: [] },
  events: { id: 'event1', title: 'Event', kind: 'event', start_at: t, end_at: t + 3_600_000, all_day: 0, location: '', meeting_url: '', attendees: '', notes: '', color: '', remind_min: null, repeat: 'none', repeat_until: null, exdates: [], created_at: t, updated_at: t, tagIds: [] },
  reminders: { key: `task:task1:${t}`, title: 'Check', body: '', item_type: 'task', item_id: 'task1', fire_at: t, fired_at: t, seen: 0 },
  focus: { id: 'focus1', task_id: null, minutes: 25, ended_at: t },
};

/** Stop with the server's own explanation when a step does not get the answer it should. */
function expect(answer, status) {
  if (answer.status !== status) throw new Error(answer.body.error || `Expected status ${status} but got ${answer.status}.`);
}

const accounts = [];
let step = 'connect to the database';
const done = (text) => console.log(`  ✓ ${text}`);

try {
  console.log('');
  const health = await call('GET', 'health');
  expect(health, 200);
  done(`Connected: ${health.body.database}`);

  step = 'create an account';
  for (const who of ['a', 'b']) {
    const jar = {};
    const account = { jar, email: `check-${run}-${who}@trackmate.invalid`, password: `check-${randomBytes(9).toString('hex')}` };
    const made = await call('POST', 'signup', { name: `Check ${who}`, email: account.email, password: account.password }, jar);
    expect(made, 201);
    account.id = made.body.user.id;
    accounts.push(account);
  }
  const [a, b] = accounts;
  done('Created two throw-away accounts');

  step = 'save one of everything';
  const saved = await call('POST', 'sync', { ops: [...Object.entries(docs).map(([c, d]) => ({ t: 'put', c, d })), { t: 'me', name: 'Renamed' }] }, a.jar);
  expect(saved, 200);
  assert.equal(saved.body.rev, 1);
  assert.equal(saved.body.user.name, 'Renamed');
  done('Saved a tag, link, stage, task, note, event, reminder and focus session');

  step = 'read everything back';
  const read = await call('GET', 'data', undefined, a.jar);
  expect(read, 200);
  for (const [name, doc] of Object.entries(docs)) assert.deepEqual(read.body.data[name], [doc], `${name} did not come back as saved`);
  assert.equal((await call('GET', 'data?rev=1', undefined, a.jar)).body.unchanged, true);
  done('Read it all back exactly as saved');

  step = 'replace and delete documents';
  const changed = await call('POST', 'sync', { ops: [{ t: 'put', c: 'tasks', d: { ...docs.tasks, title: 'Changed' } }, { t: 'del', c: 'links', id: 'link1' }] }, a.jar);
  assert.equal(changed.body.rev, 2);
  const after = (await call('GET', 'data', undefined, a.jar)).body.data;
  assert.equal(after.tasks.length, 1);
  assert.equal(after.tasks[0].title, 'Changed');
  assert.equal(after.links.length, 0);
  done('Replaced one document and deleted another');

  step = 'keep accounts apart';
  await call('POST', 'sync', { ops: [{ t: 'put', c: 'tasks', d: { ...docs.tasks, title: 'Belongs to B' } }] }, b.jar);
  assert.equal((await call('GET', 'data', undefined, a.jar)).body.data.tasks[0].title, 'Changed');
  const forB = (await call('GET', 'data', undefined, b.jar)).body.data;
  assert.equal(forB.tasks[0].title, 'Belongs to B');
  assert.equal(forB.notes.length, 0);
  done('Each account sees only its own data');

  step = 'refuse a second account with the same email';
  assert.equal((await call('POST', 'signup', { name: 'Twin', email: a.email.toUpperCase(), password: 'long enough' })).status, 409);
  done('The unique index on email works');

  step = 'sign in and change the password';
  assert.equal((await call('POST', 'signin', { email: a.email, password: 'wrong password' })).status, 401);
  const second = {};
  assert.equal((await call('POST', 'signin', { email: a.email, password: a.password }, second)).status, 200);
  const next = `check-${randomBytes(9).toString('hex')}`;
  assert.equal((await call('POST', 'password', { current: a.password, next }, a.jar)).status, 200);
  a.password = next;
  assert.equal((await call('GET', 'data', undefined, second)).status, 401);
  assert.equal((await call('GET', 'data', undefined, a.jar)).status, 200);
  done('Sign-in, wrong-password and change-password behave');

  step = 'delete the accounts';
  for (const account of accounts.splice(0)) {
    const gone = await call('POST', 'delete-account', { password: account.password }, account.jar);
    expect(gone, 200);
    const { db } = await database();
    for (const name of COLLECTIONS) assert.equal(await db.collection(name).countDocuments({ userId: account.id }), 0, `${name} left behind`);
    assert.equal(await db.collection('users').countDocuments({ _id: account.id }), 0);
  }
  done('Deleted both accounts and everything they stored');

  console.log(`\n  All checks passed${standIn ? ' against the stand-in' : ` against MongoDB, database "${databaseName()}"`}.\n`);
} catch (error) {
  console.error(`\n  ✗ Could not ${step}.`);
  console.error(`    ${(isDatabaseError(error) && describeDatabaseError(error)) || error.message}\n`);
  // Leave nothing behind, whatever happened.
  try {
    const { db } = await database();
    for (const account of accounts) {
      if (!account.id) continue;
      for (const name of COLLECTIONS) await db.collection(name).deleteMany({ userId: account.id });
      await db.collection('users').deleteOne({ _id: account.id });
    }
  } catch {
    /* the database was never reachable */
  }
  process.exitCode = 1;
} finally {
  await closeDatabase().catch(() => undefined);
}
