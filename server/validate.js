// Checks everything the browser sends before it reaches the database.
//
// Every stored document is rebuilt field by field from a fixed description, so a request can never
// add its own keys (including MongoDB operators such as "$set") or store a value of the wrong type.
import { HttpError } from './errors.js';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[A-Za-z0-9_:.-]{1,200}$/;
const MAX_DOC_CHARS = 900_000;
export const MAX_OPS = 500;

const str = (max = 20_000) => ({ kind: 'str', max });
const num = { kind: 'num' };
const nnum = { kind: 'nnum' };
const flag = { kind: 'flag' };
const id = { kind: 'id' };
const nid = { kind: 'nid' };
const ids = { kind: 'ids' };
const nums = { kind: 'nums' };
const sample = { kind: 'bool', optional: true };

const stamps = { created_at: num, updated_at: num };

/** The shape of each kind of document. `key` names the field that identifies it. */
const SHAPES = {
  tags: { key: 'id', fields: { id, name: str(200), color: str(40), icon: str(80), sort: num, created_at: num, sample } },
  links: {
    key: 'id',
    fields: {
      id, url: str(4000), title: str(1000), description: str(10_000), note: str(), image: str(4000), favicon: str(4000),
      site_name: str(300), pinned: flag, is_read: flag, opens: num, ...stamps, tagIds: ids, sample,
    },
  },
  stages: { key: 'id', fields: { id, name: str(200), color: str(40), sort: num, is_done: flag, wip_limit: num } },
  tasks: {
    key: 'id',
    fields: {
      id, title: str(1000), notes: str(100_000), stage_id: id, sort: num, priority: num, due_at: nnum, due_has_time: flag,
      remind_at: nnum, checklist: { kind: 'list', max: 500, fields: { id, text: str(2000), done: { kind: 'bool' } } },
      completed_at: nnum, focus_minutes: num, ...stamps, tagIds: ids, sample,
    },
  },
  notes: {
    key: 'id',
    fields: {
      id, title: str(1000),
      content: { kind: 'list', max: 5000, fields: { id, type: str(20), html: str(200_000), checked: { kind: 'bool', optional: true } } },
      plain: str(600_000), pinned: flag, ...stamps, tagIds: ids, sample,
    },
  },
  events: {
    key: 'id',
    fields: {
      id, title: str(1000), kind: str(20), start_at: num, end_at: num, all_day: flag, location: str(1000), meeting_url: str(4000),
      attendees: str(5000), notes: str(100_000), color: str(40), remind_min: nnum, repeat: str(20), repeat_until: nnum, exdates: nums,
      ...stamps, tagIds: ids, sample,
    },
  },
  reminders: {
    key: 'key',
    fields: {
      key: { kind: 'key' }, title: str(1000), body: str(2000), item_type: str(20), item_id: str(64), fire_at: num, fired_at: num, seen: flag,
    },
  },
  focus: { key: 'id', fields: { id, task_id: nid, minutes: num, ended_at: num } },
};

const SETTINGS = {
  theme: str(10), tint: str(20), glass: num, aurora: { kind: 'bool' }, time24: { kind: 'bool' }, weekStart: num, taskView: str(10),
  linkView: str(10), calView: str(10), notify: { kind: 'bool' }, chime: { kind: 'bool' }, linkProvider: str(20), defaultAlert: nnum,
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message) => {
  throw new HttpError(400, message);
};

function check(value, spec, where) {
  switch (spec.kind) {
    case 'str':
      if (typeof value !== 'string') fail(`${where} must be text.`);
      if (value.length > spec.max) fail(`${where} is too long.`);
      return value;
    case 'num':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where} must be a number.`);
      return value;
    case 'nnum':
      if (value === null) return null;
      return check(value, num, where);
    case 'flag':
      if (value !== 0 && value !== 1) fail(`${where} must be 0 or 1.`);
      return value;
    case 'bool':
      if (typeof value !== 'boolean') fail(`${where} must be true or false.`);
      return value;
    case 'id':
      if (typeof value !== 'string' || !ID.test(value)) fail(`${where} is not a valid id.`);
      return value;
    case 'nid':
      if (value === null) return null;
      return check(value, id, where);
    case 'key':
      if (typeof value !== 'string' || !KEY.test(value)) fail(`${where} is not a valid key.`);
      return value;
    case 'ids':
      if (!Array.isArray(value) || value.length > 200) fail(`${where} must be a list of ids.`);
      return value.map((item, index) => check(item, id, `${where}[${index}]`));
    case 'nums':
      if (!Array.isArray(value) || value.length > 5000) fail(`${where} must be a list of numbers.`);
      return value.map((item, index) => check(item, num, `${where}[${index}]`));
    case 'list':
      if (!Array.isArray(value) || value.length > spec.max) fail(`${where} must be a list.`);
      return value.map((item, index) => shape(item, spec.fields, `${where}[${index}]`));
    default:
      throw new Error(`Unknown field kind ${spec.kind}`);
  }
}

function shape(value, fields, where) {
  if (!isObject(value)) fail(`${where} must be an object.`);
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(fields, name)) fail(`${where}.${name} is not a known field.`);
  }
  const out = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (value[name] === undefined) {
      if (spec.optional) continue;
      fail(`${where}.${name} is missing.`);
    }
    out[name] = check(value[name], spec, `${where}.${name}`);
  }
  return out;
}

export const isCollection = (name) => typeof name === 'string' && Object.hasOwn(SHAPES, name);
export const keyField = (collection) => SHAPES[collection].key;

export function settings(value, where = 'settings') {
  return shape(value, SETTINGS, where);
}

/**
 * Validate one batch of changes.
 * @returns {Array<{ t: 'put', c: string, id: string, d: object } | { t: 'del', c: string, id: string } | { t: 'me', name?: string, settings?: object }>}
 */
export function operations(list) {
  if (!Array.isArray(list)) fail('ops must be a list.');
  if (list.length > MAX_OPS) throw new HttpError(413, `Send at most ${MAX_OPS} changes at a time.`);
  return list.map((op, index) => {
    try {
      if (!isObject(op)) fail('Each change must be an object.');
      if (op.t === 'me') {
        const out = { t: 'me' };
        if (op.name !== undefined) {
          const name = check(op.name, str(100), 'name').trim();
          if (!name) fail('name is empty.');
          out.name = name;
        }
        if (op.settings !== undefined) out.settings = settings(op.settings);
        return out;
      }
      if (!isCollection(op.c)) fail('Unknown collection.');
      const spec = SHAPES[op.c];
      const idSpec = spec.fields[spec.key];
      if (op.t === 'del') return { t: 'del', c: op.c, id: check(op.id, idSpec, 'id') };
      if (op.t === 'put') {
        const doc = shape(op.d, spec.fields, op.c);
        if (JSON.stringify(doc).length > MAX_DOC_CHARS) throw new HttpError(413, 'This item is too large to save.');
        return { t: 'put', c: op.c, id: doc[spec.key], d: doc };
      }
      return fail('Unknown change type.');
    } catch (error) {
      if (error instanceof HttpError) throw new HttpError(error.status, error.message, { index });
      throw error;
    }
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function email(value) {
  if (typeof value !== 'string') fail('Enter a valid email address.');
  const clean = value.trim().toLowerCase();
  if (clean.length > 254 || !EMAIL.test(clean)) fail('Enter a valid email address.');
  return clean;
}

export function password(value, message = 'Use a password with at least 8 characters.') {
  if (typeof value !== 'string' || value.length < 8) fail(message);
  if (value.length > 200) fail('Use a password with at most 200 characters.');
  return value;
}

export function displayName(value) {
  if (typeof value !== 'string' || !value.trim()) fail('Enter your name.');
  if (value.trim().length > 100) fail('Use a shorter name.');
  return value.trim();
}
