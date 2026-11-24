#!/usr/bin/env node
// TrackMate build script.
//   node scripts/build.mjs          production build into dist/ (this is what Vercel runs)
//   node scripts/build.mjs --dev    watch + rebuild + local server with live reload
//   node scripts/build.mjs --serve  production build, then serve dist/
//
// The local server also answers /api/* with the same code Vercel runs as a function (server/app.js),
// so the whole app works on one address without the Vercel CLI.
import { build, context } from 'esbuild';
import { createServer } from 'node:http';
import { promises as fs, existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadEnv, root } from './env.mjs';

const out = path.join(root, 'dist');
const flags = new Set(process.argv.slice(2));
const dev = flags.has('--dev');
const serve = dev || flags.has('--serve');
const port = Number(process.env.PORT || 5173);
const buildId = Date.now().toString(36);

async function copyDir(src, dst) {
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

async function listFiles(dir, base = dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full, base)));
    else found.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return found;
}

async function prepare() {
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, 'assets'), { recursive: true });
  await copyDir(path.join(root, 'public'), out);
}

const liveReload = `<script>new EventSource('/__livereload').onmessage = () => location.reload();</script>`;

async function writeShell() {
  let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  html = html.replaceAll('%BUILD%', buildId).replace('<!--dev-->', dev ? liveReload : '');
  await fs.writeFile(path.join(out, 'index.html'), html);

  // The service worker caches the app shell so TrackMate opens offline.
  const assets = (await listFiles(out))
    .filter((f) => !['sw.js', 'index.html'].includes(f) && !f.endsWith('.map'))
    .map((f) => (f.startsWith('assets/') ? `${f}?v=${buildId}` : f));
  let sw = await fs.readFile(path.join(root, 'public', 'sw.js'), 'utf8');
  sw = sw.replace('__BUILD__', buildId).replace('__ASSETS__', JSON.stringify(['./', ...assets]));
  await fs.writeFile(path.join(out, 'sw.js'), sw);
}

const options = {
  entryPoints: { app: path.join(root, 'src', 'main.tsx') },
  outdir: path.join(out, 'assets'),
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  minify: !dev,
  sourcemap: dev ? 'linked' : false,
  legalComments: 'none',
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': dev ? '"development"' : '"production"',
    __DEV__: String(dev),
    __BUILD__: JSON.stringify(buildId),
  },
};

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

/** Hand an /api request to the same handler that runs on Vercel. */
async function serveApi(req, res) {
  const { handle } = await import('../server/app.js');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4_500_000) {
      res.writeHead(413, { 'Content-Type': 'application/json' }).end('{"error":"That request is too large."}');
      return;
    }
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
    method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined,
  });
  // TRACKMATE_LATENCY=300 makes every API answer take that many milliseconds, to see the app on a slow connection.
  const latency = Number(process.env.TRACKMATE_LATENCY || 0);
  if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
  const response = await handle(request);
  const answer = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') answer[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) answer['set-cookie'] = cookies;
  res.writeHead(response.status, answer);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function startServer(clients) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      serveApi(req, res).catch((error) => {
        console.error(error);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end('{"error":"Something went wrong on the server."}');
      });
      return;
    }
    if (url.pathname === '/__livereload') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    let file = path.normalize(path.join(out, decodeURIComponent(url.pathname)));
    if (!file.startsWith(out)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!existsSync(file)) file = path.join(out, 'index.html');
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`\n  TrackMate is running\n`);
    console.log(`  On this computer   http://localhost:${port}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`  On your network    http://${net.address}:${port}`);
      }
    }
    console.log('');
    console.log(
      (process.env.MONGODB_URI || '').trim()
        ? `  Database           MongoDB, database "${(process.env.MONGODB_DB || '').trim() || 'trackmate'}"`
        : `  Database           local stand-in${process.env.TRACKMATE_DEV_DB === 'off' ? '' : ', saved to .data/dev-db.json'} (add MONGODB_URI to .env.local to use MongoDB Atlas)`,
    );
    console.log('');
  });
}

if (serve) loadEnv();
await prepare();

if (dev) {
  const clients = new Set();
  const ctx = await context({
    ...options,
    plugins: [{
      name: 'shell',
      setup(b) {
        b.onEnd(async (result) => {
          if (result.errors.length) return;
          await writeShell();
          for (const res of clients) res.write('data: reload\n\n');
        });
      },
    }],
  });
  await ctx.watch();
  startServer(clients);
} else {
  await build(options);
  await writeShell();
  console.log(`\n  Built to dist/ (build ${buildId})\n`);
  if (serve) startServer(new Set());
}
