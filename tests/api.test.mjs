// The API, end to end, against the in-memory stand-in for MongoDB.  Run with: npm test
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createToken } from '../server/auth.js';
import { useDatabase } from '../server/db.js';
import { call, freshDatabase, newAccount, putAll, SAMPLE, SETTINGS } from './helpers.mjs';

let db;
beforeEach(() => {
  db = freshDatabase();
  delete process.env.SIGNUP;
});

describe('health and routing', () => {
  it('reports a working database', async () => {
    const { status, body } = await call('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.signup, 'open');
  });

  it('answers on the rewritten address Vercel uses (/api?route=…)', async () => {
    const { jar } = await newAccount();
    for (const path of ['/api/me', '/api?route=me', '/api/index?route=me', '/api/me/']) {
      const { status, body } = await call('GET', path, undefined, jar);
      assert.equal(status, 200, path);
      assert.equal(body.user.name, 'Test Person', path);
    }
  });

  it('says 404 for unknown addresses and 405 for the wrong method', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404);
    assert.equal((await call('GET', '/api')).status, 404);
    assert.equal((await call('GET', '/api/sync')).status, 405);
    assert.equal((await call('POST', '/api/data', {})).status, 405);
  });
});

describe('accounts', () => {
  it('creates an account, signs in, and keeps the session in an HttpOnly cookie', async () => {
    const jar = {};
    const made = await call('POST', '/api/signup', { name: ' Ada ', email: ' Ada@Example.COM ', password: 'analytical engine', settings: SETTINGS }, jar);
    assert.equal(made.status, 201);
    assert.deepEqual({ ...made.body.user, id: 0, created_at: 0 }, { id: 0, email: 'ada@example.com', name: 'Ada', settings: SETTINGS, created_at: 0 });
    assert.match(made.cookie, /^tm_session=[\w.-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    assert.equal(JSON.stringify(made.body).includes('scrypt'), false, 'the password hash never leaves the server');

    const me = await call('GET', '/api/me', undefined, jar);
    assert.equal(me.body.user.email, 'ada@example.com');

    const again = await call('POST', '/api/signin', { email: 'ADA@example.com', password: 'analytical engine' }, {});
    assert.equal(again.status, 200);
    assert.equal(again.body.user.id, made.body.user.id);
  });

  it('marks the cookie Secure when the site is served over https', async () => {
    const made = await call('POST', '/api/signup', { name: 'A', email: 'secure@example.com', password: 'long enough' }, {}, { 'x-forwarded-proto': 'https' });
    assert.match(made.cookie, /; Secure$/);
  });

  it('stores passwords as salted scrypt hashes', async () => {
    const one = await newAccount();
    const two = await newAccount();
    const users = await db.collection('users').find({}).toArray();
    assert.equal(users.length, 2);
    for (const user of users) assert.match(user.pass, /^scrypt:16384:8:1:[\w-]{22}:[\w-]{86}$/);
    assert.notEqual(users[0].pass, users[1].pass, 'same password, different salt');
    assert.equal(one.password, two.password);
  });

  it('rejects bad sign-up details with a message for each', async () => {
    const tries = [
      [{ name: '', email: 'a@b.co', password: 'long enough' }, 'Enter your name.'],
      [{ name: 'A', email: 'not-an-email', password: 'long enough' }, 'Enter a valid email address.'],
      [{ name: 'A', email: 'a@b.co', password: 'short' }, 'Use a password with at least 8 characters.'],
      [{ name: 'A', email: 'a@b.co', password: 'x'.repeat(201) }, 'Use a password with at most 200 characters.'],
      [{ name: 'A', email: { $ne: null }, password: 'long enough' }, 'Enter a valid email address.'],
      [{ name: 'A', email: 'a@b.co', password: 'long enough', settings: { theme: 'dark', $where: '1' } }, 'settings.$where is not a known field.'],
    ];
    for (const [body, message] of tries) {
      const { status, body: answer } = await call('POST', '/api/signup', body);
      assert.equal(status, 400, message);
      assert.equal(answer.error, message);
    }
    assert.equal(await db.collection('users').countDocuments({}), 0);
  });

  it('refuses a second account with the same email, whatever the capitals', async () => {
    const { email } = await newAccount();
    const { status, body } = await call('POST', '/api/signup', { name: 'Twin', email: email.toUpperCase(), password: 'long enough' });
    assert.equal(status, 409);
    assert.match(body.error, /already exists/);
  });

  it('can be closed to new accounts with SIGNUP=closed', async () => {
    process.env.SIGNUP = 'closed';
    const { status, body } = await call('POST', '/api/signup', { name: 'A', email: 'late@example.com', password: 'long enough' });
    assert.equal(status, 403);
    assert.match(body.error, /turned off/);
    assert.equal((await call('GET', '/api/me')).body.signup, false);
    assert.equal((await call('GET', '/api/health')).body.signup, 'closed');
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { email } = await newAccount();
    const wrong = await call('POST', '/api/signin', { email, password: 'not the password' });
    const unknown = await call('POST', '/api/signin', { email: 'nobody@example.com', password: 'not the password' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.equal(wrong.cookie, '');
  });

  it('does not accept MongoDB operators in place of an email or password', async () => {
    await newAccount();
    for (const body of [{ email: { $ne: null }, password: 'x' }, { email: 'a@b.co', password: { $ne: null } }, { email: ['a@b.co'], password: 'x' }]) {
      const { status } = await call('POST', '/api/signin', body);
      assert.equal(status, 400);
    }
  });

  it('locks an account for a while after eight wrong passwords, then lets the right one in', async () => {
    const { email, password, user } = await newAccount();
    for (let i = 0; i < 8; i++) assert.equal((await call('POST', '/api/signin', { email, password: `wrong ${i}` })).status, 401);
    const locked = await call('POST', '/api/signin', { email, password });
    assert.equal(locked.status, 429);
    // Move the clock: the lock is a timestamp on the account.
    await db.collection('users').updateOne({ _id: user.id }, { $set: { lockUntil: Date.now() - 1 } });
    assert.equal((await call('POST', '/api/signin', { email, password })).status, 200);
  });

  it('treats a forged, altered or expired session as signed out', async () => {
    const { jar, user } = await newAccount();
    const token = jar.cookie.split('=')[1];
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ u: user.id, v: 1, e: Date.now() + 1e9 })).toString('base64url');
    const expired = createToken(user.id, 1, Date.now() - 31 * 24 * 60 * 60 * 1000);
    for (const bad of [`${forged}.${signature}`, `${payload}.${signature.slice(0, -2)}xx`, payload, expired, '']) {
      const jarBad = { cookie: `tm_session=${bad}` };
      assert.equal((await call('GET', '/api/me', undefined, jarBad)).body.user, null);
      assert.equal((await call('GET', '/api/data', undefined, jarBad)).status, 401);
      assert.equal((await call('POST', '/api/sync', { ops: [] }, jarBad)).status, 401);
    }
    assert.equal((await call('GET', '/api/data', undefined, jar)).status, 200);
  });

  it('renews a session that is more than half used', async () => {
    const { user } = await newAccount();
    const old = createToken(user.id, 1, Date.now() - 20 * 24 * 60 * 60 * 1000);
    const answer = await call('GET', '/api/me', undefined, { cookie: `tm_session=${old}` });
    assert.match(answer.cookie, /^tm_session=/);
    const fresh = await call('GET', '/api/me', undefined, { cookie: `tm_session=${createToken(user.id, 1)}` });
    assert.equal(fresh.cookie, '');
  });

  it('signs out by clearing the cookie', async () => {
    const { jar } = await newAccount();
    const out = await call('POST', '/api/signout', {}, jar);
    assert.match(out.cookie, /^tm_session=; .*Max-Age=0/);
    assert.equal((await call('GET', '/api/me', undefined, jar)).body.user, null);
  });

  it('changes the password and signs out every other device', async () => {
    const { jar, email, password } = await newAccount();
    const otherDevice = {};
    await call('POST', '/api/signin', { email, password }, otherDevice);

    const wrong = await call('POST', '/api/password', { current: 'nope', next: 'a brand new one' }, jar);
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'Your current password is not correct.');
    const weak = await call('POST', '/api/password', { current: password, next: 'short' }, jar);
    assert.equal(weak.status, 400);

    const changed = await call('POST', '/api/password', { current: password, next: 'a brand new one' }, jar);
    assert.equal(changed.status, 200);
    assert.equal((await call('GET', '/api/data', undefined, jar)).status, 200, 'this device stays signed in');
    assert.equal((await call('GET', '/api/data', undefined, otherDevice)).status, 401, 'the other device is signed out');
    assert.equal((await call('POST', '/api/signin', { email, password })).status, 401);
    assert.equal((await call('POST', '/api/signin', { email, password: 'a brand new one' })).status, 200);
  });

  it('deletes an account with everything in it, and nothing of anyone else', async () => {
    const leaving = await newAccount();
    const staying = await newAccount();
    await call('POST', '/api/sync', { ops: putAll() }, leaving.jar);
    await call('POST', '/api/sync', { ops: putAll() }, staying.jar);

    const wrong = await call('POST', '/api/delete-account', { password: 'nope' }, leaving.jar);
    assert.equal(wrong.status, 400);
    const gone = await call('POST', '/api/delete-account', { password: leaving.password }, leaving.jar);
    assert.equal(gone.status, 200);
    assert.match(gone.cookie, /Max-Age=0/);

    for (const name of Object.keys(SAMPLE)) {
      assert.equal(await db.collection(name).countDocuments({ userId: leaving.user.id }), 0, name);
      assert.equal(await db.collection(name).countDocuments({ userId: staying.user.id }), 1, name);
    }
    assert.equal((await call('POST', '/api/signin', { email: leaving.email, password: leaving.password })).status, 401);
    assert.equal((await call('GET', '/api/data', undefined, staying.jar)).body.data.tasks.length, 1);
  });
});

describe('data', () => {
  it('starts empty at revision 0', async () => {
    const { jar } = await newAccount();
    const { body } = await call('GET', '/api/data', undefined, jar);
    assert.equal(body.rev, 0);
    assert.deepEqual(body.data, { tags: [], links: [], stages: [], tasks: [], notes: [], events: [], reminders: [], focus: [] });
  });

  it('stores one of everything and returns it exactly as sent', async () => {
    const { jar } = await newAccount();
    const saved = await call('POST', '/api/sync', { ops: putAll() }, jar);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.rev, 1);
    const { body } = await call('GET', '/api/data', undefined, jar);
    assert.equal(body.rev, 1);
    for (const [name, doc] of Object.entries(SAMPLE)) assert.deepEqual(body.data[name], [doc], name);
  });

  it('replaces a document on the next save and deletes on request', async () => {
    const { jar } = await newAccount();
    await call('POST', '/api/sync', { ops: putAll() }, jar);
    const second = await call('POST', '/api/sync', {
      ops: [
        { t: 'put', c: 'tasks', d: { ...SAMPLE.tasks, title: 'Renamed', sample: undefined } },
        { t: 'del', c: 'links', id: 'link1' },
        { t: 'del', c: 'reminders', id: SAMPLE.reminders.key },
        { t: 'del', c: 'notes', id: 'never-existed' },
      ],
    }, jar);
    assert.equal(second.body.rev, 2);
    const { body } = await call('GET', '/api/data', undefined, jar);
    assert.equal(body.data.tasks.length, 1);
    assert.equal(body.data.tasks[0].title, 'Renamed');
    assert.equal('sample' in body.data.tasks[0], false, 'a replaced document keeps nothing from the old one');
    assert.deepEqual(body.data.links, []);
    assert.deepEqual(body.data.reminders, []);
    assert.equal(body.data.notes.length, 1);
  });

  it('applies changes to the same document in the order they were made', async () => {
    const { jar } = await newAccount();
    await call('POST', '/api/sync', {
      ops: [
        { t: 'put', c: 'stages', d: SAMPLE.stages },
        { t: 'del', c: 'stages', id: 'stage1' },
        { t: 'put', c: 'stages', d: { ...SAMPLE.stages, name: 'Last one wins' } },
        { t: 'put', c: 'tags', d: SAMPLE.tags },
        { t: 'del', c: 'tags', id: 'tag1' },
      ],
    }, jar);
    const { body } = await call('GET', '/api/data', undefined, jar);
    assert.equal(body.data.stages[0].name, 'Last one wins');
    assert.deepEqual(body.data.tags, []);
  });

  it('answers "unchanged" when the browser already has the current revision', async () => {
    const { jar } = await newAccount();
    await call('POST', '/api/sync', { ops: putAll() }, jar);
    const same = await call('GET', '/api/data?rev=1', undefined, jar);
    assert.equal(same.body.unchanged, true);
    assert.equal(same.body.data, undefined);
    const behind = await call('GET', '/api/data?rev=0', undefined, jar);
    assert.equal(behind.body.unchanged, undefined);
    assert.equal(behind.body.data.tasks.length, 1);
  });

  it('raises the revision by exactly one per saved batch, and not at all for an empty one', async () => {
    const { jar } = await newAccount();
    for (let i = 1; i <= 3; i++) {
      const { body } = await call('POST', '/api/sync', { ops: [{ t: 'put', c: 'stages', d: { ...SAMPLE.stages, sort: i } }] }, jar);
      assert.equal(body.rev, i);
    }
    assert.equal((await call('POST', '/api/sync', { ops: [] }, jar)).body.rev, 3);
  });

  it('saves the name and settings', async () => {
    const { jar } = await newAccount();
    const { body } = await call('POST', '/api/sync', { ops: [{ t: 'me', name: '  Grace  ' }, { t: 'me', settings: SETTINGS }] }, jar);
    assert.equal(body.user.name, 'Grace');
    assert.deepEqual(body.user.settings, SETTINGS);
    assert.deepEqual((await call('GET', '/api/me', undefined, jar)).body.user.settings, SETTINGS);
  });

  it('keeps accounts apart, even when they use the same ids', async () => {
    const a = await newAccount('A');
    const b = await newAccount('B');
    await call('POST', '/api/sync', { ops: putAll() }, a.jar);
    await call('POST', '/api/sync', { ops: [{ t: 'put', c: 'tasks', d: { ...SAMPLE.tasks, title: 'B’s task' } }, { t: 'del', c: 'notes', id: 'note1' }] }, b.jar);

    const forA = (await call('GET', '/api/data', undefined, a.jar)).body.data;
    const forB = (await call('GET', '/api/data', undefined, b.jar)).body.data;
    assert.equal(forA.tasks[0].title, 'Write tests');
    assert.equal(forA.notes.length, 1, 'B deleting "note1" does not touch A’s note with that id');
    assert.equal(forB.tasks[0].title, 'B’s task');
    assert.equal(forB.links.length, 0);
    assert.equal(await db.collection('tasks').countDocuments({}), 2);
  });

  it('requires a session for data, saving and link previews', async () => {
    for (const [method, path, body] of [['GET', '/api/data'], ['POST', '/api/sync', { ops: [] }], ['GET', '/api/preview?url=https://example.com'], ['POST', '/api/password', {}], ['POST', '/api/delete-account', {}]]) {
      const answer = await call(method, path, body);
      assert.equal(answer.status, 401, path);
      assert.equal(answer.body.signup, true);
    }
  });
});

describe('what the server refuses to store', () => {
  const bad = [
    ['an unknown collection', { t: 'put', c: 'users', d: { id: 'x' } }, 'Unknown collection.'],
    ['an unknown kind of change', { t: 'merge', c: 'tasks', d: SAMPLE.tasks }, 'Unknown change type.'],
    ['a field that does not exist', { t: 'put', c: 'tags', d: { ...SAMPLE.tags, admin: true } }, 'tags.admin is not a known field.'],
    ['a MongoDB operator as a field', { t: 'put', c: 'tags', d: { ...SAMPLE.tags, $set: { name: 'x' } } }, 'tags.$set is not a known field.'],
    ['an account id of its own choosing', { t: 'put', c: 'tags', d: { ...SAMPLE.tags, userId: 'someone-else' } }, 'tags.userId is not a known field.'],
    ['an _id of its own choosing', { t: 'put', c: 'tags', d: { ...SAMPLE.tags, _id: 'x' } }, 'tags._id is not a known field.'],
    ['a missing field', { t: 'put', c: 'stages', d: { id: 's', name: 'x' } }, 'stages.color is missing.'],
    ['text where a number belongs', { t: 'put', c: 'stages', d: { ...SAMPLE.stages, sort: '1' } }, 'stages.sort must be a number.'],
    ['an object where text belongs', { t: 'put', c: 'stages', d: { ...SAMPLE.stages, name: { $gt: '' } } }, 'stages.name must be text.'],
    ['NaN-like numbers', { t: 'put', c: 'stages', d: { ...SAMPLE.stages, sort: null } }, 'stages.sort must be a number.'],
    ['an id with odd characters', { t: 'put', c: 'stages', d: { ...SAMPLE.stages, id: 'a:b' } }, 'stages.id is not a valid id.'],
    ['an id that is an object', { t: 'del', c: 'stages', id: { $ne: '' } }, 'id is not a valid id.'],
    ['unknown fields inside a checklist', { t: 'put', c: 'tasks', d: { ...SAMPLE.tasks, checklist: [{ id: 'c', text: 't', done: false, $x: 1 }] } }, 'tasks.checklist[0].$x is not a known field.'],
    ['unknown fields inside a note', { t: 'put', c: 'notes', d: { ...SAMPLE.notes, content: [{ id: 'b', type: 'p', html: '', onload: 'x' }] } }, 'notes.content[0].onload is not a known field.'],
    ['a tag list that is not a list', { t: 'put', c: 'links', d: { ...SAMPLE.links, tagIds: 'tag1' } }, 'links.tagIds must be a list of ids.'],
    ['text that is far too long', { t: 'put', c: 'tags', d: { ...SAMPLE.tags, name: 'x'.repeat(201) } }, 'tags.name is too long.'],
    ['settings it does not know', { t: 'me', settings: { ...SETTINGS, isAdmin: true } }, 'settings.isAdmin is not a known field.'],
    ['an empty name', { t: 'me', name: '   ' }, 'name is empty.'],
  ];
  for (const [what, op, message] of bad) {
    it(`refuses ${what}`, async () => {
      const { jar } = await newAccount();
      const { status, body } = await call('POST', '/api/sync', { ops: [{ t: 'put', c: 'stages', d: SAMPLE.stages }, op] }, jar);
      assert.equal(status, 400);
      assert.equal(body.error, message);
      assert.equal(body.index, 1, 'the answer says which change was refused');
      assert.equal((await call('GET', '/api/data', undefined, jar)).body.rev, 0, 'nothing from a refused batch is stored');
    });
  }

  it('refuses requests that are not JSON, too large, or too many changes at once', async () => {
    const { jar } = await newAccount();
    assert.equal((await call('POST', '/api/sync', 'ops=1', jar, { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
    assert.equal((await call('POST', '/api/sync', '{not json', jar, { 'content-type': 'application/json' })).status, 400);
    assert.equal((await call('POST', '/api/sync', '[1,2]', jar, { 'content-type': 'application/json' })).status, 400);
    assert.equal((await call('POST', '/api/sync', { ops: 'x' }, jar)).status, 400);
    const many = Array.from({ length: 501 }, (_, i) => ({ t: 'del', c: 'tags', id: `t${i}` }));
    assert.equal((await call('POST', '/api/sync', { ops: many }, jar)).status, 413);
    const huge = { t: 'put', c: 'notes', d: { ...SAMPLE.notes, content: Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, type: 'p', html: 'x'.repeat(190_000) })) } };
    const tooBig = await call('POST', '/api/sync', { ops: [huge] }, jar);
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.body.index, 0);
  });

  it('refuses changes sent from another website', async () => {
    const { jar } = await newAccount();
    const op = { ops: [{ t: 'put', c: 'stages', d: SAMPLE.stages }] };
    assert.equal((await call('POST', '/api/sync', op, jar, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await call('POST', '/api/signout', {}, jar, { origin: 'null' })).status, 403);
    assert.equal((await call('POST', '/api/sync', op, jar, { origin: 'http://trackmate.test' })).status, 200);
    assert.equal((await call('POST', '/api/sync', op, jar, { origin: 'https://my-app.vercel.app', 'x-forwarded-host': 'my-app.vercel.app' })).status, 200);
  });
});

describe('a deployment that is not set up yet', () => {
  it('explains which setting is missing instead of failing mysteriously', async () => {
    const saved = { VERCEL: process.env.VERCEL, MONGODB_URI: process.env.MONGODB_URI, SESSION_SECRET: process.env.SESSION_SECRET };
    try {
      process.env.VERCEL = '1';
      delete process.env.MONGODB_URI;
      delete process.env.SESSION_SECRET;

      useDatabase(undefined);
      const noDb = await call('GET', '/api/health');
      assert.equal(noDb.status, 500);
      assert.match(noDb.body.error, /^MONGODB_URI is not set/);
      assert.equal((await call('GET', '/api/me')).status, 500);

      freshDatabase();
      const noSecret = await call('GET', '/api/health');
      assert.equal(noSecret.status, 500);
      assert.match(noSecret.body.error, /^SESSION_SECRET is not set/);
      const signup = await call('POST', '/api/signup', { name: 'A', email: 'a@example.com', password: 'long enough' });
      assert.equal(signup.status, 500);
      assert.match(signup.body.error, /^SESSION_SECRET/);

      for (const useless of ['short', 'replace-with-a-long-random-value']) {
        process.env.SESSION_SECRET = useless;
        assert.equal((await call('GET', '/api/health')).status, 500, `"${useless}" is not accepted as a secret`);
      }
      process.env.SESSION_SECRET = 'a-long-random-secret-for-this-test';
      assert.equal((await call('GET', '/api/health')).status, 200);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
