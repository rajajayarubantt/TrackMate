// A small in-memory stand-in for the part of the MongoDB driver that TrackMate uses.
//
// It lets the whole app run on a computer with no database ("npm run dev" without MONGODB_URI)
// and lets the API be tested without a cluster. It is never used on Vercel: there the real driver
// in mongo.js is the only option.
//
// Only what server/app.js needs is implemented, and anything outside that set throws instead of
// silently behaving differently from MongoDB.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function duplicateKey(collection, field, value) {
  const error = new Error(`E11000 duplicate key error collection: ${collection} index: ${field} dup key: ${JSON.stringify(value)}`);
  error.name = 'MongoServerError';
  error.code = 11000;
  return error;
}

const COMPARE = {
  $in: (value, list) => list.includes(value),
  $nin: (value, list) => !list.includes(value),
  $ne: (value, other) => value !== other,
  $gt: (value, other) => value > other,
  $gte: (value, other) => value >= other,
  $lt: (value, other) => value < other,
  $lte: (value, other) => value <= other,
  $exists: (value, wanted) => (value !== undefined) === wanted,
};

function matches(doc, filter) {
  for (const [key, condition] of Object.entries(filter ?? {})) {
    if (key.startsWith('$') || key.includes('.')) throw new Error(`memory-db: filter "${key}" is not supported`);
    const value = doc[key];
    if (isPlain(condition) && Object.keys(condition).some((k) => k.startsWith('$'))) {
      for (const [operator, operand] of Object.entries(condition)) {
        const test = COMPARE[operator];
        if (!test) throw new Error(`memory-db: operator "${operator}" is not supported`);
        if (!test(value, operand)) return false;
      }
    } else if (condition === null ? value != null : value !== condition) {
      return false;
    }
  }
  return true;
}

function applyUpdate(doc, update, inserting) {
  const operators = Object.keys(update ?? {});
  if (!operators.length || operators.some((k) => !k.startsWith('$'))) {
    throw new Error('memory-db: an update must use operators such as $set');
  }
  for (const [operator, fields] of Object.entries(update)) {
    for (const [key, value] of Object.entries(fields)) {
      if (key.includes('.')) throw new Error(`memory-db: dotted field "${key}" is not supported`);
      if (key === '_id') throw new Error('memory-db: _id cannot be changed');
      if (operator === '$set') doc[key] = clone(value);
      else if (operator === '$setOnInsert') { if (inserting) doc[key] = clone(value); }
      else if (operator === '$inc') doc[key] = (doc[key] ?? 0) + value;
      else if (operator === '$unset') delete doc[key];
      else throw new Error(`memory-db: update operator "${operator}" is not supported`);
    }
  }
}

function project(doc, projection) {
  if (!doc || !projection || !Object.keys(projection).length) return clone(doc);
  const keys = Object.keys(projection);
  const including = keys.some((k) => k !== '_id' && projection[k]);
  const copy = {};
  if (including) {
    if (projection._id !== 0 && projection._id !== false) copy._id = doc._id;
    for (const key of keys) if (projection[key] && key in doc) copy[key] = doc[key];
  } else {
    for (const key of Object.keys(doc)) if (!(key in projection)) copy[key] = doc[key];
  }
  return clone(copy);
}

class MemoryCollection {
  constructor(name, docs, changed) {
    this.collectionName = name;
    this.docs = docs;
    this.unique = new Set();
    this.changed = changed;
  }

  checkUnique(candidate) {
    for (const field of this.unique) {
      if (candidate[field] === undefined) continue;
      for (const doc of this.docs.values()) {
        if (doc._id !== candidate._id && doc[field] === candidate[field]) throw duplicateKey(this.collectionName, field, candidate[field]);
      }
    }
  }

  first(filter) {
    if (typeof filter?._id === 'string' && this.docs.has(filter._id)) {
      const doc = this.docs.get(filter._id);
      return matches(doc, filter) ? doc : undefined;
    }
    for (const doc of this.docs.values()) if (matches(doc, filter)) return doc;
    return undefined;
  }

  insert(doc) {
    const copy = clone(doc);
    copy._id ??= randomBytes(12).toString('hex');
    if (this.docs.has(copy._id)) throw duplicateKey(this.collectionName, '_id_', copy._id);
    this.checkUnique(copy);
    this.docs.set(copy._id, copy);
    this.changed();
    return copy;
  }

  upsertFrom(filter) {
    const seed = {};
    for (const [key, value] of Object.entries(filter ?? {})) if (!isPlain(value)) seed[key] = value;
    return seed;
  }

  async createIndex(keys, options = {}) {
    const fields = Object.keys(keys);
    if (options.unique) {
      if (fields.length !== 1) throw new Error('memory-db: only single-field unique indexes are supported');
      this.unique.add(fields[0]);
    }
    return `${fields.join('_')}_1`;
  }

  async findOne(filter = {}, options = {}) {
    return project(this.first(filter), options.projection) ?? null;
  }

  find(filter = {}, options = {}) {
    return {
      toArray: async () => [...this.docs.values()].filter((doc) => matches(doc, filter)).map((doc) => project(doc, options.projection)),
    };
  }

  async countDocuments(filter = {}) {
    let count = 0;
    for (const doc of this.docs.values()) if (matches(doc, filter)) count++;
    return count;
  }

  async insertOne(doc) {
    const stored = this.insert(doc);
    return { acknowledged: true, insertedId: stored._id };
  }

  async updateOne(filter, update, options = {}) {
    const existing = this.first(filter);
    if (existing) {
      const next = clone(existing);
      applyUpdate(next, update, false);
      this.checkUnique(next);
      this.docs.set(next._id, next);
      this.changed();
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
    }
    if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
    const created = this.upsertFrom(filter);
    applyUpdate(created, update, true);
    const stored = this.insert(created);
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: stored._id };
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const before = this.first(filter);
    if (!before && !options.upsert) return null;
    const snapshot = clone(before);
    await this.updateOne(filter, update, options);
    if (options.returnDocument !== 'after') return project(snapshot, options.projection) ?? null;
    const after = before ? this.docs.get(before._id) : this.first(filter);
    return project(after, options.projection) ?? null;
  }

  async replaceOne(filter, replacement, options = {}) {
    if (Object.keys(replacement).some((k) => k.startsWith('$'))) throw new Error('memory-db: a replacement cannot contain operators');
    const existing = this.first(filter);
    if (existing) {
      const next = { ...clone(replacement), _id: existing._id };
      this.checkUnique(next);
      this.docs.set(next._id, next);
      this.changed();
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null };
    }
    if (!options.upsert) return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 0, upsertedId: null };
    const stored = this.insert({ ...this.upsertFrom(filter), ...replacement });
    return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: stored._id };
  }

  async deleteOne(filter = {}) {
    const doc = this.first(filter);
    if (!doc) return { acknowledged: true, deletedCount: 0 };
    this.docs.delete(doc._id);
    this.changed();
    return { acknowledged: true, deletedCount: 1 };
  }

  async deleteMany(filter = {}) {
    let deletedCount = 0;
    for (const doc of [...this.docs.values()]) {
      if (matches(doc, filter)) {
        this.docs.delete(doc._id);
        deletedCount++;
      }
    }
    if (deletedCount) this.changed();
    return { acknowledged: true, deletedCount };
  }

  async bulkWrite(operations) {
    const result = { insertedCount: 0, matchedCount: 0, modifiedCount: 0, deletedCount: 0, upsertedCount: 0 };
    for (const operation of operations) {
      const [[kind, args]] = Object.entries(operation);
      if (kind === 'replaceOne') {
        const r = await this.replaceOne(args.filter, args.replacement, { upsert: args.upsert });
        result.matchedCount += r.matchedCount;
        result.modifiedCount += r.modifiedCount;
        result.upsertedCount += r.upsertedCount;
      } else if (kind === 'updateOne') {
        const r = await this.updateOne(args.filter, args.update, { upsert: args.upsert });
        result.matchedCount += r.matchedCount;
        result.modifiedCount += r.modifiedCount;
        result.upsertedCount += r.upsertedCount;
      } else if (kind === 'deleteOne') {
        result.deletedCount += (await this.deleteOne(args.filter)).deletedCount;
      } else if (kind === 'deleteMany') {
        result.deletedCount += (await this.deleteMany(args.filter)).deletedCount;
      } else if (kind === 'insertOne') {
        await this.insertOne(args.document);
        result.insertedCount++;
      } else {
        throw new Error(`memory-db: bulk operation "${kind}" is not supported`);
      }
    }
    return result;
  }
}

/**
 * @param {{ file?: string }} [options] file: keep the data in this JSON file between restarts.
 */
export function createMemoryDb(options = {}) {
  const file = options.file ? path.resolve(options.file) : '';
  const collections = new Map();
  let timer;

  const save = () => {
    timer = undefined;
    if (!file) return;
    const dump = {};
    for (const [name, collection] of collections) dump[name] = [...collection.docs.values()];
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(dump));
    renameSync(`${file}.tmp`, file);
  };
  const changed = () => {
    if (!file || timer) return;
    timer = setTimeout(save, 150);
    timer.unref?.();
  };

  const collection = (name) => {
    let found = collections.get(name);
    if (!found) {
      found = new MemoryCollection(name, new Map(), changed);
      collections.set(name, found);
    }
    return found;
  };

  if (file && existsSync(file)) {
    try {
      const dump = JSON.parse(readFileSync(file, 'utf8'));
      for (const [name, docs] of Object.entries(dump)) {
        const target = collection(name);
        for (const doc of docs) target.docs.set(doc._id, doc);
      }
    } catch (error) {
      console.warn(`  Could not read ${file}; starting with an empty database. (${error.message})`);
    }
  }
  if (file) process.once('exit', () => timer && save());

  return {
    databaseName: 'memory',
    collection,
    command: async () => ({ ok: 1 }),
  };
}
