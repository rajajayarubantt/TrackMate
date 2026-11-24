// The app's own data layer (src/db) running against the real API handler and the stand-in database:
// everything the screens can do to your data, then a check that the server ends up with exactly
// what the device shows. Also two devices on one account, offline work, and refused changes.
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { device } from './device.mjs';
import { freshDatabase } from './helpers.mjs';

beforeEach(() => freshDatabase());

let accounts = 0;
/** Create an account and start a device signed in to it. */
async function signedUp(password = 'correct horse battery') {
  const d = await device();
  const email = `client${++accounts}@example.com`;
  const made = await d.api('POST', 'signup', { name: 'Client', email, password });
  assert.equal(made.status, 201);
  d.store.start(made.body.user, undefined, 0);
  return Object.assign(d, { email, password, user: made.body.user });
}

/** Sign another device in to an existing account, the way the app does after the sign-in form. */
async function signedIn(account, existing) {
  const d = existing ?? (await device());
  const answer = await d.api('POST', 'signin', { email: account.email, password: account.password });
  assert.equal(answer.status, 200);
  d.store.start(answer.body.user, await d.store.loadCache());
  await d.store.refresh({ force: true, strict: true });
  return Object.assign(d, { email: account.email, password: account.password, user: answer.body.user });
}

async function same(d, message) {
  await d.store.flush();
  const { server, local } = await d.compare();
  assert.deepEqual(server, local, message);
  assert.deepEqual(d.notices, [], 'the server refused nothing');
  return server;
}

describe('everything the screens do is stored exactly', () => {
  it('a new account with sample content', async () => {
    const d = await signedUp();
    d.seed.seedDefaults();
    d.seed.seedSamples();
    const server = await same(d);
    assert.deepEqual(Object.fromEntries(Object.entries(server).map(([k, v]) => [k, v.length])), { tags: 6, links: 6, stages: 4, tasks: 10, notes: 3, events: 7, reminders: 0, focus: 0 });
    assert.equal(d.sent.length, 1, 'the whole first save is one request');
    assert.equal(d.repo.sampleCount(), 32);
    d.store.stop();
  });

  it('tags: order, renaming, deleting, counts', async () => {
    const d = await signedUp();
    const { repo } = d;
    d.seed.seedDefaults();
    const b = repo.createTag({ name: '  beta ', color: '#111111', icon: 'book' });
    const a = repo.createTag({ name: 'Alpha', color: '#222222', icon: 'home' });
    assert.equal(b.name, 'beta');
    assert.deepEqual(repo.listTags().map((t) => t.name), ['beta', 'Alpha'], 'in the order they were made');
    repo.updateTag(a.id, { sort: 1 });
    assert.deepEqual(repo.listTags().map((t) => t.name), ['Alpha', 'beta'], 'same position: by name, ignoring capitals');
    const link = repo.createLink({ url: 'https://example.com/', tagIds: [b.id, a.id, b.id, 'gone'] });
    const task = repo.createTask({ title: 'Tagged', tagIds: [b.id] });
    assert.deepEqual(repo.listLinks()[0].tagIds, [a.id, b.id], 'tags come back in Tag Manager order, once each, without unknown ones');
    assert.deepEqual(repo.tagCounts(), { [a.id]: { link: 1, task: 0, note: 0, event: 0 }, [b.id]: { link: 1, task: 1, note: 0, event: 0 } });
    repo.setItemTags('task', task.id, [a.id, a.id]);
    assert.deepEqual(repo.getTask(task.id).tagIds, [a.id]);
    repo.deleteTag(a.id);
    assert.deepEqual(repo.listLinks()[0].tagIds, [b.id]);
    assert.deepEqual(repo.getTask(task.id).tagIds, []);
    assert.equal(repo.listLinks()[0].id, link.id);
    const server = await same(d);
    assert.equal(server.links[0].tagIds.includes(a.id), false, 'the deleted tag is gone from the stored link too');
    d.store.stop();
  });

  it('links', async () => {
    const d = await signedUp();
    const { repo } = d;
    const old = repo.createLink({ url: 'https://a.example/', title: 'Older', created_at: 1000 });
    const fresh = repo.createLink({ url: 'https://b.example/' });
    assert.deepEqual(repo.listLinks().map((l) => l.id), [fresh.id, old.id], 'newest first');
    assert.deepEqual({ ...fresh, id: 0, created_at: 0, updated_at: 0 }, {
      id: 0, url: 'https://b.example/', title: '', description: '', note: '', image: '', favicon: '', site_name: '', pinned: 0, is_read: 0, opens: 0, created_at: 0, updated_at: 0, tagIds: [],
    });
    repo.updateLink(old.id, { pinned: true, opens: 4, note: 'mine', title: undefined });
    const got = repo.listLinks().find((l) => l.id === old.id);
    assert.equal(got.pinned, 1, 'yes/no values are stored as 1 and 0');
    assert.equal(got.title, 'Older', 'undefined leaves a field alone');
    assert.ok(got.updated_at > 1000);
    const copy = repo.listLinks()[0];
    repo.deleteLink(copy.id);
    repo.insertLink(copy);
    assert.equal(repo.listLinks().length, 2, 'undo of a delete puts it back');
    await same(d);
    d.store.stop();
  });

  it('stages and tasks on the board', async () => {
    const d = await signedUp();
    const { repo } = d;
    assert.throws(() => repo.createTask({ title: 'No stage yet' }), /Add a stage/);
    d.seed.seedDefaults();
    const [todo, doing, review, done] = repo.listStages();
    assert.deepEqual(repo.listStages().map((s) => [s.name, s.sort, s.is_done]), [['To do', 1, 0], ['In progress', 2, 0], ['In review', 3, 0], ['Done', 4, 1]]);

    const t1 = repo.createTask({ title: ' One ' });
    const t2 = repo.createTask({ title: 'Two', priority: 2, due_at: 5000, checklist: [{ id: 'c', text: 'x', done: false }] });
    const t3 = repo.createTask({ title: 'Three', stage_id: 'does-not-exist' });
    const finished = repo.createTask({ title: 'Already done', stage_id: done.id });
    assert.equal(t1.title, 'One');
    assert.deepEqual([t1, t2, t3].map((t) => [t.stage_id, t.sort]), [[todo.id, 1], [todo.id, 2], [todo.id, 3]], 'new tasks go to the end of the first open column');
    assert.ok(finished.completed_at > 0);
    assert.equal(t1.completed_at, null);

    // Drag "Three" to the top of In progress, then "One" between nothing (index far too large → end).
    repo.moveTask(t3.id, doing.id, 0);
    repo.moveTask(t1.id, doing.id, 99);
    repo.moveTask(t2.id, doing.id, 1);
    const column = (stage) => repo.listTasks().filter((t) => t.stage_id === stage.id).map((t) => t.title);
    assert.deepEqual(column(doing), ['Three', 'Two', 'One']);
    assert.deepEqual(repo.listTasks().filter((t) => t.stage_id === doing.id).map((t) => t.sort), [1, 2, 3], 'the column is renumbered');
    repo.moveTask(t1.id, doing.id, 0);
    assert.deepEqual(column(doing), ['One', 'Three', 'Two'], 'reordering inside a column');

    // Ticking a task moves it to the top of the first done column; unticking sends it back to the end of the first open one.
    repo.setTaskDone(t2.id, true);
    assert.deepEqual(column(done), ['Two', 'Already done']);
    assert.ok(repo.getTask(t2.id).completed_at > 0);
    repo.setTaskDone(t2.id, false);
    assert.deepEqual(column(todo), ['Two']);
    assert.equal(repo.getTask(t2.id).completed_at, null);

    // A column that becomes a "done" column completes what is in it, and the other way round.
    repo.setStageDone(doing.id, true);
    assert.ok(repo.getTask(t1.id).completed_at > 0);
    repo.setStageDone(doing.id, false);
    assert.equal(repo.getTask(t1.id).completed_at, null);

    repo.updateStage(review.id, { name: 'QA', wip_limit: 3 });
    repo.reorderStages([review.id, todo.id, doing.id, done.id]);
    assert.deepEqual(repo.listStages().map((s) => s.name), ['QA', 'To do', 'In progress', 'Done']);
    const extra = repo.createStage(' Later ', '#123456');
    assert.equal(extra.sort, 5);
    assert.equal(extra.name, 'Later');

    // Deleting a column moves its tasks to the end of another, keeping their order.
    repo.deleteStage(doing.id, done.id);
    assert.deepEqual(column(done), ['Already done', 'One', 'Three']);
    assert.ok(repo.getTask(t3.id).completed_at > 0, 'moved into a done column, so completed');
    assert.equal(repo.listStages().length, 4);

    repo.updateTask(t2.id, { title: 'Two!', checklist: [{ id: 'c', text: 'x', done: true, extra: 'ignored' }], remind_at: 9000, due_has_time: true });
    const two = repo.getTask(t2.id);
    assert.deepEqual([two.title, two.checklist, two.remind_at, two.due_has_time], ['Two!', [{ id: 'c', text: 'x', done: true }], 9000, 1]);
    two.checklist.push({ id: 'z', text: 'local only', done: false });
    assert.equal(repo.getTask(t2.id).checklist.length, 1, 'what a query returns is a copy');

    const snapshot = repo.getTask(t3.id);
    repo.deleteTask(t3.id);
    assert.equal(repo.getTask(t3.id), undefined);
    repo.insertTask(snapshot);
    assert.equal(repo.getTask(t3.id).title, 'Three');
    await same(d);
    d.store.stop();
  });

  it('a board with no done column still lets tasks be ticked', async () => {
    const d = await signedUp();
    const stage = d.repo.createStage('Only', '#000000');
    const task = d.repo.createTask({ title: 'Tick me' });
    d.repo.setTaskDone(task.id, true);
    assert.ok(d.repo.getTask(task.id).completed_at > 0);
    assert.equal(d.repo.getTask(task.id).stage_id, stage.id);
    d.repo.setTaskDone(task.id, false);
    assert.equal(d.repo.getTask(task.id).completed_at, null);
    await same(d);
    d.store.stop();
  });

  it('notes', async () => {
    const d = await signedUp();
    const { repo } = d;
    const older = repo.createNote({ title: 'Older', updated_at: 1000 });
    const note = repo.createNote();
    assert.deepEqual(note.content.map((b) => [b.type, b.html]), [['p', '']]);
    assert.deepEqual(repo.listNotes().map((n) => n.id), [note.id, older.id], 'most recently edited first');
    assert.deepEqual(repo.listNotes()[0].content, [], 'the list leaves the content out');

    repo.updateNote(older.id, { pinned: 1 });
    assert.equal(repo.getNote(older.id).updated_at, 1000, 'pinning is not an edit');
    const blocks = [{ id: 'b1', type: 'h1', html: 'Title' }, { id: 'b2', type: 'todo', html: 'Do <b>it</b>', checked: true }, { id: 'b3', type: 'p', html: '', checked: undefined }];
    repo.updateNote(older.id, { content: blocks, plain: 'Title\nDo it' });
    const read = repo.getNote(older.id);
    assert.ok(read.updated_at > 1000);
    assert.deepEqual(read.content, [{ id: 'b1', type: 'h1', html: 'Title' }, { id: 'b2', type: 'todo', html: 'Do <b>it</b>', checked: true }, { id: 'b3', type: 'p', html: '' }]);
    blocks[0].html = 'changed after saving';
    read.content[1].html = 'changed after reading';
    assert.equal(repo.getNote(older.id).content[0].html, 'Title', 'the stored note is not affected by later edits to what was passed in');
    assert.equal(repo.getNote(older.id).content[1].html, 'Do <b>it</b>');
    assert.deepEqual(repo.listNotes().map((n) => n.id), [older.id, note.id]);

    const snapshot = repo.getNote(note.id);
    repo.deleteNote(note.id);
    repo.insertNote(snapshot);
    assert.equal(repo.listNotes().length, 2);
    await same(d);
    d.store.stop();
  });

  it('calendar events', async () => {
    const d = await signedUp();
    const { repo } = d;
    const later = repo.createEvent({ title: ' Later ', start_at: 9000, end_at: 9500, kind: 'meeting', remind_min: 0, repeat: 'weekly' });
    const sooner = repo.createEvent({ title: 'Sooner', start_at: 1000, end_at: 2000 });
    assert.deepEqual(repo.listEvents().map((e) => e.title), ['Sooner', 'Later']);
    assert.deepEqual({ ...sooner, id: 0, created_at: 0, updated_at: 0 }, {
      id: 0, title: 'Sooner', kind: 'event', start_at: 1000, end_at: 2000, all_day: 0, location: '', meeting_url: '', attendees: '', notes: '', color: '',
      remind_min: null, repeat: 'none', repeat_until: null, exdates: [], created_at: 0, updated_at: 0, tagIds: [],
    });
    assert.equal(later.remind_min, 0, '“at start” (0) is kept, not treated as “none”');
    repo.updateEvent(later.id, { exdates: [9000], remind_min: null, all_day: true, location: 'Room 1' });
    const got = repo.getEvent(later.id);
    assert.deepEqual([got.exdates, got.remind_min, got.all_day, got.location], [[9000], null, 1, 'Room 1']);
    const snapshot = repo.getEvent(sooner.id);
    repo.deleteEvent(sooner.id);
    repo.insertEvent(snapshot);
    assert.equal(repo.listEvents().length, 2);
    await same(d);
    d.store.stop();
  });

  it('reminders and focus sessions', async () => {
    const d = await signedUp();
    const { repo } = d;
    d.seed.seedDefaults();
    const task = repo.createTask({ title: 'Focus on me' });
    const now = Date.now();
    repo.logReminder({ key: 'task:a:1', title: 'A', body: '', item_type: 'task', item_id: 'a', fire_at: now - 3000, fired_at: now - 3000 });
    repo.logReminder({ key: 'event:b:2', title: 'B', body: 'soon', item_type: 'event', item_id: 'b', fire_at: now - 1000, fired_at: now - 1000 });
    repo.logReminder({ key: 'snooze:x', title: 'A', body: '', item_type: 'task', item_id: 'a', fire_at: now - 10, fired_at: 0 });
    repo.logReminder({ key: 'snooze:y', title: 'A', body: '', item_type: 'task', item_id: 'a', fire_at: now + 60_000, fired_at: 0 });
    assert.deepEqual([...repo.reminderKeys()].sort(), ['event:b:2', 'task:a:1']);
    assert.deepEqual(repo.pendingSnoozes(now).map((r) => r.key), ['snooze:x']);
    assert.deepEqual(repo.recentReminders().map((r) => r.key), ['event:b:2', 'task:a:1'], 'latest first');
    assert.equal(repo.recentReminders(1).length, 1);
    assert.equal(repo.unseenReminderCount(), 2);
    repo.markRemindersSeen();
    assert.equal(repo.unseenReminderCount(), 0);
    repo.logReminder({ ...repo.pendingSnoozes(now)[0], fired_at: now });
    assert.equal(repo.pendingSnoozes(now).length, 0, 'a snooze that fired is no longer waiting');
    repo.pruneReminders(now - 2000);
    assert.deepEqual([...repo.reminderKeys()].sort(), ['event:b:2', 'snooze:x']);
    await same(d, 'before clearing');
    repo.clearReminders();
    assert.deepEqual(repo.recentReminders(), []);
    assert.equal(repo.pendingSnoozes(now + 120_000).length, 1, 'clearing keeps snoozes that have not fired');

    repo.addFocusSession(task.id, 0.4);
    repo.addFocusSession(task.id, 25);
    repo.addFocusSession(null, 10);
    assert.equal(repo.getTask(task.id).focus_minutes, 25);
    assert.deepEqual(repo.focusSince(0).map((f) => [f.task_id, f.minutes]), [[task.id, 25], [null, 10]]);
    assert.deepEqual(repo.focusSince(Date.now() + 1000), []);
    await same(d);
    d.store.stop();
  });

  it('search, counts and removing sample content', async () => {
    const d = await signedUp();
    const { repo } = d;
    d.seed.seedDefaults();
    d.seed.seedSamples();
    const mine = repo.createTask({ title: 'My own OFFSITE task', tagIds: [repo.listTags()[0].id] });
    const hits = repo.search('  offsite ');
    assert.ok(hits.some((h) => h.type === 'task' && h.id === mine.id), 'search ignores capitals and outer spaces');
    assert.ok(hits.some((h) => h.type === 'note' && h.title === 'Offsite planning'));
    assert.deepEqual(repo.search('work').filter((h) => h.type === 'tag').map((h) => h.title), ['Work']);
    assert.equal(repo.search('react')[0].detail, 'https://react.dev/learn');
    assert.deepEqual(repo.search('   '), []);
    assert.ok(repo.search('e', 2).filter((h) => h.type === 'task').length <= 2);
    const open = repo.search('a').filter((h) => h.type === 'task').map((h) => repo.getTask(h.id).completed_at === null);
    assert.deepEqual(open, [...open].sort((x, y) => Number(y) - Number(x)), 'open tasks before completed ones');

    assert.deepEqual(repo.counts(), { links: 6, tasks: 11, notes: 3, events: 7, tags: 6 });
    repo.removeSamples();
    assert.deepEqual(repo.counts(), { links: 0, tasks: 1, notes: 0, events: 0, tags: 1 }, 'the sample tag in use on my own task stays');
    assert.equal(repo.sampleCount(), 1);
    assert.equal(repo.listStages().length, 4);
    await same(d);
    d.store.stop();
  });

  it('a backup taken on one account restores onto another', async () => {
    const a = await signedUp();
    a.seed.seedDefaults();
    a.seed.seedSamples();
    const file = a.backup.backupFile();
    const fromA = await same(a);

    const b = await signedUp();
    b.seed.seedDefaults();
    b.repo.createTask({ title: 'Will be replaced' });
    await b.store.flush();
    assert.throws(() => b.backup.restoreBackup('{"some":"json"}'), /not a TrackMate backup/);
    assert.throws(() => b.backup.restoreBackup('nonsense'), /not a TrackMate backup/);
    assert.throws(() => b.backup.restoreBackup(JSON.stringify({ format: 'trackmate-backup', data: { tasks: [{ title: 'no id' }] } })), /damaged/);
    assert.equal(b.repo.listTasks().length, 1, 'a bad file changes nothing');
    b.backup.restoreBackup(file);
    assert.deepEqual(await same(b), fromA);
    a.store.stop();
    b.store.stop();
  });
});

describe('saving', () => {
  it('sends one request for a burst of changes, and only the last version of each document', async () => {
    const d = await signedUp();
    const note = d.repo.createNote({ title: 'Draft' });
    for (let i = 1; i <= 40; i++) d.repo.updateNote(note.id, { title: `Draft ${i}`, content: [{ id: 'b', type: 'p', html: 'x'.repeat(i) }] });
    const gone = d.repo.createNote({ title: 'Made and deleted before saving' });
    d.repo.deleteNote(gone.id);
    assert.equal(d.store.pendingCount(), 2);
    await d.store.flush();
    assert.equal(d.sent.length, 1);
    assert.deepEqual(d.sent[0].map((op) => [op.t, op.c, op.t === 'put' ? op.d.title : op.id]), [['put', 'notes', 'Draft 40'], ['del', 'notes', gone.id]]);
    assert.equal(d.store.syncState.get().pending, 0);
    assert.equal(d.store.syncState.get().health, 'ok');
    d.store.stop();
  });

  it('splits a very large save into several requests', async () => {
    const d = await signedUp();
    d.seed.seedDefaults();
    for (let i = 0; i < 450; i++) d.repo.createTask({ title: `Task ${i}` });
    await d.store.flush();
    assert.deepEqual(d.sent.map((ops) => ops.length), [200, 200, 54]);
    assert.equal((await same(d)).tasks.length, 450);
    d.store.stop();
  });

  it('saves name and settings changes, the latest of each', async () => {
    const d = await signedUp();
    const settings = { theme: 'dark', tint: 'green', glass: 10, aurora: true, time24: true, weekStart: 1, taskView: 'board', linkView: 'grid', calView: 'week', notify: false, chime: true, linkProvider: 'auto', defaultAlert: 5 };
    d.store.putProfile({ settings: { ...settings, glass: 99 } });
    d.store.putProfile({ name: 'New name' });
    d.store.putProfile({ settings });
    await d.store.flush();
    assert.deepEqual(d.sent, [[{ t: 'me', name: 'New name', settings }]]);
    const me = (await d.api('GET', 'me')).body.user;
    assert.equal(me.name, 'New name');
    assert.deepEqual(me.settings, settings);
    d.store.stop();
  });

  it('drops a change the server refuses, says so, and goes back to what the server has', async () => {
    const d = await signedUp();
    d.seed.seedDefaults();
    const good = d.repo.createTask({ title: 'Fine' });
    d.store.put('tasks', { id: 'broken', title: 12345 });
    const alsoGood = d.repo.createTask({ title: 'Also fine' });
    await d.store.flush();
    assert.equal(d.notices.length, 1);
    assert.match(d.notices[0], /^One change could not be saved\. tasks\.[a-z_]+ /);
    assert.equal(d.store.pendingCount(), 0);
    await d.store.refresh();
    assert.deepEqual(d.repo.listTasks().map((t) => t.id).sort(), [good.id, alsoGood.id].sort(), 'the refused one is gone, the others were saved');
    d.notices.length = 0;
    await same(d);
    d.store.stop();
  });
});

describe('two devices on one account', () => {
  it('each sees what the other saved after a refresh; the later save of the same item wins', async () => {
    const laptop = await signedUp();
    laptop.seed.seedDefaults();
    const task = laptop.repo.createTask({ title: 'From the laptop' });
    await laptop.store.flush();

    const phone = await signedIn(laptop);
    assert.deepEqual(phone.repo.listTasks().map((t) => t.title), ['From the laptop']);
    assert.equal(phone.repo.listStages().length, 4);

    phone.repo.updateTask(task.id, { title: 'Renamed on the phone' });
    const added = phone.repo.createTask({ title: 'Added on the phone' });
    await phone.store.flush();
    assert.equal(laptop.repo.getTask(task.id).title, 'From the laptop', 'not yet');
    await laptop.store.refresh();
    assert.equal(laptop.repo.getTask(task.id).title, 'Renamed on the phone');
    assert.equal(laptop.repo.getTask(added.id).title, 'Added on the phone');

    // Both change the same task; whoever saves last wins, on both devices.
    laptop.repo.updateTask(task.id, { title: 'Laptop says' });
    phone.repo.updateTask(task.id, { title: 'Phone says' });
    await laptop.store.flush();
    await phone.store.flush();
    await laptop.store.refresh();
    await phone.store.refresh();
    assert.equal(laptop.repo.getTask(task.id).title, 'Phone says');
    assert.equal(phone.repo.getTask(task.id).title, 'Phone says');
    assert.deepEqual((await laptop.compare()).local, (await phone.compare()).local);
    laptop.store.stop();
    phone.store.stop();
  });

  it('notices on its own save that the other device saved in between, and catches up', async () => {
    const laptop = await signedUp();
    laptop.seed.seedDefaults();
    await laptop.store.flush();
    const phone = await signedIn(laptop);

    laptop.repo.createTask({ title: 'Laptop 1' });
    await laptop.store.flush();
    phone.repo.createTask({ title: 'Phone 1' });
    await phone.store.flush();
    // The phone's save came back two revisions ahead of what it knew, so it fetches without being told to.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(phone.repo.listTasks().map((t) => t.title).sort(), ['Laptop 1', 'Phone 1']);
    laptop.store.stop();
    phone.store.stop();
  });

  it('ends up with one set of board stages even if both devices set up the new account', async () => {
    const first = await signedUp();
    first.state.online = false;
    first.seed.seedDefaults();
    first.seed.seedSamples();
    await first.store.flush();

    // The first save never arrived, so a second device finds an empty account and sets it up too.
    const second = await device();
    const answer = await second.api('POST', 'signin', { email: first.email, password: first.password });
    second.store.start(answer.body.user);
    await second.store.refresh({ force: true, strict: true });
    second.seed.seedDefaults();
    second.repo.createTask({ title: 'Made on the second device' });
    await second.store.flush();

    first.state.online = true;
    await first.store.refresh();
    await second.store.refresh();
    assert.deepEqual(first.repo.listStages().map((s) => s.name), ['To do', 'In progress', 'In review', 'Done']);
    assert.deepEqual(second.repo.listStages().map((s) => s.name), ['To do', 'In progress', 'In review', 'Done']);
    assert.equal(second.repo.listTasks().length, 11);
    assert.ok(second.repo.listTasks().every((t) => second.repo.listStages().some((s) => s.id === t.stage_id)), 'every task sits in a stage that exists');
    first.notices.length = 0;
    assert.deepEqual((await first.compare()).local, (await second.compare()).local);
    first.store.stop();
    second.store.stop();
  });

  it('asks only "anything new?" when it is already up to date', async () => {
    const d = await signedUp();
    d.seed.seedDefaults();
    await d.store.flush();
    const before = d.store.exportData();
    await d.store.refresh();
    assert.deepEqual(d.store.exportData(), before);
    assert.equal(d.store.syncState.get().health, 'ok');
    d.store.stop();
  });
});

describe('working offline', () => {
  it('keeps changes, survives a reload, and sends them once back online, without losing what happened elsewhere', async () => {
    const laptop = await signedUp();
    laptop.seed.seedDefaults();
    const shared = laptop.repo.createTask({ title: 'Shared' });
    await laptop.store.flush();
    let phone = await signedIn(laptop);
    await phone.store.saveCache();

    phone.state.online = false;
    const offline = phone.repo.createTask({ title: 'Written offline' });
    phone.repo.updateTask(shared.id, { notes: 'edited offline' });
    await phone.store.flush();
    assert.equal(phone.store.syncState.get().health, 'offline');
    assert.equal(phone.store.syncState.get().pending, 2);
    assert.deepEqual(phone.notices, ['You’re offline. Changes are kept on this device and will sync when you reconnect.']);
    await phone.store.saveCache();
    phone.store.stop();

    // Meanwhile, on the laptop.
    laptop.repo.createTask({ title: 'Laptop while phone was away' });
    await laptop.store.flush();

    // The phone's page is reloaded while still offline: it opens from its own copy, unsent changes included.
    phone = await device(phone);
    const cached = await phone.store.loadCache();
    assert.equal(cached.userId, laptop.user.id);
    assert.equal(cached.outbox.length, 2);
    phone.store.start(cached.user, cached);
    assert.deepEqual(phone.repo.listTasks().map((t) => t.title).sort(), ['Shared', 'Written offline']);
    assert.equal(phone.repo.getTask(shared.id).notes, 'edited offline');
    await phone.store.refresh();
    assert.equal(phone.store.pendingCount(), 2, 'still offline, still waiting');

    phone.state.online = true;
    await phone.store.refresh();
    assert.equal(phone.store.pendingCount(), 0);
    assert.deepEqual(phone.repo.listTasks().map((t) => t.title).sort(), ['Laptop while phone was away', 'Shared', 'Written offline']);
    await laptop.store.refresh();
    assert.equal(laptop.repo.getTask(offline.id).title, 'Written offline');
    assert.equal(laptop.repo.getTask(shared.id).notes, 'edited offline');
    assert.deepEqual((await laptop.compare()).local, (await phone.compare()).local);
    laptop.store.stop();
    phone.store.stop();
  });

  it('does not lose what is typed while fresh data is on its way', async () => {
    const laptop = await signedUp();
    laptop.seed.seedDefaults();
    await laptop.store.flush();
    const phone = await signedIn(laptop);
    laptop.repo.createTask({ title: 'From elsewhere' });
    await laptop.store.flush();

    phone.state.delay = 150;
    const refreshing = phone.store.refresh();
    await new Promise((resolve) => setTimeout(resolve, 60));
    const typed = phone.repo.createTask({ title: 'Typed during the refresh' });
    await refreshing;
    assert.deepEqual(phone.repo.listTasks().map((t) => t.title).sort(), ['From elsewhere', 'Typed during the refresh']);
    phone.state.delay = 0;
    await phone.store.flush();
    await laptop.store.refresh();
    assert.equal(laptop.repo.getTask(typed.id).title, 'Typed during the refresh');
    laptop.store.stop();
    phone.store.stop();
  });
});

describe('when the session ends', () => {
  it('a password change elsewhere signs the device out; its unsent work is sent after signing in again', async () => {
    const laptop = await signedUp();
    laptop.seed.seedDefaults();
    await laptop.store.flush();
    let phone = await signedIn(laptop);

    phone.state.online = false;
    phone.repo.createTask({ title: 'Unsent when signed out' });
    await phone.store.flush();
    assert.equal((await laptop.api('POST', 'password', { current: laptop.password, next: 'a different password' })).status, 200);
    laptop.password = 'a different password';

    phone.state.online = true;
    await phone.store.saveCache();
    await phone.store.flush();
    assert.equal(phone.expired, 1, 'the app is told the session ended');

    phone = await signedIn(laptop, await device(phone));
    await phone.store.flush();
    await laptop.store.refresh();
    assert.deepEqual(laptop.repo.listTasks().map((t) => t.title), ['Unsent when signed out']);
    laptop.store.stop();
    phone.store.stop();
  });

  it('never shows one account’s offline copy to another account on the same browser', async () => {
    const first = await signedUp();
    first.seed.seedDefaults();
    first.repo.createTask({ title: 'Private to the first account' });
    await first.store.flush();
    await first.store.saveCache();
    first.store.stop();

    const second = await signedUp();
    second.store.stop();
    // The second person signs in on the first person's browser (same offline storage).
    const shared = await device(first);
    const answer = await shared.api('POST', 'signin', { email: second.email, password: second.password });
    shared.store.start(answer.body.user, await shared.store.loadCache());
    assert.deepEqual(shared.repo.listTasks(), []);
    await shared.store.refresh({ force: true, strict: true });
    assert.deepEqual(shared.repo.listTasks(), []);
    assert.equal(shared.store.pendingCount(), 0);
    shared.store.stop();
  });
});
