// TrackMate's API. One handler serves every /api route, so on Vercel it is a single function
// (api/index.js) and locally the dev server calls the very same code.
//
//   POST /api/signup           create an account
//   POST /api/signin           sign in
//   POST /api/signout          sign out
//   GET  /api/me               who is signed in
//   GET  /api/data             everything that belongs to the signed-in account
//   POST /api/sync             save a batch of changes
//   POST /api/password         change password
//   POST /api/delete-account   delete the account and all of its data
//   GET  /api/preview?url=     title, description and banner image of a web page
//   GET  /api/health           is the deployment configured and can it reach the database
import { randomBytes } from 'node:crypto';
import * as auth from './auth.js';
import { COLLECTIONS, database, databaseName } from './db.js';
import { ConfigError, HttpError, describeDatabaseError, isDatabaseError } from './errors.js';
import { preview } from './preview.js';
import * as validate from './validate.js';

const MAX_BODY_CHARS = 4_000_000;
const MAX_FAILED_SIGN_INS = 8;
const LOCK_MS = 5 * 60 * 1000;

const signupOpen = () => (process.env.SIGNUP || '').trim().toLowerCase() !== 'closed';

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const publicUser = (doc) => ({ id: doc._id, email: doc.email, name: doc.name, settings: doc.settings ?? {}, created_at: doc.created_at });

async function readJson(request) {
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) throw new HttpError(415, 'Send JSON.');
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, 'That request is too large.');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'That request is not valid JSON.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'That request is not valid JSON.');
  return body;
}

/** Changes are only accepted from TrackMate's own pages, never from a form or script on another site. */
function checkOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (!origin) return;
  let host = '';
  try {
    host = new URL(origin).host;
  } catch {
    /* handled below */
  }
  const own = [url.host, request.headers.get('host'), request.headers.get('x-forwarded-host')];
  if (!host || !own.includes(host)) throw new HttpError(403, 'This request came from another site.');
}

/** The signed-in account, or null. A session stops working once the account's password changes or the account is deleted. */
async function currentUser(request, db) {
  const token = auth.readToken(auth.tokenFromRequest(request));
  const user = token && (await db.collection('users').findOne({ _id: token.userId }));
  return token && user && user.tokenVersion === token.tokenVersion ? { user, token } : null;
}

async function requireUser(request, db) {
  const found = await currentUser(request, db);
  if (!found) throw new HttpError(401, 'Sign in to continue.', { signup: signupOpen() });
  return found;
}

/** Keep people signed in while they keep using the app. */
const renewal = (request, user, token) =>
  auth.shouldRenew(token.expires) ? { 'Set-Cookie': auth.sessionCookie(request, auth.createToken(user._id, user.tokenVersion)) } : {};

// ── Accounts ───────────────────────────────────────────────────────────────────────────────────

async function signup(request, db) {
  if (!signupOpen()) throw new HttpError(403, 'Creating new accounts is turned off for this TrackMate.');
  const body = await readJson(request);
  const name = validate.displayName(body.name);
  const email = validate.email(body.email);
  const password = validate.password(body.password);
  const settings = body.settings === undefined ? {} : validate.settings(body.settings);
  const user = {
    _id: randomBytes(12).toString('hex'), email, name, pass: await auth.hashPassword(password), settings,
    tokenVersion: 1, rev: 0, fails: 0, lockUntil: 0, created_at: Date.now(),
  };
  try {
    await db.collection('users').insertOne(user);
  } catch (error) {
    if (error?.code === 11000) throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
    throw error;
  }
  return json({ user: publicUser(user), rev: 0 }, 201, { 'Set-Cookie': auth.sessionCookie(request, auth.createToken(user._id, 1)) });
}

async function signin(request, db) {
  const body = await readJson(request);
  if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new HttpError(400, 'Enter your email and password.');
  const users = db.collection('users');
  const user = await users.findOne({ email: body.email.trim().toLowerCase() });
  if (user && user.lockUntil > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');

  const ok = await auth.verifyPassword(body.password.length > 200 ? '' : body.password, user?.pass);
  if (!user || !ok) {
    if (user) {
      const after = await users.findOneAndUpdate({ _id: user._id }, { $inc: { fails: 1 } }, { returnDocument: 'after' });
      if (after && after.fails >= MAX_FAILED_SIGN_INS) {
        await users.updateOne({ _id: user._id }, { $set: { fails: 0, lockUntil: Date.now() + LOCK_MS } });
      }
    }
    throw new HttpError(401, 'That email and password do not match.');
  }
  if (user.fails || user.lockUntil) await users.updateOne({ _id: user._id }, { $set: { fails: 0, lockUntil: 0 } });
  return json({ user: publicUser(user), rev: user.rev }, 200, {
    'Set-Cookie': auth.sessionCookie(request, auth.createToken(user._id, user.tokenVersion)),
  });
}

async function signout(request) {
  return json({ ok: true }, 200, { 'Set-Cookie': auth.clearedCookie(request) });
}

/** Who is signed in. Not being signed in is an ordinary answer here (user: null), not an error. */
async function me(request, db) {
  const found = await currentUser(request, db);
  if (!found) return json({ user: null, signup: signupOpen() });
  return json({ user: publicUser(found.user), rev: found.user.rev, signup: signupOpen() }, 200, renewal(request, found.user, found.token));
}

async function changePassword(request, db) {
  const { user } = await requireUser(request, db);
  const body = await readJson(request);
  if (typeof body.current !== 'string' || !(await auth.verifyPassword(body.current.slice(0, 200), user.pass))) {
    throw new HttpError(400, 'Your current password is not correct.');
  }
  const pass = await auth.hashPassword(validate.password(body.next));
  // A new token version signs out every other device that still holds an old session.
  const updated = await db.collection('users').findOneAndUpdate(
    { _id: user._id },
    { $set: { pass, fails: 0, lockUntil: 0 }, $inc: { tokenVersion: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new HttpError(401, 'Sign in to continue.');
  return json({ ok: true }, 200, { 'Set-Cookie': auth.sessionCookie(request, auth.createToken(updated._id, updated.tokenVersion)) });
}

async function deleteAccount(request, db) {
  const { user } = await requireUser(request, db);
  const body = await readJson(request);
  if (typeof body.password !== 'string' || !(await auth.verifyPassword(body.password.slice(0, 200), user.pass))) {
    throw new HttpError(400, 'That password is not correct.');
  }
  await Promise.all(COLLECTIONS.map((name) => db.collection(name).deleteMany({ userId: user._id })));
  await db.collection('users').deleteOne({ _id: user._id });
  return json({ ok: true }, 200, { 'Set-Cookie': auth.clearedCookie(request) });
}

// ── Data ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Everything the account owns. `rev` counts saved batches: a browser that already has that
 * revision passes ?rev= and gets a tiny "unchanged" answer instead of all the data again.
 */
async function data(request, db, url) {
  // The revision is read before the documents (and sync writes documents before it bumps the
  // revision), so a snapshot can be older than its revision says but never newer.
  const { user, token } = await requireUser(request, db);
  const headers = renewal(request, user, token);
  const known = url.searchParams.get('rev');
  if (known !== null && Number(known) === user.rev) {
    return json({ user: publicUser(user), rev: user.rev, unchanged: true }, 200, headers);
  }
  const lists = await Promise.all(
    COLLECTIONS.map((name) => db.collection(name).find({ userId: user._id }, { projection: { _id: 0, userId: 0 } }).toArray()),
  );
  return json({ user: publicUser(user), rev: user.rev, data: Object.fromEntries(COLLECTIONS.map((name, i) => [name, lists[i]])) }, 200, headers);
}

/** Save a batch of changes: whole documents to store, ids to delete, and changes to the profile. */
async function sync(request, db) {
  const { user } = await requireUser(request, db);
  const body = await readJson(request);
  const ops = validate.operations(body.ops);
  if (!ops.length) return json({ user: publicUser(user), rev: user.rev });

  const writes = new Map();
  const profile = {};
  for (const op of ops) {
    if (op.t === 'me') {
      if (op.name !== undefined) profile.name = op.name;
      if (op.settings !== undefined) profile.settings = op.settings;
      continue;
    }
    // Document ids are prefixed with the account id, so one account can never touch another's data.
    const filter = { _id: `${user._id}:${op.id}` };
    if (!writes.has(op.c)) writes.set(op.c, []);
    writes.get(op.c).push(
      op.t === 'put'
        ? { replaceOne: { filter, replacement: { ...op.d, userId: user._id }, upsert: true } }
        : { deleteOne: { filter } },
    );
  }
  await Promise.all([...writes].map(([name, list]) => db.collection(name).bulkWrite(list, { ordered: true })));

  const update = { $inc: { rev: 1 } };
  if (Object.keys(profile).length) update.$set = profile;
  const updated = await db.collection('users').findOneAndUpdate({ _id: user._id }, update, { returnDocument: 'after' });
  if (!updated) throw new HttpError(401, 'Sign in to continue.', { signup: signupOpen() });
  return json({ user: publicUser(updated), rev: updated.rev });
}

async function linkPreview(request, db, url) {
  await requireUser(request, db);
  const address = url.searchParams.get('url') || '';
  if (!address || address.length > 4000) throw new HttpError(400, 'Give the address of a page.');
  return json({ meta: await preview(address) });
}

async function health() {
  const { db, kind } = await database();
  await db.command({ ping: 1 });
  auth.assertConfigured();
  return json({
    ok: true,
    database: kind === 'mongodb' ? `MongoDB, database "${databaseName()}"` : 'In-memory stand-in (development only, MONGODB_URI is not set)',
    signup: signupOpen() ? 'open' : 'closed',
  });
}

// ── Routing ────────────────────────────────────────────────────────────────────────────────────

const ROUTES = {
  'POST signup': signup,
  'POST signin': signin,
  'POST signout': signout,
  'GET me': me,
  'GET data': data,
  'POST sync': sync,
  'POST password': changePassword,
  'POST delete-account': deleteAccount,
  'GET preview': linkPreview,
  'GET health': health,
};

/** Every route as "METHOD name", for the tests that check the browser and the server agree. */
export const routes = Object.keys(ROUTES);

function failure(error, route) {
  if (error instanceof HttpError) return json({ error: error.message, ...error.extra }, error.status);
  if (error instanceof ConfigError) return json({ error: error.message, setup: true }, 500);
  console.error(`[trackmate] /api/${route} failed:`, error);
  if (isDatabaseError(error)) {
    return json({ error: describeDatabaseError(error) || 'The database is not responding. Try again in a moment.', setup: true }, 503);
  }
  return json({ error: 'Something went wrong on the server.' }, 500);
}

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handle(request) {
  const url = new URL(request.url, 'http://localhost');
  // /api/sync arrives either as that path or, after Vercel's rewrite to /api, as ?route=sync.
  let route = url.pathname.replace(/^\/api(\/|$)/, '').replace(/\/+$/, '');
  if (!route || route === 'index') route = url.searchParams.get('route') || '';
  try {
    const handler = ROUTES[`${request.method} ${route}`];
    if (!handler) {
      const known = Object.keys(ROUTES).some((key) => key.endsWith(` ${route}`));
      throw new HttpError(known ? 405 : 404, known ? 'That method is not allowed here.' : 'There is nothing at this address.');
    }
    if (request.method !== 'GET') checkOrigin(request, url);
    if (handler === health) return await health();
    const { db } = await database();
    return await handler(request, db, url);
  } catch (error) {
    return failure(error, route);
  }
}
