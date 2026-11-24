// Picks the database and prepares it.
//   MONGODB_URI set            → MongoDB Atlas (always the case on Vercel)
//   MONGODB_URI not set, local → an in-memory stand-in saved to .data/dev-db.json, so "npm run dev" works straight away
import { ConfigError } from './errors.js';

/** One MongoDB collection per kind of item. Every document carries the id of the account that owns it. */
export const COLLECTIONS = ['tags', 'links', 'stages', 'tasks', 'notes', 'events', 'reminders', 'focus'];

export const isHosted = () => !!process.env.VERCEL || process.env.NODE_ENV === 'production';
export const databaseName = () => (process.env.MONGODB_DB || '').trim() || 'trackmate';

let opening;
let override;

async function open() {
  const uri = (process.env.MONGODB_URI || '').trim();
  let db;
  let kind;
  if (override) {
    db = override;
    kind = 'memory';
  } else if (uri) {
    let mongo;
    try {
      mongo = await import('./mongo.js');
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') throw new ConfigError('The MongoDB driver is not installed. Run "npm install" in the project folder.');
      throw error;
    }
    db = await mongo.connect(uri, databaseName());
    kind = 'mongodb';
  } else if (isHosted()) {
    throw new ConfigError(
      'MONGODB_URI is not set. Add your MongoDB Atlas connection string as the MONGODB_URI environment variable in Vercel (Settings → Environment Variables), then redeploy.',
    );
  } else {
    const { createMemoryDb } = await import('./memory-db.js');
    const file = process.env.TRACKMATE_DEV_DB ?? '.data/dev-db.json';
    db = createMemoryDb({ file: file === 'off' ? '' : file });
    kind = 'memory';
  }
  // Creating an index that already exists does nothing, so this is safe on every cold start.
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    ...COLLECTIONS.map((name) => db.collection(name).createIndex({ userId: 1 })),
  ]);
  return { db, kind };
}

/** @returns {Promise<{ db: any, kind: 'mongodb' | 'memory' }>} */
export function database() {
  opening ??= open().catch((error) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

/** Tests and the database check use this to run the API against a database of their choosing. */
export function useDatabase(db) {
  override = db;
  opening = undefined;
}

export async function closeDatabase() {
  const wasMongo = !override && !!(process.env.MONGODB_URI || '').trim();
  opening = undefined;
  if (wasMongo) {
    const { disconnect } = await import('./mongo.js');
    await disconnect();
  }
}
