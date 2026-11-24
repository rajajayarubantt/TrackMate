// The app's data, held in memory and kept in step with MongoDB through the API.
//
// Reads are instant because they come from memory. A change is applied to memory first, then queued
// and sent to /api/sync in small batches. The queue and a copy of the data are also kept in this
// browser (IndexedDB), so TrackMate opens straight away, keeps working offline, and sends whatever
// is waiting once it is back online.
//
// Every change is a whole document ("store this task") or a deletion, so sending one twice is
// harmless and the last save of a document wins.
import { useSyncExternalStore } from 'react';
import { api, ApiError } from '../lib/api';
import { idbGet, idbSet } from '../lib/idb';
import { createStore } from '../lib/store';
import type { Settings } from './types';

export type CollectionName = 'tags' | 'links' | 'stages' | 'tasks' | 'notes' | 'events' | 'reminders' | 'focus';
export const COLLECTIONS: readonly CollectionName[] = ['tags', 'links', 'stages', 'tasks', 'notes', 'events', 'reminders', 'focus'];

export type Doc = Record<string, unknown>;
export type Snapshot = Record<CollectionName, Doc[]>;

/** The account as the server describes it. Settings may be incomplete; the session fills the gaps. */
export interface ServerUser {
  id: string;
  email: string;
  name: string;
  settings: Partial<Settings>;
  created_at: number;
}

type Op =
  | { t: 'put'; c: CollectionName; d: Doc }
  | { t: 'del'; c: CollectionName; id: string }
  | { t: 'me'; name?: string; settings?: Settings };

interface SyncResponse {
  user: ServerUser;
  rev: number;
}
interface DataResponse extends SyncResponse {
  unchanged?: boolean;
  data?: Partial<Snapshot>;
}

export interface CacheRecord {
  v: 1;
  userId: string;
  user: ServerUser;
  rev: number;
  stale: boolean;
  data: Snapshot;
  outbox: Op[];
}

export interface SyncState {
  /** ok: the last request worked. offline: the server could not be reached. error: it answered with a problem. */
  health: 'ok' | 'offline' | 'error';
  /** Changes waiting to be sent. */
  pending: number;
  /** When this browser last matched the server. */
  syncedAt: number;
  error: string;
}
export const syncState = createStore<SyncState>({ health: 'ok', pending: 0, syncedAt: 0, error: '' });

interface Handlers {
  /** The profile on the server changed, for example from another device. */
  onUser(user: ServerUser): void;
  /** The session ended: it ran out, or the password was changed somewhere else. */
  onExpired(): void;
  /** Something the person should be told. */
  onNotice(message: string): void;
}
let handlers: Handlers = { onUser: () => undefined, onExpired: () => undefined, onNotice: () => undefined };
export const configure = (next: Handlers): void => {
  handlers = next;
};

const BATCH_OPS = 200;
const BATCH_CHARS = 1_200_000;
const KEEPALIVE_CHARS = 60_000;
const FLUSH_DELAY = 400;
const CACHE_DELAY = 600;
const POLL_MS = 60_000;
const RETRY_MS = [2000, 5000, 15_000, 30_000, 60_000];
const CACHE_KEY = 'cache';

const keyOf = (collection: CollectionName): 'id' | 'key' => (collection === 'reminders' ? 'key' : 'id');
const emptyTables = (): Record<CollectionName, Map<string, Doc>> =>
  Object.fromEntries(COLLECTIONS.map((name) => [name, new Map<string, Doc>()])) as Record<CollectionName, Map<string, Doc>>;

let userId = '';
let profile: ServerUser | null = null;
let tables = emptyTables();
let outbox: Op[] = [];
/** How many changes at the front of the queue are on their way to the server right now. */
let inflight = 0;
/** The server revision this browser has loaded completely; -1 before anything has loaded. */
let rev = -1;
/** Another device (or tab) has saved since, so the next refresh must fetch everything. */
let stale = false;
let batchLimit = BATCH_OPS;
let failures = 0;
let lastRefresh = 0;
let inRefresh = false;

let flushTimer: number | undefined;
let cacheTimer: number | undefined;
let retryTimer: number | undefined;
let refreshTimer: number | undefined;

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('trackmate-sync') : null;

// ── Change tracking ────────────────────────────────────────────────────────────────────────────

let version = 0;
let notifyQueued = false;
const listeners = new Set<() => void>();

function bump(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    version++;
    listeners.forEach((fn) => fn());
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the calling component whenever the data changes. */
export function useDbVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

// ── Reading and writing (used by repo.ts) ──────────────────────────────────────────────────────

export const rows = <T>(collection: CollectionName): T[] => [...tables[collection].values()] as T[];
export const find = <T>(collection: CollectionName, id: string): T | undefined => tables[collection].get(id) as T | undefined;
export const pendingCount = (): number => outbox.length;
/** The signed-in account as this browser currently understands it, including changes not sent yet. */
export const currentProfile = (): ServerUser | null => profile;

function enqueue(next: Op): void {
  let op = next;
  // A newer change to the same document replaces an older one that has not been sent yet.
  for (let i = outbox.length - 1; i >= inflight; i--) {
    const other = outbox[i];
    if (op.t === 'me' && other.t === 'me') {
      op = { ...other, ...op };
      outbox.splice(i, 1);
    } else if (op.t !== 'me' && other.t !== 'me' && other.c === op.c && idOf(other) === idOf(op)) {
      outbox.splice(i, 1);
    }
  }
  outbox.push(op);
  syncState.set((state) => ({ ...state, pending: outbox.length }));
  scheduleCache();
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), FLUSH_DELAY);
}

const idOf = (op: Exclude<Op, { t: 'me' }>): string => (op.t === 'put' ? String(op.d[keyOf(op.c)]) : op.id);

/** Store a whole document (insert or replace). Documents are never changed in place. */
export function put(collection: CollectionName, doc: Doc): void {
  if (!userId) return;
  tables[collection].set(String(doc[keyOf(collection)]), doc);
  bump();
  enqueue({ t: 'put', c: collection, d: doc });
}

export function remove(collection: CollectionName, id: string): void {
  if (!userId || !tables[collection].delete(id)) return;
  bump();
  enqueue({ t: 'del', c: collection, id });
}

/** Save a change to the signed-in person's name or settings. */
export function putProfile(change: { name?: string; settings?: Settings }): void {
  if (!userId) return;
  enqueue({ t: 'me', ...change });
}

/** Keep the offline copy's idea of who is signed in up to date. */
export function rememberUser(user: ServerUser): void {
  if (user.id !== userId) return;
  profile = user;
  scheduleCache();
}

// ── The copy kept in this browser ──────────────────────────────────────────────────────────────

const snapshot = (): Snapshot => Object.fromEntries(COLLECTIONS.map((name) => [name, rows<Doc>(name)])) as Snapshot;

function scheduleCache(): void {
  if (cacheTimer !== undefined) return;
  cacheTimer = window.setTimeout(() => void saveCache(), CACHE_DELAY);
}

/** Write the offline copy now. The record is put together before anything is awaited. */
export function saveCache(): Promise<void> {
  window.clearTimeout(cacheTimer);
  cacheTimer = undefined;
  if (!userId || !profile || rev < 0) return Promise.resolve();
  const record: CacheRecord = { v: 1, userId, user: profile, rev, stale, data: snapshot(), outbox: [...outbox] };
  return idbSet(CACHE_KEY, record).catch(() => undefined);
}

export async function loadCache(): Promise<CacheRecord | undefined> {
  try {
    const record = await idbGet<CacheRecord>(CACHE_KEY);
    return record && record.v === 1 && record.data && Array.isArray(record.outbox) ? record : undefined;
  } catch {
    return undefined;
  }
}

export const clearCache = (): Promise<void> => idbSet(CACHE_KEY, undefined).catch(() => undefined);

// ── Starting and stopping ──────────────────────────────────────────────────────────────────────

function fill(data: Partial<Snapshot>): void {
  tables = emptyTables();
  for (const name of COLLECTIONS) {
    for (const doc of data[name] ?? []) tables[name].set(String(doc[keyOf(name)]), doc);
  }
}

/**
 * Begin working as this account.
 * @param cached    what this browser kept from last time, including changes that were never sent
 * @param serverRev the server's revision when the account is known to be empty (just created)
 */
export function start(user: ServerUser, cached?: CacheRecord, serverRev?: number): void {
  stop();
  userId = user.id;
  profile = user;
  if (cached && cached.userId === user.id) {
    fill(cached.data);
    outbox = cached.outbox;
    rev = cached.rev;
    stale = cached.stale;
  } else if (serverRev !== undefined) {
    rev = serverRev;
  }
  attach();
  bump();
  syncState.set({ health: 'ok', pending: outbox.length, syncedAt: 0, error: '' });
}

export function stop(): void {
  for (const timer of [flushTimer, cacheTimer, retryTimer, refreshTimer]) window.clearTimeout(timer);
  flushTimer = cacheTimer = retryTimer = refreshTimer = undefined;
  userId = '';
  profile = null;
  tables = emptyTables();
  outbox = [];
  inflight = 0;
  rev = -1;
  stale = false;
  batchLimit = BATCH_OPS;
  failures = 0;
  bump();
}

let attached = false;
function attach(): void {
  if (attached) return;
  attached = true;
  document.addEventListener('visibilitychange', () => {
    if (!userId) return;
    if (document.visibilityState === 'hidden') {
      void flush();
      void saveCache();
    } else if (Date.now() - lastRefresh > 5000) {
      void refresh();
    }
  });
  addEventListener('pagehide', () => {
    if (!userId) return;
    void flush();
    void saveCache();
  });
  addEventListener('focus', () => {
    if (userId && Date.now() - lastRefresh > 15_000) void refresh();
  });
  addEventListener('online', () => {
    if (userId) void refresh();
  });
  window.setInterval(() => {
    if (userId && document.visibilityState === 'visible') void refresh();
  }, POLL_MS);
  // Another tab of this browser saved something: pick it up.
  channel?.addEventListener('message', (event) => {
    if (!userId || event.data !== userId) return;
    stale = true;
    scheduleRefresh();
  });
}

// ── Talking to the server ──────────────────────────────────────────────────────────────────────

// Requests run one at a time, so a snapshot is never fetched while a batch of changes is in the air.
let lane: Promise<unknown> = Promise.resolve();
function inLane<T>(job: () => Promise<T>): Promise<T> {
  const run = lane.then(job, job);
  lane = run.catch(() => undefined);
  return run;
}

function scheduleRefresh(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), 300);
}

function nextBatch(): { ops: Op[]; chars: number } {
  const ops: Op[] = [];
  let chars = 0;
  for (const op of outbox) {
    const size = JSON.stringify(op).length;
    if (ops.length && (ops.length >= batchLimit || chars + size > BATCH_CHARS)) break;
    ops.push(op);
    chars += size;
  }
  return { ops, chars };
}

/** Pending changes to the profile are laid over what the server says, so they are not undone on screen. */
function adoptUser(user: ServerUser): void {
  let merged = user;
  for (const op of outbox) {
    if (op.t === 'me') merged = { ...merged, name: op.name ?? merged.name, settings: op.settings ?? merged.settings };
  }
  profile = merged;
  handlers.onUser(merged);
}

function failed(error: ApiError): void {
  failures++;
  if (failures === 1 && error.offline && outbox.length) {
    handlers.onNotice('You’re offline. Changes are kept on this device and will sync when you reconnect.');
  }
  syncState.set((state) => ({ ...state, health: error.offline ? 'offline' : 'error', pending: outbox.length, error: error.message }));
}

/** The queue has just been emptied by a request that worked. */
function succeeded(): void {
  if (failures > 0) handlers.onNotice('Back online. Your changes are synced.');
  failures = 0;
  syncState.set({ health: 'ok', pending: outbox.length, syncedAt: Date.now(), error: '' });
}

/** Send everything that is waiting. Returns false when the server could not be reached. */
async function sendAll(): Promise<boolean> {
  window.clearTimeout(flushTimer);
  window.clearTimeout(retryTimer);
  const forUser = userId;
  let sentSomething = false;
  while (userId && userId === forUser && outbox.length) {
    const batch = nextBatch();
    inflight = batch.ops.length;
    let result: SyncResponse;
    try {
      result = await api<SyncResponse>('POST', 'sync', { ops: batch.ops }, { keepalive: batch.chars < KEEPALIVE_CHARS });
    } catch (error) {
      inflight = 0;
      if (userId !== forUser) return false;
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 401) {
        handlers.onExpired();
        return false;
      }
      if (error.status === 400 || error.status === 413 || error.status === 422) {
        // The server will never accept this change, so retrying is pointless: drop it and reload the truth.
        const index = typeof error.data.index === 'number' ? error.data.index : batch.ops.length === 1 ? 0 : -1;
        if (index >= 0 && index < batch.ops.length) {
          outbox.splice(index, 1);
          stale = true;
          handlers.onNotice(`One change could not be saved. ${error.message}`);
        } else {
          batchLimit = Math.max(1, Math.floor(batch.ops.length / 2));
        }
        continue;
      }
      failed(error);
      retryTimer = window.setTimeout(() => void flush(), RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]);
      return false;
    }
    if (userId !== forUser) return false;
    outbox.splice(0, inflight);
    inflight = 0;
    batchLimit = BATCH_OPS;
    sentSomething = true;
    // Each saved batch raises the revision by one. A bigger jump means someone else saved in between.
    if (!stale && rev >= 0 && result.rev === rev + 1) rev = result.rev;
    else stale = true;
    adoptUser(result.user);
    channel?.postMessage(userId);
    scheduleCache();
  }
  if (!userId || userId !== forUser) return false;
  if (sentSomething) succeeded();
  if (stale && !inRefresh) scheduleRefresh();
  return true;
}

/** Send waiting changes now instead of after the usual short pause. */
export function flush(): Promise<void> {
  return inLane(async () => {
    if (userId) await sendAll();
  });
}

/**
 * Bring this browser up to date with the server.
 * @param options.force  fetch everything even if the revision looks current
 * @param options.strict throw when it cannot be done (used while signing in); otherwise fail quietly
 */
export function refresh(options: { force?: boolean; strict?: boolean } = {}): Promise<void> {
  return inLane(async () => {
    if (!userId) return;
    const forUser = userId;
    inRefresh = true;
    try {
      const sent = await sendAll();
      if (userId !== forUser) {
        if (options.strict) throw new ApiError(401, 'Sign in to continue.');
        return;
      }
      if (!sent && !options.strict) return;
      lastRefresh = Date.now();
      const known = !options.force && !stale && rev >= 0 ? `?rev=${rev}` : '';
      let result: DataResponse;
      try {
        result = await api<DataResponse>('GET', `data${known}`);
      } catch (error) {
        if (userId === forUser && error instanceof ApiError) {
          if (error.status === 401) handlers.onExpired();
          else syncState.set((state) => ({ ...state, health: error.offline ? 'offline' : 'error', error: error.message }));
        }
        if (options.strict || !(error instanceof ApiError)) throw error;
        return;
      }
      if (userId !== forUser) return;
      if (result.data) {
        // Changes made while the snapshot was on its way are still in the queue: put them back on top.
        fill(result.data);
        for (const op of outbox) {
          if (op.t === 'put') tables[op.c].set(String(op.d[keyOf(op.c)]), op.d);
          else if (op.t === 'del') tables[op.c].delete(op.id);
        }
        rev = result.rev;
        stale = false;
        bump();
        scheduleCache();
      }
      adoptUser(result.user);
      syncState.set((state) => ({ health: 'ok', pending: outbox.length, syncedAt: outbox.length ? state.syncedAt : Date.now(), error: '' }));
    } finally {
      inRefresh = false;
    }
  });
}

// ── Backups ────────────────────────────────────────────────────────────────────────────────────

export const exportData = (): Snapshot => snapshot();

/** Replace everything in the account with the given data. */
export function replaceAll(data: Partial<Snapshot>): void {
  for (const name of COLLECTIONS) {
    for (const id of [...tables[name].keys()]) remove(name, id);
  }
  for (const name of COLLECTIONS) {
    for (const doc of data[name] ?? []) put(name, doc);
  }
}
