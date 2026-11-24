// Checks on the pieces that only matter once deployed: the Vercel Function entry, vercel.json,
// and that every address the browser calls is one the server answers.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { routes } from '../server/app.js';
import { call, freshDatabase } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const config = JSON.parse(read('vercel.json'));
const pkg = JSON.parse(read('package.json'));

function files(dir, found = []) {
  for (const name of readdirSync(path.join(root, dir))) {
    const file = `${dir}/${name}`;
    if (statSync(path.join(root, file)).isDirectory()) files(file, found);
    else found.push(file);
  }
  return found;
}

describe('the Vercel Function', () => {
  it('exports a web-standard fetch handler that answers a rewritten request', async () => {
    freshDatabase();
    const entry = (await import('../api/index.js')).default;
    assert.equal(typeof entry.fetch, 'function');
    // What the function receives after vercel.json rewrites /api/health to /api.
    for (const url of ['https://trackmate.example/api?route=health', 'https://trackmate.example/api/health']) {
      const response = await entry.fetch(new Request(url));
      assert.ok(response instanceof Response);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
    }
  });

  it('is the function vercel.json configures and rewrites to', () => {
    assert.deepEqual(Object.keys(config.functions), ['api/index.js']);
    assert.ok(statSync(path.join(root, 'api/index.js')).isFile());
    assert.deepEqual(files('api'), ['api/index.js'], 'one file in api/ means one function');
    assert.deepEqual(config.rewrites, [{ source: '/api/:route', destination: '/api' }]);
    assert.equal(config.outputDirectory, 'dist');
    assert.equal(config.buildCommand, 'npm run build');
    assert.equal(config.framework, null);
  });

  it('has single-word routes only, so the one rewrite covers them all', () => {
    for (const route of routes) assert.match(route, /^(GET|POST) [a-z-]+$/);
  });

  it('uses explicit .js extensions for every relative import on the server (Node requires them)', () => {
    for (const file of [...files('server'), ...files('api')]) {
      for (const [, target] of read(file).matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)) {
        assert.match(target, /\.js$/, `${file} imports ${target}`);
        assert.ok(statSync(path.resolve(root, path.dirname(file), target)).isFile(), `${file} imports ${target}, which does not exist`);
      }
    }
  });

  it('declares the packages the server imports, and a Node version Vercel offers', () => {
    assert.ok(pkg.dependencies.mongodb);
    assert.ok(pkg.dependencies['@vercel/functions']);
    assert.equal(pkg.type, 'module');
    assert.match(pkg.engines.node, /^(22|24)\.x$/);
    assert.equal(pkg.dependencies['sql.js'], undefined);
  });
});

describe('browser and server agree', () => {
  const source = files('src').filter((file) => /\.tsx?$/.test(file)).map(read).join('\n');
  const called = [...source.matchAll(/\bapi(?:<[^(]*>)?\(\s*'(GET|POST)',\s*[`']([a-z-]+)/g)].map(([, method, name]) => `${method} ${name}`);

  it('finds the calls the app makes', () => {
    assert.ok(called.length >= 8, `only found ${called.length} API calls in src/`);
  });

  it('every address the app calls exists on the server', () => {
    for (const route of new Set(called)) assert.ok(routes.includes(route), `the app calls "${route}" but the server has no such route`);
  });

  it('every server route is used by the app or is the health check', () => {
    for (const route of routes) assert.ok(called.includes(route) || route === 'GET health', `nothing calls "${route}"`);
  });

  it('nothing in the app still mentions SQLite', () => {
    for (const file of [...files('src'), ...files('public'), 'index.html', 'scripts/build.mjs']) {
      assert.doesNotMatch(read(file), /sql\.js|sqlite|\.wasm'\)/i, file);
    }
  });

  it('an account that signed up can do everything the app does on first load', async () => {
    freshDatabase();
    const jar = {};
    assert.equal((await call('GET', '/api/me', undefined, jar)).body.user, null);
    assert.equal((await call('POST', '/api/signup', { name: 'A', email: 'first@example.com', password: 'long enough' }, jar)).status, 201);
    assert.equal((await call('GET', '/api/data?rev=0', undefined, jar)).body.unchanged, true);
  });
});
