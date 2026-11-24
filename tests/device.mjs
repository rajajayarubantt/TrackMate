// Runs the app's data layer (src/db) in Node as if it were a browser tab, talking to the real API
// handler. Each "device" gets its own copy of the code, its own cookies, offline storage and
// network switch, so tests can play two devices against one account.
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handle } from '../server/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
globalThis.__trackmateDevices ??= new Map();

let bundle;
async function bundled() {
  if (!bundle) {
    const outfile = path.join(mkdtempSync(path.join(os.tmpdir(), 'trackmate-test-')), 'client.mjs');
    await build({
      entryPoints: [path.join(here, 'client-entry.ts')],
      outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      // The browser globals the code uses are handed in per device instead of being real globals.
      banner: {
        js: `const __env = globalThis.__trackmateDevices.get(new URL(import.meta.url).searchParams.get('device'));
const { window, document, fetch, addEventListener, indexedDB, localStorage, navigator } = __env;`,
      },
    });
    bundle = pathToFileURL(outfile).href;
  }
  return bundle;
}

/** A just-enough IndexedDB: one database, string keys, values copied in and out like the real thing. */
function fakeIndexedDB() {
  const data = new Map();
  let created = false;
  return {
    data,
    open() {
      const request = {};
      queueMicrotask(() => {
        const tx = () => {
          const transaction = {};
          const store = {
            get(key) {
              const got = {};
              queueMicrotask(() => {
                got.result = data.has(key) ? structuredClone(data.get(key)) : undefined;
                got.onsuccess?.();
              });
              return got;
            },
            put(value, key) {
              data.set(key, structuredClone(value));
              queueMicrotask(() => transaction.oncomplete?.());
            },
            delete(key) {
              data.delete(key);
              queueMicrotask(() => transaction.oncomplete?.());
            },
          };
          transaction.objectStore = () => store;
          return transaction;
        };
        request.result = { createObjectStore() {}, close() {}, transaction: tx };
        if (!created) {
          created = true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };
}

let count = 0;

/**
 * @param {object} [reuse] pass an earlier device to "reload the page": same cookies and offline storage, fresh code
 */
export async function device(reuse) {
  const id = `d${++count}`;
  const state = reuse?.state ?? { jar: {}, online: true, idb: fakeIndexedDB(), local: new Map(), delay: 0 };
  const sent = [];
  const notices = [];
  let expired = 0;

  const fetcher = async (url, init = {}) => {
    if (!state.online) throw new TypeError('Failed to fetch');
    if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
    if (!state.online) throw new TypeError('Failed to fetch');
    const body = init.body;
    if (String(url).startsWith('/api/sync')) sent.push(JSON.parse(body).ops);
    const response = await handle(
      new Request(`http://trackmate.test${url}`, {
        method: init.method ?? 'GET',
        headers: { ...(init.headers ?? {}), ...(state.jar.cookie ? { cookie: state.jar.cookie } : {}) },
        body,
      }),
    );
    const cookie = response.headers.get('set-cookie');
    if (cookie) state.jar.cookie = cookie.split(';')[0];
    return response;
  };

  const timers = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer),
    setInterval: (fn, ms) => {
      const timer = setInterval(fn, ms);
      timer.unref();
      return timer;
    },
  };
  globalThis.__trackmateDevices.set(id, {
    window: timers,
    document: { visibilityState: 'visible', addEventListener() {} },
    addEventListener() {},
    fetch: fetcher,
    indexedDB: state.idb,
    localStorage: { getItem: (k) => state.local.get(k) ?? null, setItem: (k, v) => state.local.set(k, String(v)), removeItem: (k) => state.local.delete(k) },
    navigator: {},
  });

  const code = await import(`${await bundled()}?device=${id}`);
  code.store.configure({
    onUser: () => undefined,
    onExpired: () => {
      expired++;
      code.store.stop();
    },
    onNotice: (message) => notices.push(message),
  });

  return {
    ...code, state, sent, notices,
    get expired() { return expired; },
    /** Call the API with this device's cookies. */
    async api(method, route, body) {
      const response = await fetcher(`/api/${route}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() };
    },
    /** What the server holds for this device's account, and what the device shows, in a comparable form. */
    async compare() {
      const server = (await this.api('GET', 'data')).body.data;
      const local = code.store.exportData();
      const tidy = (data) => Object.fromEntries(
        Object.entries(data).map(([name, docs]) => [name, docs.map((doc) => JSON.parse(JSON.stringify(doc))).sort((a, b) => ((a.id ?? a.key) < (b.id ?? b.key) ? -1 : 1))]),
      );
      return { server: tidy(server), local: tidy(local) };
    },
  };
}
